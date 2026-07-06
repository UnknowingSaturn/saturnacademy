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
import { bootstrapMeanCiBCa, pathProbTpFirst, resolveTpFirstProb, type ReplayMode } from "../../shared/quant/stats";
export type { ReplayMode } from "../../shared/quant/stats";
import { pipSizeForSymbol, ticksToPips } from "@/lib/symbolMapping";
import {
  MAE_P75_WIDEN_BUFFER,
  TRAIL_CAPTURE_FALLBACK,
  MIN_PROVEN_SAMPLE,
  WALK_FORWARD_KFOLD_MIN_N,
  WALK_FORWARD_SPLIT_MIN_N,
  WALK_FORWARD_KFOLDS,
  RISK_TOLERANCE_R_DEFAULT,
} from "../../shared/quant/config";


/** Default fraction of MFE captured by a trailing stop when no empirical estimate is available.
 *  S2.11: single source of truth lives in `shared/quant/config.ts:TRAIL_CAPTURE_FALLBACK`.
 *  Re-exported under the historical name for back-compat with existing imports. */
export const TRAIL_CAPTURE_FRAC = TRAIL_CAPTURE_FALLBACK;

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

export interface AppliedTpLeg {
  atR: number;
  fraction: number;
  source: AtRSource;
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
  /**
   * Per-trade R info ratio = mean(R) / stddev(R).
   * NOT an annualized Sharpe — no frequency scaling is applied. Use for
   * relative comparison between presets within this simulator only.
   */
  perTradeEdgeRatio: number | null;
  /**
   * Per-trade R Sortino-style ratio = mean(R) / downside-stddev(R, target=0).
   * NOT annualized. Use for relative comparison within this simulator only.
   */
  perTradeSortinoRatio: number | null;
  equityCurve: Array<{ i: number; equity: number; at: string | null }>;
  /** Underwater equity curve: equity - runningMax(equity). Always ≤ 0. */
  underwaterCurve: Array<{ i: number; underwater: number }>;
  perTrade: ReplayPerTrade[];
  propFirmVerdict: "pass" | "bust_daily" | "bust_total" | "n/a";
  bustNote: string | null;
  expectancyRCi: [number, number] | null;
  /**
   * Bootstrap 95% CI on mean per-trade $ P&L (= expectancyR × dollarRisk).
   * Replaces the old `totalDollarsCi` which incorrectly scaled a mean-CI
   * by `n` (CI width grew with sample size instead of shrinking).
   */
  meanDollarsCi: [number, number] | null;
  /** Median SL distance actually applied to eligible trades, in pips. */
  appliedSlPipsMedian: number | null;
  /** Inter-quartile range (p25, p75) of applied SL in pips. */
  appliedSlPipsRange: [number, number] | null;
  /**
   * Median SL scale actually applied, in R (dimensionless — 1.0 = original
   * stop, 1.15 = 15% wider, 0.60 = 40% tighter). Unlike appliedSlPipsMedian
   * this is comparable across symbols, so it's the number the ranker should
   * display on multi-symbol buckets.
   */
  appliedSlScaleMedian: number | null;
  /** Resolved TP ladder. For adaptive presets, atR reflects the bucket statistic. */
  appliedTpLadder: AppliedTpLeg[];
  /** Plain-English label for the SL rule. */
  slRuleLabel: string;
  /** Plain-English label for the runner rule. */
  runnerLabel: string;
  /**
   * BCa (bias-corrected & accelerated) 95% CI on expectancy R. Wider and
   * more honest than `expectancyRCi` at n < 30, which the ranker mostly
   * lives at. `expectancyRCi` stays as the plain percentile fallback.
   */
  expectancyRCiBCa: [number, number] | null;
  /** Composite score used by the ranker to sort (higher = better). */
  compositeScore: number | null;
}


export const SL_RULE_LABELS: Record<SlRule, string> = {
  original: "Use original stop",
  tighten_to_ideal: "Tighten to recorded ideal-SL",
  widen_to_mae_p75_x_1_15: "Widen to bucket MAE p75 × 1.15",
};

