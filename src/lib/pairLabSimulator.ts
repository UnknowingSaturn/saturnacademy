// ============================================================================
// Pair Lab — Strategy Simulator (proof-based counterfactual replay)
//
// Each preset declares a data contract. A trade is only replayed under that
// preset if the recorded data PROVES the rules would have triggered:
//
//   - Logged MFE ≥ X  → price reached X.            (proof)
//   - r_actual ≥ X    → price reached at least X.   (proof; close happened there)
//   - Logged MAE ≥ S  → trade stopped at SL distance S.
//
// No heuristic guessing, no bucket medians. If the data can't prove a target
// was reached AND the trade wasn't stopped out, the trade is EXCLUDED from
// that preset's sample and counted under `ineligibleReasons`.
//
// Each ReplayResult reports its native eligible N. The Compare view uses a
// matched-sample intersection so the two strategies are scored on the exact
// same trades. Bootstrap CIs make statistical uncertainty visible.
//
// UNIT CONTRACT (2026-06):
//   `cf_mae` and `cf_ideal_stop_loss` are stored in broker TICKS (TradingView
//   position-calc output). Convert with `ticksToPips()` before comparing
//   against SL distances expressed in pips.
// ============================================================================

import type { Trade } from "@/types/trading";
import type { PairLabFieldKeys, PropFirmContext } from "@/lib/pairLabMath";
import { bootstrapMeanCi, quantile, stddev, downsideStddev } from "@/lib/pairLabMath";
import { pipSizeForSymbol, ticksToPips } from "@/lib/symbolMapping";

/** Default fraction of MFE captured by a trailing stop when no empirical estimate is available. */
export const TRAIL_CAPTURE_FRAC = 0.8;

// ----------------------------------------------------------------------------
// Strategy types (unchanged shape for picker/preset back-compat)
// ----------------------------------------------------------------------------

export type SlRule = "original" | "tighten_to_ideal" | "widen_to_mae_p75_x_1_15";
export type RunnerRule = "trail_to_mfe" | "be_after_first_tp" | "all_out_at_last_partial";
/** Source for a partial's atR target. "fixed" uses `atR` as-is; bucket_mfe_pN
 * resolves to the Nth percentile of MFE-in-R for the trades in the replay set. */
export type AtRSource = "fixed" | "bucket_mfe_p50" | "bucket_mfe_p60" | "bucket_mfe_p75";

export interface PartialRule {
  atR: number;
  fraction: number;
  /** Defaults to "fixed". When set, `atR` is overridden by the bucket statistic. */
  atRSource?: AtRSource;
}

export interface ExitRule {
  partials: PartialRule[];
  runner: RunnerRule;
}

export interface Strategy {
  id: string;
  label: string;
  description?: string;
  riskPct: number;
  slRule: SlRule;
  exitRule: ExitRule;
  useActualOutcome?: boolean;
}

// ----------------------------------------------------------------------------
// Replay output types
// ----------------------------------------------------------------------------

export interface ReplayPerTrade {
  tradeId: string;
  entryTime: string | null;
  resultR: number;
  dollars: number;
  cumulativeEquity: number;
}

export interface ReplayResult {
  strategy: Strategy;
  n: number;
  totalTradeCount: number;
  eligibleCount: number;
  ineligibleCount: number;
  ineligibleReasons: Record<string, number>;
  wins: number;
  losses: number;
  winRate: number;
  expectancyR: number;
  totalR: number;
  totalDollars: number;
  maxDrawdownDollars: number;
  maxDrawdownPct: number;
  worstLosingStreak: number;
  meanReachedR: number | null;
  /** Sharpe ratio of the per-trade R series — mean / stddev. */
  sharpeR: number | null;
  /** Sortino ratio — mean / downside stddev (target = 0). */
  sortinoR: number | null;
  equityCurve: Array<{ i: number; equity: number; at: string | null }>;
  /** Underwater equity curve: equity - runningMax(equity). Always ≤ 0. */
  underwaterCurve: Array<{ i: number; underwater: number }>;
  perTrade: ReplayPerTrade[];
  propFirmVerdict: "pass" | "bust_daily" | "bust_total" | "n/a";
  bustNote: string | null;
  expectancyRCi: [number, number] | null;
  totalDollarsCi: [number, number] | null;
}

