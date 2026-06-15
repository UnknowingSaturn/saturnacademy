// ============================================================================
// Pair Lab — Strategy Simulator (proof-based counterfactual replay)
//
// Each preset declares a data contract. A trade is only replayed under that
// preset if the recorded data PROVES the rules would have triggered:
//
//   - Logged MFE ≥ X  → price reached X.            (proof)
//   - tp_reached "X"  → price reached X.            (proof)
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
// ============================================================================

import type { Trade } from "@/types/trading";
import type { PairLabFieldKeys, PropFirmContext } from "@/lib/pairLabMath";
import { bootstrapMeanCi, quantile } from "@/lib/pairLabMath";
import { tickSizeForSymbol, pipSizeForSymbol } from "@/lib/symbolMapping";

/** Default fraction of MFE captured by a trailing stop. */
export const TRAIL_CAPTURE_FRAC = 0.8;

// ----------------------------------------------------------------------------
// Strategy types (unchanged shape for picker/preset back-compat)
// ----------------------------------------------------------------------------

export type SlRule = "original" | "tighten_to_ideal" | "widen_to_mae_p75_x_1_15";
export type RunnerRule = "trail_to_mfe" | "be_after_first_tp" | "all_out_at_last_partial";

export interface ExitRule {
  /** Partials sorted ascending by atR. Fractions must sum to ≤1. */
  partials: Array<{ atR: number; fraction: number }>;
  runner: RunnerRule;
}

export interface Strategy {
  id: string;
  label: string;
  description?: string;
  riskPct: number;
  slRule: SlRule;
  exitRule: ExitRule;
  /** Special preset: replay using the trade's actual r_multiple, ignoring rules. */
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
  /** Trades actually replayed (eligible under this preset's data contract). */
  n: number;
  /** Total closed trades considered before the eligibility filter. */
  totalTradeCount: number;
  /** Eligible trade count = n. Convenience alias for UI clarity. */
  eligibleCount: number;
  /** Trades excluded because their recorded data could not prove the rules. */
  ineligibleCount: number;
  /** Counts per exclusion reason (human-readable). */
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
  /** Mean of proven `reachedR` across this preset's eligible sample (self-selection diagnostic). */
  meanReachedR: number | null;
  equityCurve: Array<{ i: number; equity: number; at: string | null }>;
  perTrade: ReplayPerTrade[];
  propFirmVerdict: "pass" | "bust_daily" | "bust_total" | "n/a";
  bustNote: string | null;
  /** Bootstrap 95% CI on expectancy R, null when n < 5. */
  expectancyRCi: [number, number] | null;
  /** Bootstrap 95% CI on total $ (derived from expectancyR CI × n × dollarRisk). */
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

function multiSelectCf(trade: any, key: string | null): string[] {
  const v = getCf(trade, key);
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v) return [v];
  return [];
}

/** Parse strings like "1:2", "1R", "2", "TP2" → R-multiple. */
function parseTpLabel(s: string): number | null {
  if (!s) return null;
  const clean = s.trim().toUpperCase();
  const ratio = clean.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (ratio) {
    const a = Number(ratio[1]), b = Number(ratio[2]);
    if (a > 0) return b / a;
  }
  const tp = clean.match(/^TP\s*(\d+(?:\.\d+)?)$/);
  if (tp) return Number(tp[1]);
  const num = clean.match(/^(\d+(?:\.\d+)?)R?$/);
  if (num) return Number(num[1]);
  return null;
}

function maxTpReached(trade: Trade, keys: PairLabFieldKeys): number | null {
  const labels = multiSelectCf(trade as any, keys.tpReached);
  if (labels.length === 0) return null;
  const rs = labels.map(parseTpLabel).filter((v): v is number => v != null && v > 0);
  if (rs.length === 0) return null;
  return Math.max(...rs);
}

/**
 * Distance from entry to initial stop, expressed in broker ticks.
 * Returns null when SL or entry are missing so callers can mark the trade
 * ineligible rather than silently treating it as 0.
 */