export const RUNNER_LABELS: Record<RunnerRule, string> = {
  trail_to_mfe: "Trail runner to MFE",
  be_after_first_tp: "Move runner to breakeven after first TP",
  all_out_at_last_partial: "Close runner with last partial",
};

export const TP_SOURCE_LABELS: Record<AtRSource, string> = {
  fixed: "fixed",
  bucket_mfe_p50: "adaptive · MFE p50",
  bucket_mfe_p60: "adaptive · MFE p60",
  bucket_mfe_p75: "adaptive · MFE p75",
};

// ----------------------------------------------------------------------------
// Field readers — single source of truth lives in shared/quant/stats.
// M12 cleanup: dropped the local byte-for-byte copy so future tweaks to the
// shared `numericCf` (string-numbers, locale parsing, etc.) propagate here.
// ----------------------------------------------------------------------------

import { numericCf } from "../../shared/quant/stats";


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

type ReplayOutcome = { r: number; slPips: number | null; slScale: number } | { ineligible: string };

interface BucketConstants {
  maeP75: number | null;
  mfeP50: number | null;
  mfeP60: number | null;
  mfeP75: number | null;
}

interface ReplayContext {
  bucket: BucketConstants;
  trailCapture: number;
  /** Path-ordering assumption when a trade breaches both counterfactual TP and SL.
   *  See `pathProbTpFirst` in shared/quant/stats.ts. Defaults to "expected". */
  replayMode: ReplayMode;
}

function buildBucketConstants(trades: Trade[], keys: PairLabFieldKeys): BucketConstants {
  const maes = trades
    .map((t) => tradeMaeR(t, numericCf(t as any, keys.mae)))
    .filter((v): v is number => v != null && Number.isFinite(v));
  const mfes = trades
    .map((t) => {
      const v = numericCf(t as any, keys.mfe);
      return v != null ? Math.max(0, v) : null;
    })
    .filter((v): v is number => v != null && Number.isFinite(v));
  return {
    maeP75: quantile(maes, 0.75),
    mfeP50: quantile(mfes, 0.5),
    mfeP60: quantile(mfes, 0.6),
    mfeP75: quantile(mfes, 0.75),
  };
}

/** Resolve a partial's atR, honoring bucket-adaptive sources. Returns null when
 *  the bucket lacks the required stat (caller marks the trade ineligible). */
function resolvePartialAtR(p: { atR: number; atRSource?: AtRSource }, bucket: BucketConstants): number | null {
  switch (p.atRSource ?? "fixed") {
    case "bucket_mfe_p50": return bucket.mfeP50 != null && bucket.mfeP50 > 0 ? bucket.mfeP50 : null;
    case "bucket_mfe_p60": return bucket.mfeP60 != null && bucket.mfeP60 > 0 ? bucket.mfeP60 : null;
    case "bucket_mfe_p75": return bucket.mfeP75 != null && bucket.mfeP75 > 0 ? bucket.mfeP75 : null;
    default: return p.atR;
  }
}