// ----------------------------------------------------------------------------
// Field readers
// ----------------------------------------------------------------------------

function getCf(trade: any, key: string | null): unknown {
  if (!key) return undefined;
  const cf = trade?.custom_fields;
  if (!cf || typeof cf !== "object") return undefined;
  return cf[key];
}

function numericCf(trade: any, key: string | null): number | null {
  const v = getCf(trade, key);
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}


/** Distance from entry to initial stop, expressed in pips (or points for indices). */
function slDistancePips(t: Trade): number | null {
  if (t.sl_initial == null || t.entry_price == null || !t.symbol) return null;
  const pip = pipSizeForSymbol(t.symbol);
  if (!(pip > 0)) return null;
  const distance = Math.abs(t.entry_price - t.sl_initial);
  if (!(distance > 0)) return null;
  return distance / pip;
}

/** MAE-ticks → MAE in R-multiples of the original SL. Null when SL/entry missing. */
export function tradeMaeR(t: Trade, maeTicks: number | null): number | null {
  if (maeTicks == null || !t.symbol) return null;
  const slPips = slDistancePips(t);
  if (slPips == null || slPips <= 0) return null;
  const maePips = ticksToPips(t.symbol, Math.abs(maeTicks));
  return maePips / slPips;
}

/** Ideal-SL ticks → scale multiplier against original SL distance (clamped 0.1..2). */
export function idealSlScaleFor(t: Trade, idealTicks: number | null): number | null {
  if (idealTicks == null || !t.symbol) return null;
  const slPips = slDistancePips(t);
  if (slPips == null || slPips <= 0) return null;
  const idealPips = ticksToPips(t.symbol, idealTicks);
  return Math.max(0.1, Math.min(2, idealPips / slPips));
}


// ----------------------------------------------------------------------------
// Per-trade proof extraction
// ----------------------------------------------------------------------------

interface TradeProof {
  reachedR: number;
  hasReachProof: boolean;
  stoppedOut: boolean | null;
  loggedMfe: number | null;
  loggedMae: number | null;
  hasActualR: boolean;
  rActual: number;
  idealSlScale: number | null;
}

function extractProof(trade: Trade, keys: PairLabFieldKeys): TradeProof {
  const loggedMfeRaw = numericCf(trade as any, keys.mfe);
  const loggedMfe = loggedMfeRaw != null ? Math.max(0, loggedMfeRaw) : null;

  const loggedMae = tradeMaeR(trade, numericCf(trade as any, keys.mae));

  const rActual = trade.r_multiple_actual;
  const hasActualR = rActual != null;

  const proofs: number[] = [];
  if (loggedMfe != null) proofs.push(loggedMfe);
  if (hasActualR && (rActual as number) > 0) proofs.push(rActual as number);
  const reachedR = proofs.length ? Math.max(...proofs) : 0;
  const hasReachProof = proofs.length > 0;

  let stoppedOut: boolean | null = null;
  if (loggedMae != null) {
    stoppedOut = loggedMae >= 1;
  } else if (hasActualR) {
    const r = rActual as number;
    if (r <= -1.05) stoppedOut = true;
    else if (r >= -0.95) stoppedOut = false;
    else stoppedOut = null;
  }

  const idealTicks = numericCf(trade as any, keys.idealStopLoss);
  const idealSlScale = idealSlScaleFor(trade, idealTicks);

  return {
    reachedR,
    hasReachProof,
    stoppedOut,
    loggedMfe,
    loggedMae,
    hasActualR,
    rActual: rActual ?? 0,
    idealSlScale,
  };
}