export function slDistanceTicks(t: Trade): number | null {
  if (t.sl_initial == null || t.entry_price == null || !t.symbol) return null;
  const tick = tickSizeForSymbol(t.symbol);
  if (!(tick > 0)) return null;
  const distance = Math.abs(t.entry_price - t.sl_initial);
  if (!(distance > 0)) return null;
  return distance / tick;
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

/** MAE-pips → MAE in R-multiples of the original SL. Null when SL/entry missing. */
export function tradeMaeR(t: Trade, maePips: number | null): number | null {
  if (maePips == null) return null;
  const slPips = slDistancePips(t);
  if (slPips == null || slPips <= 0) return null;
  return Math.abs(maePips) / slPips;
}

/** Ideal-SL pips → scale multiplier against original SL distance (clamped 0.2..2). */
export function idealSlScaleFor(t: Trade, idealPips: number | null): number | null {
  if (idealPips == null) return null;
  const slPips = slDistancePips(t);
  if (slPips == null || slPips <= 0) return null;
  return Math.max(0.2, Math.min(2, idealPips / slPips));
}


// ----------------------------------------------------------------------------
// Per-trade proof extraction
// ----------------------------------------------------------------------------

interface TradeProof {
  /** Proven max R reached (max of MFE, tp_reached, max(0, r_actual)). */
  reachedR: number;
  /** Has any proof of reach (any of the three signals present). */
  hasReachProof: boolean;
  /** true=stopped at ≥1R, false=did not stop, null=unknown. */
  stoppedOut: boolean | null;
  /** Logged MFE in original R (null if unrecorded). */
  loggedMfe: number | null;
  /** Logged MAE magnitude in original R (null if unrecorded). */
  loggedMae: number | null;
  hasActualR: boolean;
  rActual: number;
  /** SL scale for tighten_to_ideal rule, null if unrecorded. */
  idealSlScale: number | null;
}

function extractProof(trade: Trade, keys: PairLabFieldKeys): TradeProof {
  const loggedMfeRaw = numericCf(trade as any, keys.mfe);
  // MFE is logged in R-multiple by the user.
  const loggedMfe = loggedMfeRaw != null ? Math.max(0, loggedMfeRaw) : null;

  // MAE is logged in broker TICKS (TradingView position-calc). Convert to R
  // using each trade's own SL distance so all downstream comparisons are in
  // the same unit as MFE / r_actual / slScale.
  const loggedMaeRawTicks = numericCf(trade as any, keys.mae);
  const loggedMae = tradeMaeR(trade, loggedMaeRawTicks);

  const tpHit = maxTpReached(trade, keys);
  const rActual = trade.r_multiple_actual;
  const hasActualR = rActual != null;

  const proofs: number[] = [];
  if (loggedMfe != null) proofs.push(loggedMfe);
  if (tpHit != null) proofs.push(tpHit);
  if (hasActualR && (rActual as number) > 0) proofs.push(rActual as number);
  const reachedR = proofs.length ? Math.max(...proofs) : 0;
  const hasReachProof = proofs.length > 0;

  // Stop-out detection. Prefer the converted MAE; only fall back to r_actual
  // when MAE is unavailable, and treat the ambiguous band [-1.05, -0.95] as
  // unknown (can't prove the stop fired vs. a discretionary close near -1R).
  let stoppedOut: boolean | null = null;
  if (loggedMae != null) {
    stoppedOut = loggedMae >= 1;
  } else if (hasActualR) {
    const r = rActual as number;
    if (r <= -1.05) stoppedOut = true;
    else if (r >= -0.95) stoppedOut = false;
    else stoppedOut = null; // ambiguous
  }

  // Ideal SL is logged in TICKS — convert to scale vs original SL.
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
  maeP75: number | null; // in R-multiple, used only by the widen-SL rule
}

function buildBucketConstants(trades: Trade[], keys: PairLabFieldKeys): BucketConstants {
  // p75 of MAE in R (per-trade conversion). Trades without SL/entry are skipped.
  const maes = trades
    .map((t) => tradeMaeR(t, numericCf(t as any, keys.mae)))
    .filter((v): v is number => v != null && Number.isFinite(v));
  return { maeP75: quantile(maes, 0.75) };
}


function replayOneTrade(
  strategy: Strategy,
  trade: Trade,
  proof: TradeProof,
  bucket: BucketConstants,
): ReplayOutcome {
  // Actual-behavior preset uses recorded r_actual directly.
  if (strategy.useActualOutcome) {
    return proof.hasActualR ? { r: proof.rActual } : { ineligible: "no recorded r_actual" };
  }

  // ---- SL rule → slScale (multiplier vs original SL distance) ----
  let slScale: number;
  if (strategy.slRule === "original") {
    slScale = 1;
  } else if (strategy.slRule === "tighten_to_ideal") {
    if (proof.idealSlScale == null) return { ineligible: "missing SL/entry or ideal-SL — can't convert ticks to R" };
    slScale = proof.idealSlScale;
  } else {
    // widen_to_mae_p75_x_1_15
    if (bucket.maeP75 == null) return { ineligible: "no MAE samples in bucket for widen rule" };
    slScale = Math.max(1, bucket.maeP75 * 1.15);
  }

  // ---- Did the trade stop out under the NEW SL? ----
  let stoppedUnderNewSl: boolean | null;
  if (proof.loggedMae != null) {
    stoppedUnderNewSl = proof.loggedMae >= slScale;
  } else if (slScale <= 1) {
    // Tighter or same SL. If original stopped at MAE ≥ 1, it definitely stops at slScale ≤ 1.
    if (proof.stoppedOut === true) stoppedUnderNewSl = true;
    else if (proof.stoppedOut === false && slScale === 1) stoppedUnderNewSl = false;
    else stoppedUnderNewSl = null;
  } else {
    // Wider SL than original. If original didn't stop at MAE ≥ 1, it doesn't stop at >1 either.
    if (proof.stoppedOut === false) stoppedUnderNewSl = false;
    else stoppedUnderNewSl = null;
  }
  if (stoppedUnderNewSl === null) return { ineligible: "missing SL/entry — can't convert MAE ticks to R" };


  // ---- Walk partials in ascending atR ----
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
      // Trade neither reached this target NOR stopped out. Honest answer: unknown.
      return { ineligible: `unproven ${p.atR}R target` };
    }
  }

  // ---- Runner on the remaining fraction ----
  if (remainingFrac > 0) {
    if (stoppedUnderNewSl && !anyFilled) {
      booked += -1 * remainingFrac;
    } else if (stoppedUnderNewSl && anyFilled) {
      if (strategy.exitRule.runner === "be_after_first_tp") {
        booked += 0;
      } else if (strategy.exitRule.runner === "all_out_at_last_partial") {
        booked += lastFilledAtR * remainingFrac;
      } else {
        // trail_to_mfe: runner gets trailed, then stopped out somewhere
        if (proof.loggedMfe == null) return { ineligible: "no MFE for trail runner" };
        const mfeNewR = proof.loggedMfe / slScale;
        // Documented trail-capture assumption (default 80%). Floored at -1R.
        booked += Math.max(-1, TRAIL_CAPTURE_FRAC * mfeNewR) * remainingFrac;
      }
    } else {
      // Not stopped — runner exits on its rule
      if (strategy.exitRule.runner === "be_after_first_tp") {
        booked += 0;
      } else if (strategy.exitRule.runner === "all_out_at_last_partial") {
        booked += lastFilledAtR * remainingFrac;
      } else {
        // trail_to_mfe needs MFE
        if (proof.loggedMfe == null) return { ineligible: "no MFE for trail runner" };
        const mfeNewR = proof.loggedMfe / slScale;
        booked += TRAIL_CAPTURE_FRAC * mfeNewR * remainingFrac;
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
}

/** Minimum eligible sample size before preset comparisons are trustworthy. */
export const MIN_ELIGIBLE_SAMPLE = 10;
/** Minimum matched-sample intersection size for Compare view. */
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

  // Prop-firm verdict
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
    equityCurve,
    perTrade,
    propFirmVerdict: verdict,
    bustNote,
    expectancyRCi,
    totalDollarsCi,
  };
}