function replayOneTrade(
  strategy: Strategy,
  trade: Trade,
  proof: TradeProof,
  ctx: ReplayContext,
): ReplayOutcome {
  if (strategy.useActualOutcome) {
    if (!proof.hasActualR) return { ineligible: "no recorded r_actual" };
    return { r: proof.rActual, slPips: slDistancePips(trade), slScale: 1 };
  }

  // BE-after-TP runner needs at least one partial to have a TP to move stops
  // behind. Without partials a BE runner would silently exit at 0R on every
  // non-stopped trade, which would massively understate strategy P&L. Pure-
  // trail presets (no partials, runner=trail_to_mfe) are allowed and handled
  // by the !anyFilled branches below.
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
    slScale = Math.max(1, ctx.bucket.maeP75 * MAE_P75_WIDEN_BUFFER);
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


  // Resolve each partial's effective atR (bucket-adaptive presets may override).
  const resolved: Array<{ atR: number; fraction: number }> = [];
  for (const p of strategy.exitRule.partials) {
    const atR = resolvePartialAtR(p, ctx.bucket);
    if (atR == null) {
      return { ineligible: `bucket has no MFE samples for adaptive TP (${p.atRSource})` };
    }
    resolved.push({ atR, fraction: p.fraction });
  }
  resolved.sort((a, b) => a.atR - b.atR);

  let booked = 0;
  let remainingFrac = 1;
  let anyFilled = false;
  let lastFilledAtR = 0;
  /** First partial whose TP was breached by MFE. Drives the bridge probability
   *  when the stop was ALSO breached — that's the ambiguous ordering case. */
  let firstBreachedTpR: number | null = null;
  for (const p of resolved) {
    const needOrigR = p.atR * slScale;
    if (proof.reachedR >= needOrigR) {
      const take = Math.min(p.fraction, remainingFrac);
      booked += p.atR * take;
      remainingFrac -= take;
      anyFilled = true;
      lastFilledAtR = p.atR;
      if (firstBreachedTpR == null) firstBreachedTpR = p.atR;
    }
    // Otherwise: partial did not fill. Do NOT drop the trade here — the
    // runner block below books the honest outcome using proven-reached R
    // (previously an early `ineligible: "unproven target"` return caused
    // massive survivorship bias, since only trades that hit every target
    // survived → fake 100% WRs on TP-heavy presets).
  }

  const maxTargetAtR = resolved.length ? resolved[resolved.length - 1].atR : 0;

  if (remainingFrac > 0) {
    if (stoppedUnderNewSl && !anyFilled) {
      booked += -1 * remainingFrac;
    } else if (stoppedUnderNewSl && anyFilled) {
      if (strategy.exitRule.runner === "be_after_first_tp") {
        booked += 0;
      } else if (strategy.exitRule.runner === "all_out_at_last_partial") {
        // S4.6: when a partial filled and the price then stopped under the
        // NEW SL, the runner exited at the stop — not at the previous TP.
        // Booking `lastFilledAtR * remainingFrac` overstated expectancy by
        // `(lastFilledAtR + slScale) × remainingFrac` on every such trade.
        booked += -slScale * remainingFrac;
      } else {
        if (proof.loggedMfe == null) return { ineligible: "no MFE for trail runner" };
        const mfeNewR = proof.loggedMfe / slScale;
        booked += Math.max(-1, ctx.trailCapture * mfeNewR) * remainingFrac;
      }
    } else {
      // Not stopped under the new SL.
      const reachedNewR = proof.reachedR / slScale;
      if (strategy.exitRule.runner === "be_after_first_tp") {
        // Runner sat at BE (if a TP filled) or at the original SL (if no TP
        // filled — BE was never armed). Either way, on a non-stopped trade
        // that didn't fully complete the ladder, 0 is the conservative
        // book — we don't know where the trader would have manually exited.
        booked += 0;
      } else if (strategy.exitRule.runner === "all_out_at_last_partial") {
        if (anyFilled) {
          booked += lastFilledAtR * remainingFrac;
        } else {
          // No partial filled and trade didn't stop — book proven-reached R
          // in new-R units, capped at the last-partial target (rule would
          // have exited there at the latest).
          booked += Math.min(reachedNewR, maxTargetAtR) * remainingFrac;
        }
      } else {
        if (proof.loggedMfe == null) return { ineligible: "no MFE for trail runner" };
        const mfeNewR = proof.loggedMfe / slScale;
        booked += ctx.trailCapture * mfeNewR * remainingFrac;
      }
    }

  }

  // PR-1 — MFE-vs-MAE ordering fix (Brownian-bridge / gambler's-ruin mixture).
  //
  // When a partial's TP AND the counterfactual SL BOTH breached, the code
  // above assumed TP-first (the legacy behaviour). That inflated WR on early-
  // TP presets. Blend `booked` (TP-first realisation) with a full-stop
  // realisation (-slScale on the whole position) using the classical
  // first-passage probability of a symmetric random walk between two barriers.
  //
  // Ambiguity only exists when at least one partial's TP was breached AND the
  // trade also breached the new SL. Deterministic branches (only TP breached,
  // only SL breached, neither) pass through unchanged (pStopFirst = 0).
  if (stoppedUnderNewSl && firstBreachedTpR != null && proof.loggedMae != null) {
    const mfeForBridge = proof.loggedMfe ?? proof.reachedR;
    const mfeInNewR = mfeForBridge / slScale;
    const maeInNewR = proof.loggedMae / slScale;
    const pTpFirstRaw = pathProbTpFirst(firstBreachedTpR, 1, mfeInNewR, maeInNewR);
    const pTpFirst = resolveTpFirstProb(pTpFirstRaw, ctx.replayMode);
    const pStopFirst = 1 - pTpFirst;
    if (pStopFirst > 0) {
      // SL-first alternative: whole position stops, no partial ever books.
      const bookedSlFirst = -slScale;
      booked = pTpFirst * booked + pStopFirst * bookedSlFirst;
    }
  }

  const baseSlPips = slDistancePips(trade);
  const slPipsApplied = baseSlPips != null ? baseSlPips * slScale : null;
  return { r: booked, slPips: slPipsApplied, slScale };
}