// ----------------------------------------------------------------------------
// Single-trade proof-based replay
// ----------------------------------------------------------------------------

type ReplayOutcome = { r: number } | { ineligible: string };

interface BucketConstants {
  maeP75: number | null;
}

interface ReplayContext {
  bucket: BucketConstants;
  trailCapture: number;
}

function buildBucketConstants(trades: Trade[], keys: PairLabFieldKeys): BucketConstants {
  const maes = trades
    .map((t) => tradeMaeR(t, numericCf(t as any, keys.mae)))
    .filter((v): v is number => v != null && Number.isFinite(v));
  return { maeP75: quantile(maes, 0.75) };
}


function replayOneTrade(
  strategy: Strategy,
  trade: Trade,
  proof: TradeProof,
  ctx: ReplayContext,
): ReplayOutcome {
  if (strategy.useActualOutcome) {
    return proof.hasActualR ? { r: proof.rActual } : { ineligible: "no recorded r_actual" };
  }

  // BE-after-TP runner requires at least one partial to have an actual TP to
  // move stops behind. Without partials it would silently exit at 0R on every
  // non-stopped trade, which would massively understate strategy P&L.
  if (
    strategy.exitRule.runner === "be_after_first_tp" &&
    strategy.exitRule.partials.length === 0
  ) {
    return { ineligible: "BE-after-TP runner needs ≥1 partial" };
  }

  let slScale: number;
  if (strategy.slRule === "original") {
    slScale = 1;
  } else if (strategy.slRule === "tighten_to_ideal") {
    if (proof.idealSlScale == null) return { ineligible: "missing SL/entry or ideal-SL — can't convert ticks to R" };
    slScale = proof.idealSlScale;
  } else {
    if (ctx.bucket.maeP75 == null) return { ineligible: "no MAE samples in bucket for widen rule" };
    slScale = Math.max(1, ctx.bucket.maeP75 * 1.15);
  }

  let stoppedUnderNewSl: boolean | null;
  if (proof.loggedMae != null) {
    stoppedUnderNewSl = proof.loggedMae >= slScale;
  } else if (slScale <= 1) {
    if (proof.stoppedOut === true) stoppedUnderNewSl = true;
    else if (proof.stoppedOut === false && slScale === 1) stoppedUnderNewSl = false;
    else stoppedUnderNewSl = null;
  } else {
    if (proof.stoppedOut === false) stoppedUnderNewSl = false;
    else stoppedUnderNewSl = null;
  }
  if (stoppedUnderNewSl === null) return { ineligible: "missing SL/entry — can't convert MAE ticks to R" };


  const partials = [...strategy.exitRule.partials].sort((a, b) => a.atR - b.atR);
  let booked = 0;
  let remainingFrac = 1;
  let anyFilled = false;
  let lastFilledAtR = 0;
  for (const p of partials) {
    const needOrigR = p.atR * slScale;
    if (proof.reachedR >= needOrigR) {
      const take = Math.min(p.fraction, remainingFrac);
      booked += p.atR * take;
      remainingFrac -= take;
      anyFilled = true;
      lastFilledAtR = p.atR;
    } else if (stoppedUnderNewSl) {
      // partial does not fill — runner handling will book the loss
    } else {
      return { ineligible: `unproven ${p.atR}R target` };
    }
  }

  if (remainingFrac > 0) {
    if (stoppedUnderNewSl && !anyFilled) {
      booked += -1 * remainingFrac;
    } else if (stoppedUnderNewSl && anyFilled) {
      if (strategy.exitRule.runner === "be_after_first_tp") {
        booked += 0;
      } else if (strategy.exitRule.runner === "all_out_at_last_partial") {
        booked += lastFilledAtR * remainingFrac;
      } else {
        if (proof.loggedMfe == null) return { ineligible: "no MFE for trail runner" };
        const mfeNewR = proof.loggedMfe / slScale;
        booked += Math.max(-1, ctx.trailCapture * mfeNewR) * remainingFrac;
      }
    } else {
      if (strategy.exitRule.runner === "be_after_first_tp") {
        booked += 0;
      } else if (strategy.exitRule.runner === "all_out_at_last_partial") {
        booked += lastFilledAtR * remainingFrac;
      } else {
        if (proof.loggedMfe == null) return { ineligible: "no MFE for trail runner" };
        const mfeNewR = proof.loggedMfe / slScale;
        booked += ctx.trailCapture * mfeNewR * remainingFrac;
      }
    }

  }

  return { r: booked };
}