/** Closed, non-archived, chronologically sorted closed trades. */
function preparedTrades(trades: Trade[]): Trade[] {
  return trades
    .filter((t) => !t.is_open && !t.is_archived && t.net_pnl != null)
    .sort((a, b) => String(a.entry_time ?? "").localeCompare(String(b.entry_time ?? "")));
}

/** Replay a single strategy over its native eligible sample. */
export function replayBucket(
  trades: Trade[],
  keys: PairLabFieldKeys,
  strategy: Strategy,
  opts: ReplayOpts,
): ReplayResult {
  const all = preparedTrades(trades);
  const bucket = buildBucketConstants(all, keys);
  const replayed: Array<{ trade: Trade; r: number; reachedR: number }> = [];
  const reasons: Record<string, number> = {};

  for (const t of all) {
    const proof = extractProof(t, keys);
    const out = replayOneTrade(strategy, t, proof, bucket);
    if ("r" in out) replayed.push({ trade: t, r: out.r, reachedR: proof.reachedR });
    else reasons[out.ineligible] = (reasons[out.ineligible] ?? 0) + 1;
  }


  return buildResult(strategy, replayed, reasons, all.length, opts);
}

export interface MatchedReplay {
  results: ReplayResult[];
  /** Trade IDs eligible under EVERY strategy. */
  matchedTradeIds: string[];
  matchedCount: number;
  totalTradeCount: number;
}

/** Replay multiple strategies on the matched-sample intersection. */
export function replayBucketMatched(
  trades: Trade[],
  keys: PairLabFieldKeys,
  strategies: Strategy[],
  opts: ReplayOpts,
): MatchedReplay {
  const all = preparedTrades(trades);
  const bucket = buildBucketConstants(all, keys);

  // Per-strategy outcomes per trade, plus per-trade proof for reachedR diagnostics.
  const perStrategy: Array<Map<string, ReplayOutcome>> = strategies.map(() => new Map());
  const proofs = new Map<string, TradeProof>();
  for (const t of all) {
    const proof = extractProof(t, keys);
    proofs.set(t.id, proof);
    strategies.forEach((s, idx) => {
      perStrategy[idx].set(t.id, replayOneTrade(s, t, proof, bucket));
    });
  }

  // Intersection: trade eligible under every strategy
  const matched: Trade[] = all.filter((t) =>
    perStrategy.every((m) => {
      const o = m.get(t.id);
      return o && "r" in o;
    }),
  );
  const matchedIds = matched.map((t) => t.id);

  const results: ReplayResult[] = strategies.map((strategy, idx) => {
    const replayed = matched.map((t) => ({
      trade: t,
      r: (perStrategy[idx].get(t.id) as { r: number }).r,
      reachedR: proofs.get(t.id)?.reachedR ?? 0,
    }));
    // For matched mode, ineligible reasons are aggregated across the strategy's full set
    // (not just the matched sample) so the user sees why the intersection shrank.
    const reasons: Record<string, number> = {};
    perStrategy[idx].forEach((o) => {
      if ("ineligible" in o) reasons[o.ineligible] = (reasons[o.ineligible] ?? 0) + 1;
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