// ----------------------------------------------------------------------------
// Bucket-level replay
// ----------------------------------------------------------------------------

export interface ReplayOpts {
  balance: number;
  propFirm: PropFirmContext | null;
  /** Empirically-derived trail capture ratio (overrides TRAIL_CAPTURE_FRAC). */
  trailCapture?: number;
  /** PR-1 — path-ordering assumption when a trade breaches both counterfactual
   *  TP and SL. "expected" uses the Brownian-bridge probability; "optimistic"
   *  = TP-first (legacy behaviour); "pessimistic" = SL-first (safety floor). */
  replayMode?: ReplayMode;
}

export const MIN_ELIGIBLE_SAMPLE = 10;

function buildResult(
  strategy: Strategy,
  replayed: Array<{ trade: Trade; r: number; reachedR?: number; slPips?: number | null; slScale?: number }>,
  ineligibleReasons: Record<string, number>,
  totalTradeCount: number,
  opts: ReplayOpts,
  appliedTpLadder: AppliedTpLeg[],
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
  const perTradeEdgeRatio = sd > 0 ? expectancyR / sd : null;
  const perTradeSortinoRatio = sdDown > 0 ? expectancyR / sdDown : null;

  let verdict: ReplayResult["propFirmVerdict"] = "n/a";
  let bustNote: string | null = null;
  if (opts.propFirm && opts.propFirm.dailyLossDollars != null && opts.propFirm.dailyLossDollars > 0) {
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
  const expectancyRCiBCa = bootstrapMeanCiBCa(rs);
  const meanDollarsCi: [number, number] | null = expectancyRCi
    ? [expectancyRCi[0] * dollarRisk, expectancyRCi[1] * dollarRisk]
    : null;

  const ineligibleCount = Object.values(ineligibleReasons).reduce((a, b) => a + b, 0);

  const slPipsSamples = replayed
    .map((x) => x.slPips)
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
  const appliedSlPipsMedian = slPipsSamples.length ? quantile(slPipsSamples, 0.5) : null;
  const slP25 = slPipsSamples.length ? quantile(slPipsSamples, 0.25) : null;
  const slP75 = slPipsSamples.length ? quantile(slPipsSamples, 0.75) : null;
  const appliedSlPipsRange: [number, number] | null =
    slP25 != null && slP75 != null ? [slP25, slP75] : null;

  const slScaleSamples = replayed
    .map((x) => x.slScale)
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
  const appliedSlScaleMedian = slScaleSamples.length ? quantile(slScaleSamples, 0.5) : null;

  // Composite score is set later by the ranker orchestrator (needs cross-preset
  // context to compute the drawdown/sample penalties consistently). Left null
  // when computed from a raw replayBucket() call.
  const compositeScore: number | null = null;

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
    perTradeEdgeRatio,
    perTradeSortinoRatio,
    equityCurve,
    underwaterCurve: underwater,
    perTrade,
    propFirmVerdict: verdict,
    bustNote,
    expectancyRCi,
    expectancyRCiBCa,
    meanDollarsCi,
    appliedSlPipsMedian,
    appliedSlPipsRange,
    appliedSlScaleMedian,
    appliedTpLadder,
    slRuleLabel: SL_RULE_LABELS[strategy.slRule],
    runnerLabel: RUNNER_LABELS[strategy.exitRule.runner],
    compositeScore,
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
    replayMode: opts.replayMode ?? "expected",
  };
}