// ----------------------------------------------------------------------------
// Bucket-level replay
// ----------------------------------------------------------------------------

export interface ReplayOpts {
  balance: number;
  propFirm: PropFirmContext | null;
  /** Empirically-derived trail capture ratio (overrides TRAIL_CAPTURE_FRAC). */
  trailCapture?: number;
}

export const MIN_ELIGIBLE_SAMPLE = 10;
export const MIN_MATCHED_SAMPLE = 5;

function buildResult(
  strategy: Strategy,
  replayed: Array<{ trade: Trade; r: number; reachedR?: number }>,
  ineligibleReasons: Record<string, number>,
  totalTradeCount: number,
  opts: ReplayOpts,
): ReplayResult {
  const dollarRisk = (opts.balance * strategy.riskPct) / 100;
  const perTrade: ReplayPerTrade[] = [];
  let equity = 0;
  let peak = 0;
  let maxDD = 0;
  let streak = 0;
  let worstStreak = 0;
  let wins = 0;
  let losses = 0;
  let totalR = 0;
  let reachedSum = 0;
  let reachedCount = 0;
  const dailyDollars = new Map<string, number>();
  const rs: number[] = [];
  const underwater: Array<{ i: number; underwater: number }> = [{ i: 0, underwater: 0 }];

  for (const { trade, r, reachedR } of replayed) {
    const dollars = r * dollarRisk;
    equity += dollars;
    totalR += r;
    rs.push(r);
    if (reachedR != null && Number.isFinite(reachedR)) {
      reachedSum += reachedR;
      reachedCount += 1;
    }
    if (r > 0) { wins += 1; streak = 0; }
    else if (r < 0) { losses += 1; streak += 1; if (streak > worstStreak) worstStreak = streak; }
    else { streak = 0; }
    if (equity > peak) peak = equity;
    const dd = equity - peak;
    if (dd < maxDD) maxDD = dd;
    underwater.push({ i: underwater.length, underwater: dd });
    const day = (trade.entry_time ?? "").slice(0, 10) || "unknown";
    dailyDollars.set(day, (dailyDollars.get(day) ?? 0) + dollars);
    perTrade.push({
      tradeId: trade.id,
      entryTime: trade.entry_time ?? null,
      resultR: r,
      dollars,
      cumulativeEquity: equity,
    });
  }

  const n = replayed.length;
  const winRate = n > 0 ? wins / n : 0;
  const expectancyR = n > 0 ? totalR / n : 0;
  const meanReachedR = reachedCount > 0 ? reachedSum / reachedCount : null;
  const sd = stddev(rs);
  const sdDown = downsideStddev(rs, 0);
  const sharpeR = sd > 0 ? expectancyR / sd : null;
  const sortinoR = sdDown > 0 ? expectancyR / sdDown : null;

  let verdict: ReplayResult["propFirmVerdict"] = "n/a";
  let bustNote: string | null = null;
  if (opts.propFirm && opts.propFirm.dailyLossDollars != null) {
    const dailyCap = opts.propFirm.dailyLossDollars;
    for (const [day, sum] of dailyDollars) {
      if (sum < -dailyCap) {
        verdict = "bust_daily";
        bustNote = `Day ${day} lost $${Math.abs(sum).toFixed(0)} (cap $${dailyCap.toFixed(0)}).`;
        break;
      }
    }
  }
  if (verdict === "n/a" && opts.propFirm && opts.propFirm.maxDrawdownDollars != null) {
    if (Math.abs(maxDD) > opts.propFirm.maxDrawdownDollars) {
      verdict = "bust_total";
      bustNote = `Peak-to-trough DD $${Math.abs(maxDD).toFixed(0)} exceeds total cap $${opts.propFirm.maxDrawdownDollars.toFixed(0)}.`;
    } else {
      verdict = "pass";
    }
  } else if (verdict === "n/a" && opts.propFirm) {
    verdict = "pass";
  }

  const equityCurve = [
    { i: 0, equity: 0, at: null as string | null },
    ...perTrade.map((p, i) => ({ i: i + 1, equity: p.cumulativeEquity, at: p.entryTime })),
  ];

  const expectancyRCi = bootstrapMeanCi(rs);
  const totalDollarsCi: [number, number] | null = expectancyRCi
    ? [expectancyRCi[0] * n * dollarRisk, expectancyRCi[1] * n * dollarRisk]
    : null;

  const ineligibleCount = Object.values(ineligibleReasons).reduce((a, b) => a + b, 0);

  return {
    strategy,
    n,
    totalTradeCount,
    eligibleCount: n,
    ineligibleCount,
    ineligibleReasons,
    wins,
    losses,
    winRate,
    expectancyR,
    totalR,
    totalDollars: equity,
    maxDrawdownDollars: maxDD,
    maxDrawdownPct: opts.balance > 0 ? (maxDD / opts.balance) * 100 : 0,
    worstLosingStreak: worstStreak,
    meanReachedR,
    sharpeR,
    sortinoR,
    equityCurve,
    underwaterCurve: underwater,
    perTrade,
    propFirmVerdict: verdict,
    bustNote,
    expectancyRCi,
    totalDollarsCi,
  };
}


function preparedTrades(trades: Trade[]): Trade[] {
  return trades
    .filter((t) => !t.is_open && !t.is_archived && t.net_pnl != null)
    .sort((a, b) => String(a.entry_time ?? "").localeCompare(String(b.entry_time ?? "")));
}

function ctxFor(opts: ReplayOpts, bucket: BucketConstants): ReplayContext {
  return {
    bucket,
    trailCapture: opts.trailCapture != null && opts.trailCapture > 0
      ? opts.trailCapture
      : TRAIL_CAPTURE_FRAC,
  };
}

export function replayBucket(
  trades: Trade[],
  keys: PairLabFieldKeys,
  strategy: Strategy,
  opts: ReplayOpts,
): ReplayResult {
  const all = preparedTrades(trades);
  const bucket = buildBucketConstants(all, keys);
  const ctx = ctxFor(opts, bucket);
  const replayed: Array<{ trade: Trade; r: number; reachedR: number }> = [];
  const reasons: Record<string, number> = {};

  for (const t of all) {
    const proof = extractProof(t, keys);
    const out = replayOneTrade(strategy, t, proof, ctx);
    if ("r" in out) replayed.push({ trade: t, r: out.r, reachedR: proof.reachedR });
    else reasons[out.ineligible] = (reasons[out.ineligible] ?? 0) + 1;
  }


  return buildResult(strategy, replayed, reasons, all.length, opts);
}

export interface MatchedReplay {
  results: ReplayResult[];
  matchedTradeIds: string[];
  matchedCount: number;
  totalTradeCount: number;
}