/** Resolve the displayable TP ladder for a strategy given a bucket. Adaptive
 *  partials get their bucket-resolved atR. Returns [] when the bucket lacks the
 *  required stat (UI shows "—"). */
function buildAppliedTpLadder(strategy: Strategy, bucket: BucketConstants): AppliedTpLeg[] {
  if (strategy.useActualOutcome) return [];
  const out: AppliedTpLeg[] = [];
  for (const p of strategy.exitRule.partials) {
    const source: AtRSource = p.atRSource ?? "fixed";
    const resolved = resolvePartialAtR(p, bucket);
    if (resolved == null) continue;
    out.push({ atR: resolved, fraction: p.fraction, source });
  }
  return out.sort((a, b) => a.atR - b.atR);
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
  const replayed: Array<{ trade: Trade; r: number; reachedR: number; slPips: number | null; slScale: number }> = [];
  const reasons: Record<string, number> = {};

  for (const t of all) {
    const proof = extractProof(t, keys);
    const out = replayOneTrade(strategy, t, proof, ctx);
    if ("r" in out) replayed.push({ trade: t, r: out.r, reachedR: proof.reachedR, slPips: out.slPips, slScale: out.slScale });
    else reasons[out.ineligible] = (reasons[out.ineligible] ?? 0) + 1;
  }

  const ladder = buildAppliedTpLadder(strategy, bucket);
  return buildResult(strategy, replayed, reasons, all.length, opts, ladder);
}

// ----------------------------------------------------------------------------
// Ranker eligibility — strict "has MFE AND MAE AND SL" filter
// ----------------------------------------------------------------------------
//
// The ranker's denominator across every preset. Trades missing MFE, MAE, SL or
// entry price get no chance to fit any preset that depends on those fields —
// letting them into the pool drowns the sample in exclusions and makes every
// row look under-sampled. This is the single source of truth so the "why
// excluded" panel, the k-fold splitter, and the ranker table all agree.

export interface ExclusionBreakdown {
  total: number;
  openOrArchived: number;
  noPnl: number;
  missingMfe: number;
  missingMae: number;
  missingSl: number;
  eligible: number;
}

function hasNumericCf(t: Trade, key: string | null): boolean {
  if (!key) return false;
  const v = numericCf(t as any, key);
  return v != null && Number.isFinite(v);
}

/** Strict eligibility: trade is closed, has P&L, and carries MFE + MAE + SL + entry. */
export function isRankerEligible(t: Trade, keys: PairLabFieldKeys): boolean {
  if (t.is_open || t.is_archived) return false;
  if (t.net_pnl == null) return false;
  if (t.sl_initial == null || t.entry_price == null) return false;
  if (!hasNumericCf(t, keys.mfe)) return false;
  if (!hasNumericCf(t, keys.mae)) return false;
  return true;
}

/** Chronologically sorted trades that pass the ranker's strict eligibility. */
export function rankerEligibleTrades(trades: Trade[], keys: PairLabFieldKeys): Trade[] {
  return trades
    .filter((t) => isRankerEligible(t, keys))
    .sort((a, b) => String(a.entry_time ?? "").localeCompare(String(b.entry_time ?? "")));
}

/** Non-mutating audit of why trades didn't make the ranker pool. Powers the
 *  "why excluded" panel. Counts are non-exclusive (a trade missing both MFE
 *  and MAE increments both), so `eligible + Σ(missing*)` may exceed `total`. */