export function replayBucketMatched(
  trades: Trade[],
  keys: PairLabFieldKeys,
  strategies: Strategy[],
  opts: ReplayOpts,
): MatchedReplay {
  const all = preparedTrades(trades);
  const bucket = buildBucketConstants(all, keys);
  const ctx = ctxFor(opts, bucket);

  const perStrategy: Array<Map<string, ReplayOutcome>> = strategies.map(() => new Map());
  const proofs = new Map<string, TradeProof>();
  for (const t of all) {
    const proof = extractProof(t, keys);
    proofs.set(t.id, proof);
    strategies.forEach((s, idx) => {
      perStrategy[idx].set(t.id, replayOneTrade(s, t, proof, ctx));
    });
  }

  const matched: Trade[] = all.filter((t) =>
    perStrategy.every((m) => {
      const o = m.get(t.id);
      return o && "r" in o;
    }),
  );
  const matchedIds = matched.map((t) => t.id);
  const matchedIdSet = new Set(matchedIds);

  const results: ReplayResult[] = strategies.map((strategy, idx) => {
    const replayed = matched.map((t) => ({
      trade: t,
      r: (perStrategy[idx].get(t.id) as { r: number }).r,
      reachedR: proofs.get(t.id)?.reachedR ?? 0,
    }));
    // Intersection-only reasons: count only trades that this strategy excluded
    // AND that are NOT in the matched intersection (i.e. trades that genuinely
    // caused the intersection to shrink because of this strategy).
    const reasons: Record<string, number> = {};
    perStrategy[idx].forEach((o, tradeId) => {
      if ("ineligible" in o && !matchedIdSet.has(tradeId)) {
        reasons[o.ineligible] = (reasons[o.ineligible] ?? 0) + 1;
      }
    });
    return buildResult(strategy, replayed, reasons, all.length, opts);
  });


  return {
    results,
    matchedTradeIds: matchedIds,
    matchedCount: matched.length,
    totalTradeCount: all.length,
  };
}

// ----------------------------------------------------------------------------
// Walk-forward split (B7)
//
// Split trades chronologically into in-sample / out-of-sample, choose the
// winner on IS, then report its OOS performance. Surfaces overfitting.
// ----------------------------------------------------------------------------

export interface WalkForwardResult {
  inSampleN: number;
  outOfSampleN: number;
  /** Preset chosen on the in-sample partition. */
  winnerStrategy: Strategy;
  /** Replay of the winner on IS. */
  inSample: ReplayResult;
  /** Replay of the same winner on OOS. */
  outOfSample: ReplayResult;
  /** True when OOS expectancy < 50% of IS expectancy (likely overfit). */
  overfit: boolean;
}

export function walkForwardEvaluate(
  trades: Trade[],
  keys: PairLabFieldKeys,
  strategies: Strategy[],
  opts: ReplayOpts,
  isFrac = 0.7,
): WalkForwardResult | null {
  const all = preparedTrades(trades);
  if (all.length < 20 || strategies.length === 0) return null;
  const cut = Math.max(1, Math.floor(all.length * isFrac));
  const isTrades = all.slice(0, cut);
  const oosTrades = all.slice(cut);
  if (oosTrades.length < 5) return null;

  // Rank presets on IS by expectancyR (insufficient samples demoted).
  const isResults = strategies.map((s) => replayBucket(isTrades, keys, s, opts));
  const ranked = [...isResults].sort((a, b) => {
    const aOk = a.eligibleCount >= MIN_ELIGIBLE_SAMPLE ? 1 : 0;
    const bOk = b.eligibleCount >= MIN_ELIGIBLE_SAMPLE ? 1 : 0;
    if (aOk !== bOk) return bOk - aOk;
    return b.expectancyR - a.expectancyR;
  });
  const winner = ranked[0];
  if (!winner) return null;
  const oos = replayBucket(oosTrades, keys, winner.strategy, opts);
  const overfit =
    winner.expectancyR > 0 &&
    oos.expectancyR < winner.expectancyR * 0.5;

  return {
    inSampleN: isTrades.length,
    outOfSampleN: oosTrades.length,
    winnerStrategy: winner.strategy,
    inSample: winner,
    outOfSample: oos,
    overfit,
  };
}