export function computeExclusionBreakdown(
  trades: Trade[],
  keys: PairLabFieldKeys,
): ExclusionBreakdown {
  const b: ExclusionBreakdown = {
    total: trades.length,
    openOrArchived: 0,
    noPnl: 0,
    missingMfe: 0,
    missingMae: 0,
    missingSl: 0,
    eligible: 0,
  };
  for (const t of trades) {
    if (t.is_open || t.is_archived) { b.openOrArchived += 1; continue; }
    if (t.net_pnl == null) { b.noPnl += 1; continue; }
    let missing = false;
    if (t.sl_initial == null || t.entry_price == null) { b.missingSl += 1; missing = true; }
    if (!hasNumericCf(t, keys.mfe)) { b.missingMfe += 1; missing = true; }
    if (!hasNumericCf(t, keys.mae)) { b.missingMae += 1; missing = true; }
    if (!missing) b.eligible += 1;
  }
  return b;
}

// ----------------------------------------------------------------------------
// Composite score (risk-adjusted, sample-aware)
// ----------------------------------------------------------------------------
//
// score = expLowerCI × penalty(drawdown) × penalty(sample)
//   - expLowerCI: lower BCa 95% bound on expectancy R. Rewards presets whose
//     edge is robustly positive under bootstrap; a preset that got lucky on a
//     small sample gets a wide CI and thus a low (or negative) score.
//   - penalty(dd) = 1 / (1 + max_dd_R / risk_tolerance_R). Discounts strategies
//     that would have blown a comfortable account drawdown budget.
//   - penalty(sample) = min(1, n / MIN_PROVEN_SAMPLE). Smooth ramp so an 8-
//     trade preset can't beat a 30-trade preset on noise.
// Presets with insufficient data (no CI, no R samples) get null → sort last.

export function computeCompositeScore(
  r: ReplayResult,
  dollarRisk: number,
  riskToleranceR = RISK_TOLERANCE_R_DEFAULT,
): number | null {
  if (r.n === 0) return null;
  const ci = r.expectancyRCiBCa ?? r.expectancyRCi;
  if (!ci) return null;
  const expLower = ci[0];
  const maxDdR = dollarRisk > 0 ? Math.abs(r.maxDrawdownDollars) / dollarRisk : 0;
  const ddPenalty = 1 / (1 + maxDdR / Math.max(1, riskToleranceR));
  // PR-2 (2G): switch from a linear ramp that plateaus at n=MIN_PROVEN_SAMPLE
  // to a diminishing-returns curve that keeps rewarding sample growth. Under
  // the old min(1, n/10) a 10-trade preset and a 100-trade preset got the
  // same sample factor. New curve: 0.50 at n=10, 0.63 at n=30, 0.76 at n=100.
  // Composite is still bounded (0..1) and non-negative.
  const samplePenalty = r.n > 0
    ? 1 - 1 / (1 + Math.sqrt(r.n / MIN_PROVEN_SAMPLE))
    : 0;
  return expLower * ddPenalty * samplePenalty;
}

// ----------------------------------------------------------------------------
// Chronological k-fold walk-forward
// ----------------------------------------------------------------------------
//
// For each fold i ∈ 2..k, bucket constants (MAE p75, MFE p50/60/75, trail
// capture) are re-estimated on blocks 1..i-1 only, then the preset is scored
// on block i. The scored (OOS-only) tapes are concatenated into a single
// `ReplayResult`. This eliminates the in-sample leak where the old default
// mode both estimated bucket constants and scored trades against the whole
// history.
//
// Requirements:
//   - N ≥ WALK_FORWARD_KFOLD_MIN_N (25) — otherwise caller should fall back
//     to a single 70/30 split via `walkForwardEvaluate`.
//   - Block 1 is warm-up (never scored); blocks 2..k are OOS scored.

/** Estimate trail capture on the given trade slice; falls back to the
 *  configured default when < 10 qualifying winners are present. Kept local to
 *  the simulator so we don't have to thread `estimateTrailCapture` through
 *  every call site. */
function estimateTrailCaptureLocal(trades: Trade[], keys: PairLabFieldKeys): number {
  const ratios: number[] = [];
  for (const t of trades) {
    if (t.is_open || t.is_archived) continue;
    const mfe = numericCf(t as any, keys.mfe);
    const r = t.r_multiple_actual;
    if (mfe == null || r == null) continue;
    if (!(mfe > 0) || !(r > 0)) continue;
    if (mfe - r < 0.1) continue;
    const ratio = r / mfe;
    if (ratio > 0 && ratio < 1.05) ratios.push(ratio);
  }
  if (ratios.length < 10) return TRAIL_CAPTURE_FRAC;
  const m = quantile(ratios, 0.5);
  if (m == null || !(m > 0)) return TRAIL_CAPTURE_FRAC;
  return Math.max(0.1, Math.min(0.95, m));
}

export function walkForwardKFold(
  trades: Trade[],
  keys: PairLabFieldKeys,
  strategy: Strategy,
  opts: ReplayOpts,
  k: number = WALK_FORWARD_KFOLDS,
): ReplayResult | null {
  const all = rankerEligibleTrades(trades, keys);
  if (all.length < WALK_FORWARD_KFOLD_MIN_N) return null;

  const foldSize = Math.floor(all.length / k);
  if (foldSize < 2) return null;

  const replayed: Array<{ trade: Trade; r: number; reachedR: number; slPips: number | null; slScale: number }> = [];
  const reasons: Record<string, number> = {};
  // Track the last fold's bucket for the displayed TP ladder (represents the
  // most recent train-slice inference — what the user's next trade would use).
  let lastBucket: BucketConstants | null = null;

  for (let i = 1; i < k; i++) {
    const trainEnd = i * foldSize;
    const testStart = trainEnd;
    const testEnd = i === k - 1 ? all.length : trainEnd + foldSize;
    const trainSlice = all.slice(0, trainEnd);
    const testSlice = all.slice(testStart, testEnd);
    if (trainSlice.length === 0 || testSlice.length === 0) continue;

    const bucket = buildBucketConstants(trainSlice, keys);
    lastBucket = bucket;
    const trailCapture = estimateTrailCaptureLocal(trainSlice, keys);
    const ctx: ReplayContext = { bucket, trailCapture, replayMode: opts.replayMode ?? "expected" };

    for (const t of testSlice) {
      const proof = extractProof(t, keys);
      const out = replayOneTrade(strategy, t, proof, ctx);
      if ("r" in out) {
        replayed.push({ trade: t, r: out.r, reachedR: proof.reachedR, slPips: out.slPips, slScale: out.slScale });
      } else {
        reasons[out.ineligible] = (reasons[out.ineligible] ?? 0) + 1;
      }
    }
  }

  const ladder = lastBucket ? buildAppliedTpLadder(strategy, lastBucket) : [];
  const result = buildResult(strategy, replayed, reasons, all.length, opts, ladder);
  return result;
}

/** Convenience: rank every preset with k-fold walk-forward and composite
 *  score. Falls back to a single 70/30 walk-forward split, then to a
 *  full-sample replay marked provisional when neither has enough data. */
export interface RankerRunOpts extends ReplayOpts {
  riskToleranceR?: number;
}

export interface RankerRow {
  result: ReplayResult;
  /** How the row was scored: k-fold OOS, single-split OOS, or full-sample. */
  mode: "kfold" | "split" | "full";
  /** Sample size we had to work with before fallbacks. */
  totalEligible: number;
}

export function rankStrategies(
  trades: Trade[],
  keys: PairLabFieldKeys,
  strategies: Strategy[],
  opts: RankerRunOpts,
): { rows: RankerRow[]; exclusion: ExclusionBreakdown; mode: "kfold" | "split" | "full" } {
  const exclusion = computeExclusionBreakdown(trades, keys);
  const eligible = rankerEligibleTrades(trades, keys);
  const n = eligible.length;

  let mode: "kfold" | "split" | "full";
  if (n >= WALK_FORWARD_KFOLD_MIN_N) mode = "kfold";
  else if (n >= WALK_FORWARD_SPLIT_MIN_N) mode = "split";
  else mode = "full";

  const rows: RankerRow[] = strategies.map((s) => {
    let result: ReplayResult | null = null;
    if (mode === "kfold") {
      result = walkForwardKFold(eligible, keys, s, opts);
    } else if (mode === "split") {
      // 70/30 chronological split, scored on OOS only, but re-estimating
      // bucket + trailCapture on the IS slice so the leak is closed.
      const cut = Math.max(1, Math.floor(n * 0.7));
      const isSlice = eligible.slice(0, cut);
      const oosSlice = eligible.slice(cut);
      if (oosSlice.length >= 3) {
        const bucket = buildBucketConstants(isSlice, keys);
        const trailCapture = estimateTrailCaptureLocal(isSlice, keys);
        const ctx: ReplayContext = { bucket, trailCapture, replayMode: opts.replayMode ?? "expected" };
        const replayed: Array<{ trade: Trade; r: number; reachedR: number; slPips: number | null; slScale: number }> = [];
        const reasons: Record<string, number> = {};
        for (const t of oosSlice) {
          const proof = extractProof(t, keys);
          const out = replayOneTrade(s, t, proof, ctx);
          if ("r" in out) replayed.push({ trade: t, r: out.r, reachedR: proof.reachedR, slPips: out.slPips, slScale: out.slScale });
          else reasons[out.ineligible] = (reasons[out.ineligible] ?? 0) + 1;
        }
        const ladder = buildAppliedTpLadder(s, bucket);
        result = buildResult(s, replayed, reasons, n, opts, ladder);
      }
    }
    // Fallback (mode === "full" or the above returned null for lack of data).
    if (!result) result = replayBucket(eligible, keys, s, opts);

    const dollarRisk = (opts.balance * s.riskPct) / 100;
    result.compositeScore = computeCompositeScore(result, dollarRisk, opts.riskToleranceR);
    // Report the strict-eligible total, not per-preset ineligibles inside the
    // numerator, so every row has the same denominator.
    (result as any).totalTradeCount = n;

    // Dev-mode sanity check: after the survivorship-bias fix, presets that
    // aren't adaptive-TP or actual-outcome should retain ~all strict-eligible
    // trades. Big shortfalls hint at a regression in replayOneTrade.
    if (typeof console !== "undefined" && import.meta.env?.DEV) {
      const isAdaptive = s.exitRule.partials.some((p) => (p.atRSource ?? "fixed") !== "fixed");
      const skipCheck = s.useActualOutcome || isAdaptive;
      if (!skipCheck && n >= 10 && result.eligibleCount < n * 0.9) {
        console.warn(
          `[ranker] preset "${s.label}" kept ${result.eligibleCount}/${n} strict-eligible trades — expected ≥ ${Math.ceil(n * 0.9)}. Reasons:`,
          result.ineligibleReasons,
        );
      }
    }

    return { result, mode, totalEligible: n };
  });

  return { rows, exclusion, mode };
}


// `replayBucketMatched` was an alternate matched-sample replay path that the
// Compare view ended up not using (Sprint C2 audit, 2026-06: zero external
// references). Deleted along with its types `MatchedReplay` and constant
// `MIN_MATCHED_SAMPLE` — restore from git history if a future feature needs
// the intersection-only-reasons aggregation.



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
    // Tiebreak on per-trade edge ratio (mean R / σ R) when IS expectancies are
    // within 0.05R — prevents a noisy IS winner from being chosen over a slightly
    // -lower-mean preset with tighter variance, mirroring the main ranker.
    if (Math.abs(b.expectancyR - a.expectancyR) > 0.05) return b.expectancyR - a.expectancyR;
    const aS = a.perTradeEdgeRatio ?? -Infinity;
    const bS = b.perTradeEdgeRatio ?? -Infinity;
    if (bS !== aS) return bS - aS;
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
