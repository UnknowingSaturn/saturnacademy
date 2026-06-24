// ============================================================================
// Pair Lab — quant math
//
// All functions in here are pure. They take an array of Trade rows (with their
// custom_fields jsonb) plus the user's custom-field key map, and produce
// per-bucket distributions and parameter recommendations.
//
// Design notes:
//   - Robust statistics only (median, quantiles, IQR). Means are easy to
//     manipulate with a single outlier; medians aren't.
//   - Kelly is scaled to 0.25 (quarter-Kelly). The raw fraction is returned
//     uncapped; the UI flags values below 0.25% as "edge too thin to size".
//   - Confidence is exposed as a sample-size bucket so the UI can hide the
//     numeric output when N < 10.
//
// UNIT CONTRACT (2026-06):
//   `cf_mae` and `cf_ideal_stop_loss` are stored in broker TICKS (TradingView
//   position-calc output). Convert with `ticksToPips()` before comparing
//   against SL distances expressed in pips. This is the canonical source of
//   truth; the server mirror in supabase/functions/_shared/quant/* matches.
// ============================================================================

import type { Trade } from "@/types/trading";
import { tickSizeForSymbol, pipSizeForSymbol, ticksToPips, pipLabelForSymbol } from "@/lib/symbolMapping";
import {
  TP1_STAR_MIN_HIT_RATE,
  WINNERS_MAE_SL_QUANTILE,
  WINNERS_MAE_SL_BUFFER,
  MAE_P75_WIDEN_BUFFER,
  SL_DRIFT_ALIGNED_MIN,
  SL_DRIFT_ALIGNED_MAX,
  KELLY_SCALE,
  KELLY_FLOOR_PCT,
  KELLY_CEILING_PCT,
  BOOTSTRAP_ITERATIONS,
  BH_FDR_ALPHA,
  MIN_STREAK_FLOOR,
  SL_SWEEP_QUANTILES,
} from "../../shared/quant/config";
// Statistical primitives are unified across client + edge in shared/quant/stats.
// Re-exported here so existing callers (`import { quantile, ... } from "@/lib/pairLabMath"`)
// keep working unchanged.
import {
  quantile,
  median,
  mean,
  stddev,
  downsideStddev,
  wilsonCi,
  percentileFromSorted,
  makeSeededRng,
  bootstrapMeanCi,
  bootstrapPositivePValue,
  bootstrapKellyCi,
  bhSignificant,
  rawQuarterKellyPct,
  quarterKellyPct,
  normalizeSession,
  getCf,
  numericCf,
  multiSelectCf,
} from "../../shared/quant/stats";
export {
  quantile,
  median,
  mean,
  stddev,
  downsideStddev,
  wilsonCi,
  bootstrapMeanCi,
  bootstrapPositivePValue,
  bootstrapKellyCi,
  bhSignificant,
  rawQuarterKellyPct,
  quarterKellyPct,
  normalizeSession,
};

export type ConfidenceLevel = "high" | "medium" | "low";

export interface PairLabFieldKeys {
  mfe: string | null;            // number (R-multiple)
  mae: string | null;            // number (broker TICKS — convert with ticksToPips)
  idealStopLoss: string | null;  // number (broker TICKS — convert with ticksToPips)
  idealStopLossPos: string | null; // select (initial_leg | last_leg)
  idealEntryWindow: string | null; // select (first_30min | last_30min)
}

export interface BucketKey {
  symbol: string;
  session: string;       // "Tokyo" | "London" | "NY AM" | "NY PM" | "All sessions"
}

export interface BucketStats {
  key: BucketKey;
  /** Raw broker symbols rolled up into this canonical key (for display). */
  rawSymbols: string[];
  n: number;
  wins: number;
  losses: number;
  winRate: number;            // 0–1
  /** Wilson 95% CI on win rate, null when n < 5. */
  winRateCi: [number, number] | null;
  expectedR: number;          // average R-multiple, mean of r_multiple_actual
  expectedRMedian: number;    // median R-multiple
  /** Sum(winR) / Sum(|lossR|). null when no losses. */
  profitFactor: number | null;
  /** mean(winR) / mean(|lossR|). null when no losses or no wins. */
  payoffRatio: number | null;
  mfeP50: number | null;          // R-multiple
  mfeP75: number | null;          // R-multiple
  maeP50: number | null;          // R-multiple (per-trade ticks→R)
  maeP75: number | null;          // R-multiple
  maeP75Pips: number | null;      // pips, used for SL recommendation
  maeP50Ticks: number | null;     // raw ticks (user input from TradingView measure tool)
  maeP75Ticks: number | null;     // raw ticks
  /** Min/max of logged MFE values (R). Null when no MFE samples. */
  mfeMin: number | null;
  mfeMax: number | null;
  /** Min/max of logged MAE values (ticks). Null when no MAE samples. */
  maeMinTicks: number | null;
  maeMaxTicks: number | null;
  idealSlMedian: number | null;   // pips
  slInitialMedian: number | null; // pips
  slDrift: "too_wide" | "too_tight" | "aligned" | null;
  confidence: ConfidenceLevel;
  // Two-sided bootstrap CI on expectedR — null when n < 5.
  expectedRCi: [number, number] | null;
  /** One-sided bootstrap p-value that expectedR > 0. null when n < 5. */
  expectancyPValue: number | null;
  // Longest run of consecutive losing trades observed in this bucket.
  worstLosingStreak: number;
  /** Number of (closed) trades in this bucket that have an explicit MFE custom-field value. */
  loggedMfeCount: number;
  /** Number of (closed) trades in this bucket that have an explicit MAE custom-field value AND convertible SL. */
  loggedMaeCount: number;
  /** Number of (closed) trades in this bucket that have an explicit Ideal SL custom-field value. */
  loggedIdealSlCount: number;
  /** Hypothetical SL sweep over the bucket's MAE distribution. null when N<10 or insufficient MAE data. */
  slSweep: SlSweepRow[] | null;
}

export interface SlSweepRow {
  /** Quantile of MAE distribution (e.g. 0.25, 0.40, 0.55, 0.70, 0.90). */
  q: number;
  /** SL distance in pips at this quantile. */
  slPips: number;
  /** Fraction of trades stopped out at this SL (0–1). */
  pctStopped: number;
  /** Mean R-multiple under this hypothetical SL. */
  meanR: number;
  /** Delta vs actual mean R (meanR − expectedR). */
  deltaR: number;
}

export interface Tp1Star {
  r: number;          // R-multiple target
  hitRate: number;    // 0–1, fraction of trades whose MFE ≥ r
  /** Wilson 95% CI on hitRate. */
  hitRateCi: [number, number] | null;
  expectancyR: number;
}

// Canonical PropFirmContext shape lives in shared/quant/types so the React
// client and Supabase edge functions can never drift.
export type { PropFirmContext } from "../../shared/quant/types";
import type { PropFirmContext } from "../../shared/quant/types";

export interface BucketRecommendation {
  suggestedSlPips: number | null;
  tpLadderR: number[];            // ascending R targets, 1-3 entries (expected-R)
  tp1Star: Tp1Star | null;        // win-rate-maximizing TP target
  suggestedRiskPct: number | null;  // % of account, edge-only (Kelly), uncapped
  /** True when raw quarter-Kelly is positive but below the 0.25% floor — edge too thin to size meaningfully. */
  riskBelowFloor: boolean;
  /** Bootstrap 95% CI on the quarter-Kelly fraction (raw, uncapped). */
  suggestedRiskPctCi: [number, number] | null;
  suggestedRiskPctPropFirm: number | null; // % of account, prop-firm-capped
  bindingConstraint: "kelly" | "prop_firm_dd" | "hard_cap" | null;
  edgeVsBaseline: {
    winRateDelta: number;        // percentage points
    expectedRDelta: number;
  } | null;
  /**
   * Quant provenance for the SL/TP suggestion.
   *  - "validated": MAE-of-winners SL + MFE-based TP expectancy grid, bootstrap CI lower bound > 0
   *  - "low": grid found a max but bootstrap CI lower bound ≤ 0 (overfit risk)
   *  - "insufficient": fell back to legacy heuristic (winners<10 or MFE coverage<10)
   */
  recommendationConfidence: "validated" | "low" | "insufficient";
  /** Expected R at the chosen (SL, TP) grid cell. null when fallback used. */
  expectancyAtSuggested: number | null;
  /** Bootstrap 95% CI on expectancy at the chosen cell. null when fallback used. */
  expectancyAtSuggestedCi: [number, number] | null;
  /** TP that wins the MFE-based expectancy grid (R). null when fallback used. */
  suggestedTpR: number | null;
  /**
   * Walk-forward validation: fit SL/TP on first 70% of trades by entry_time,
   * score on last 30%. Honest defense against curve-fitting.
   * null when total closed N < 30 or OOS pairs < 5.
   */
  walkForward: {
    inSampleE: number;
    outOfSampleE: number;
    /** (1 − OOS/IS) × 100. Positive = OOS worse than IS. */
    degradationPct: number;
    oosN: number;
  } | null;
}

export interface BucketReport extends BucketStats {
  recommendation: BucketRecommendation;
  // Best / worst trades for citation (most positive / most negative R).
  topTradeIds: string[];
  bottomTradeIds: string[];
  /**
   * Human-readable unit for SL/MAE distances in this bucket
   * ("pips" for FX/metals/crypto, "points" for indices). Resolved from the
   * bucket's symbol via pipLabelForSymbol(). Mirrors the server-side field
   * on supabase/functions/_shared/quant/pairLabMath.ts BucketReport.
   */
  slUnit?: "pips" | "points";
}

// ----------------------------------------------------------------------------
// Field key resolution. Keys are per-user (e.g. cf_mfe_envl); match by label
// first, then by stable prefix, so other users with different generated keys
// still work.
// ----------------------------------------------------------------------------

interface CustomFieldDef {
  key: string;
  label: string;
}

const LABEL_MAP: Array<{ alias: keyof PairLabFieldKeys; labels: string[]; prefixes: string[] }> = [
  { alias: "mfe",              labels: ["mfe (rr)", "mfe", "max favourable excursion", "max favorable excursion"], prefixes: ["cf_mfe"] },
  { alias: "mae",              labels: ["mae", "max adverse excursion"],                                            prefixes: ["cf_mae"] },
  { alias: "idealStopLoss",    labels: ["ideal stop-loss", "ideal stop loss", "ideal sl"],                          prefixes: ["cf_ideal_stop_loss_rnv7", "cf_ideal_stop_loss"] },
  { alias: "idealStopLossPos", labels: ["ideal stop-loss position", "ideal stop loss position"],                    prefixes: ["cf_ideal_stop_loss_position"] },
  { alias: "idealEntryWindow", labels: ["ideal entry window"],                                                      prefixes: ["cf_ideal_entry_window"] },
];

export function resolvePairLabFieldKeys(defs: CustomFieldDef[]): PairLabFieldKeys {
  const out: PairLabFieldKeys = {
    mfe: null, mae: null,
    idealStopLoss: null, idealStopLossPos: null, idealEntryWindow: null,
  };
  for (const entry of LABEL_MAP) {
    const byLabel = defs.find((d) => entry.labels.includes((d.label || "").trim().toLowerCase()));
    if (byLabel) { out[entry.alias] = byLabel.key; continue; }
    const byPrefix = defs.find((d) => entry.prefixes.some((p) => (d.key || "").startsWith(p)));
    if (byPrefix) out[entry.alias] = byPrefix.key;
  }
  if (out.idealStopLoss && out.idealStopLoss === out.idealStopLossPos) {
    out.idealStopLoss = null;
  }
  return out;
}

// ----------------------------------------------------------------------------
// Robust statistics — unified primitives live in shared/quant/stats.
// Imported + re-exported at the top of this file. Nothing else needed here.
// ----------------------------------------------------------------------------



function confidenceFor(n: number): ConfidenceLevel {
  if (n >= 50) return "high";
  if (n >= 15) return "medium";
  return "low";
}

export interface BuildBucketsOpts {
  profile?: string | null;
  actualProfile?: string | null;
  closedOnly?: boolean;
  symbolResolver?: (raw: string) => string;
  propFirm?: PropFirmContext | null;
}

export function buildBuckets(
  trades: Trade[],
  keys: PairLabFieldKeys,
  opts: BuildBucketsOpts = {},
): { perCell: BucketReport[]; perRow: BucketReport[]; baseline: BucketReport } {
  const closedOnly = opts.closedOnly !== false;
  const resolveSym = opts.symbolResolver ?? ((s: string) => s);
  const filtered = trades.filter((t) => {
    if (closedOnly && t.is_open) return false;
    if (t.is_archived) return false;
    // `profile` matches either planned or actual profile field — single filter for users.
    if (opts.profile && t.profile !== opts.profile && t.actual_profile !== opts.profile) return false;
    if (opts.actualProfile && t.actual_profile !== opts.actualProfile) return false;
    return true;
  });

  const baseline = computeBucket(
    { symbol: "All", session: "All sessions" },
    filtered,
    keys,
    null,
    opts.propFirm ?? null,
  );

  const cellMap = new Map<string, Trade[]>();
  const rowMap = new Map<string, Trade[]>();
  const cellRawSymbols = new Map<string, Set<string>>();
  const rowRawSymbols = new Map<string, Set<string>>();
  for (const t of filtered) {
    if (!t.symbol) continue;
    const canonical = resolveSym(t.symbol);
    const sess = normalizeSession(t.session);
    const cellKey = `${canonical}__${sess}`;
    if (!cellMap.has(cellKey)) { cellMap.set(cellKey, []); cellRawSymbols.set(cellKey, new Set()); }
    cellMap.get(cellKey)!.push(t);
    cellRawSymbols.get(cellKey)!.add(t.symbol);
    if (!rowMap.has(canonical)) { rowMap.set(canonical, []); rowRawSymbols.set(canonical, new Set()); }
    rowMap.get(canonical)!.push(t);
    rowRawSymbols.get(canonical)!.add(t.symbol);
  }

  const perCell: BucketReport[] = [];
  cellMap.forEach((rows, cellKey) => {
    const [symbol, session] = cellKey.split("__");
    const report = computeBucket({ symbol, session }, rows, keys, baseline, opts.propFirm ?? null);
    report.rawSymbols = Array.from(cellRawSymbols.get(cellKey) ?? []).sort();
    perCell.push(report);
  });
  const perRow: BucketReport[] = [];
  rowMap.forEach((rows, symbol) => {
    const report = computeBucket(
      { symbol, session: "All sessions" },
      rows,
      keys,
      baseline,
      opts.propFirm ?? null,
    );
    report.rawSymbols = Array.from(rowRawSymbols.get(symbol) ?? []).sort();
    perRow.push(report);
  });

  perCell.sort((a, b) => (b.n - a.n) || a.key.symbol.localeCompare(b.key.symbol));
  perRow.sort((a, b) => b.n - a.n);
  return { perCell, perRow, baseline };
}

function longestLossStreak(rows: Trade[]): number {
  const sorted = [...rows]
    .filter((t) => t.net_pnl != null && t.entry_time)
    .sort((a, b) => String(a.entry_time).localeCompare(String(b.entry_time)));
  let run = 0;
  let worst = 0;
  for (const t of sorted) {
    if ((t.net_pnl ?? 0) < 0) {
      run += 1;
      if (run > worst) worst = run;
    } else {
      run = 0;
    }
  }
  return worst;
}

/**
 * Search the R candidate grid for the TP that maximises *empirical* expectancy.
 *
 * `pairs` are (mfeR, rActual?) tuples: rActual is the trade's realized R.
 * For each candidate r:
 *   - hits: MFE ≥ r  → would have closed at +r
 *   - misses: MFE < r → would have exited at the empirical r_actual (BE / partial /
 *     full stop). Falls back to `−avgLossR` when r_actual is missing or the
 *     conditional-miss sample is < 5 (too few to estimate cleanly).
 *
 * The prior version treated every miss as a full `−avgLossR` stop-out, which
 * overstated the downside of conservative TPs and pushed the argmax low.
 */
function computeTp1Star(
  pairs: Array<{ mfeR: number; rActual: number | null }>,
  avgLossR: number,
): Tp1Star | null {
  if (pairs.length < 5) return null;
  const candidates = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0];
  let best: Tp1Star | null = null;
  const fallbackMiss = -Math.abs(avgLossR);
  for (const r of candidates) {
    let hits = 0;
    const missRs: number[] = [];
    for (const p of pairs) {
      if (p.mfeR >= r) hits += 1;
      else if (p.rActual != null && Number.isFinite(p.rActual)) missRs.push(p.rActual);
    }
    const hitRate = hits / pairs.length;
    if (hitRate < TP1_STAR_MIN_HIT_RATE) continue;
    const missMean = missRs.length >= 5
      ? missRs.reduce((s, v) => s + v, 0) / missRs.length
      : fallbackMiss;
    const expectancyR = hitRate * r + (1 - hitRate) * missMean;
    if (!best || expectancyR > best.expectancyR) {
      best = { r, hitRate, hitRateCi: wilsonCi(hits, pairs.length), expectancyR };
    }
  }
  return best;
}

function computeBucket(
  key: BucketKey,
  rows: Trade[],
  keys: PairLabFieldKeys,
  baseline: BucketReport | null,
  propFirm: PropFirmContext | null,
): BucketReport {
  const closed = rows.filter((t) => t.net_pnl != null);

  const sideOf = (t: Trade): 1 | -1 | 0 => {
    if (t.r_multiple_actual != null) {
      if (t.r_multiple_actual > 0) return 1;
      if (t.r_multiple_actual < 0) return -1;
      return 0;
    }
    const p = t.net_pnl ?? 0;
    return p > 0 ? 1 : p < 0 ? -1 : 0;
  };
  const wins = closed.filter((t) => sideOf(t) === 1);
  const losses = closed.filter((t) => sideOf(t) === -1);

  const rActuals = closed.map((t) => t.r_multiple_actual).filter((v): v is number => v != null);
  const winR = wins.map((t) => t.r_multiple_actual).filter((v): v is number => v != null && v > 0);
  const lossR = losses
    .map((t) => t.r_multiple_actual)
    .filter((v): v is number => v != null && v < 0)
    .map((v) => Math.abs(v));

  const mfes = rows.map((t) => numericCf(t as any, keys.mfe)).filter((v): v is number => v != null);
  // Paired (mfeR, rActual) used by computeTp1Star for empirical miss-cost.
  const mfeRPairsForTp1: Array<{ mfeR: number; rActual: number | null }> = [];
  for (const t of rows) {
    const m = numericCf(t as any, keys.mfe);
    if (m == null) continue;
    mfeRPairsForTp1.push({ mfeR: m, rActual: t.r_multiple_actual ?? null });
  }

  // MAE is stored in TICKS. Convert each value to pips for the SL math and to
  // R for the distribution display.
  const maesR: number[] = [];
  const maesPips: number[] = [];
  /** Per-trade tuples used by the SL sweep — needs MAE-pips, planned SL-pips, and actual R. */
  const sweepRows: Array<{ maePips: number; slPips: number; rActual: number }> = [];
  const maesTicks: number[] = [];
  for (const t of rows) {
    const maeTicks = numericCf(t as any, keys.mae);
    if (maeTicks == null) continue;
    maesTicks.push(Math.abs(maeTicks));
    if (!t.symbol) continue;
    const pip = pipSizeForSymbol(t.symbol);
    if (!(pip > 0)) continue;
    const maePips = ticksToPips(t.symbol, Math.abs(maeTicks));
    maesPips.push(maePips);
    if (t.sl_initial != null && t.entry_price != null) {
      const slDistPips = Math.abs(t.entry_price - t.sl_initial) / pip;
      if (slDistPips > 0) {
        maesR.push(maePips / slDistPips);
        if (t.r_multiple_actual != null && Number.isFinite(t.r_multiple_actual)) {
          sweepRows.push({ maePips, slPips: slDistPips, rActual: t.r_multiple_actual });
        }
      }
    }
  }

  // Ideal SL is stored in TICKS. Convert to pips for the SL recommendation.
  const idealSls: number[] = [];
  for (const t of rows) {
    const idealTicks = numericCf(t as any, keys.idealStopLoss);
    if (idealTicks == null || !t.symbol) continue;
    idealSls.push(Math.abs(ticksToPips(t.symbol, idealTicks)));
  }

  const slInitials: number[] = [];
  for (const t of rows) {
    if (t.sl_initial == null || t.entry_price == null || !t.symbol) continue;
    const pip = pipSizeForSymbol(t.symbol);
    if (!(pip > 0)) continue;
    slInitials.push(Math.abs(t.entry_price - t.sl_initial) / pip);
  }

  const n = closed.length;
  const winRate = n > 0 ? wins.length / n : 0;
  const expectedR = mean(rActuals);
  const expectedRMedian = median(rActuals) ?? 0;

  const sumWin = winR.reduce((s, v) => s + v, 0);
  const sumLoss = lossR.reduce((s, v) => s + v, 0);
  const profitFactor = sumLoss > 0 ? sumWin / sumLoss : (sumWin > 0 ? Infinity : null);
  const payoffRatio = (wins.length > 0 && losses.length > 0 && lossR.length > 0)
    ? (sumWin / winR.length) / (sumLoss / lossR.length)
    : null;

  const idealMed = median(idealSls);
  const slInitMed = median(slInitials);
  let slDrift: BucketStats["slDrift"] = null;
  if (idealMed != null && slInitMed != null && slInitMed > 0) {
    const ratio = idealMed / slInitMed;
    if (ratio < SL_DRIFT_ALIGNED_MIN) slDrift = "too_wide";
    else if (ratio > SL_DRIFT_ALIGNED_MAX) slDrift = "too_tight";
    else slDrift = "aligned";
  }

  // Hypothetical SL sweep: replay outcomes at candidate SLs drawn from the
  // MAE quantile distribution. If MAE > candidate SL, the trade is stopped
  // at −1R; otherwise the actual outcome is rescaled by the SL ratio.
  let slSweep: SlSweepRow[] | null = null;
  if (sweepRows.length >= 10) {
    const maePipsForQ = sweepRows.map((r) => r.maePips);
    const quants = SL_SWEEP_QUANTILES;
    const seen = new Set<string>();
    const sweepOut: SlSweepRow[] = [];
    for (const q of quants) {
      const slCand = quantile(maePipsForQ, q);
      if (slCand == null || !(slCand > 0)) continue;
      const key = slCand.toFixed(2);
      if (seen.has(key)) continue;
      seen.add(key);
      let stopped = 0;
      let sumR = 0;
      for (const r of sweepRows) {
        if (r.maePips > slCand) { sumR += -1; stopped += 1; }
        else { sumR += r.rActual * (r.slPips / slCand); }
      }
      const meanR = sumR / sweepRows.length;
      sweepOut.push({
        q,
        slPips: slCand,
        pctStopped: stopped / sweepRows.length,
        meanR,
        deltaR: meanR - expectedR,
      });
    }
    if (sweepOut.length > 0) slSweep = sweepOut;
  }

  const stats: BucketStats = {
    key,
    rawSymbols: [],
    n,
    wins: wins.length,
    losses: losses.length,
    winRate,
    winRateCi: n > 0 ? wilsonCi(wins.length, n) : null,
    expectedR,
    expectedRMedian,
    profitFactor, // Infinity sentinel preserved for all-win buckets — UI renders "∞"
    payoffRatio,
    mfeP50: median(mfes),
    mfeP75: quantile(mfes, 0.75),
    maeP50: median(maesR),
    maeP75: quantile(maesR, 0.75),
    maeP75Pips: quantile(maesPips, 0.75),
    maeP50Ticks: median(maesTicks),
    maeP75Ticks: quantile(maesTicks, 0.75),
    // Use reduce instead of Math.min(...arr) — the spread form hits V8's
    // argument-count limit (~125k) and throws on large MAE/MFE samples.
    mfeMin: mfes.length > 0 ? mfes.reduce((a, b) => (a < b ? a : b)) : null,
    mfeMax: mfes.length > 0 ? mfes.reduce((a, b) => (a > b ? a : b)) : null,
    maeMinTicks: maesTicks.length > 0 ? maesTicks.reduce((a, b) => (a < b ? a : b)) : null,
    maeMaxTicks: maesTicks.length > 0 ? maesTicks.reduce((a, b) => (a > b ? a : b)) : null,
    idealSlMedian: idealMed,
    slInitialMedian: slInitMed,
    slDrift,
    confidence: confidenceFor(n),
    expectedRCi: bootstrapMeanCi(rActuals),
    expectancyPValue: bootstrapPositivePValue(rActuals),
    worstLosingStreak: longestLossStreak(rows),
    loggedMfeCount: closed.filter((t) => numericCf(t as any, keys.mfe) != null).length,
    loggedMaeCount: closed.filter((t) => {
      const v = numericCf(t as any, keys.mae);
      return v != null && t.sl_initial != null && t.entry_price != null;
    }).length,
    slSweep,
  };




  // Per-trade (MFE_R, r_actual) pairs for the MFE-expectancy TP grid.
  const mfeRPairs: Array<{ mfeR: number; rActual: number }> = [];
  for (const t of rows) {
    const mfeR = numericCf(t as any, keys.mfe);
    if (mfeR == null) continue;
    if (t.r_multiple_actual == null || !Number.isFinite(t.r_multiple_actual)) continue;
    mfeRPairs.push({ mfeR, rActual: t.r_multiple_actual });
  }
  // Winners' MAE in pips — drives the Sweeney SL recommendation.
  const winnersMaePips = sweepRows.filter((r) => r.rActual > 0).map((r) => r.maePips);
  // Bucket-local trail-capture estimate (low minSample; falls back to 0.7).
  // minSample=10 mirrors the server (`estimateTrailCaptureRows`) so thin buckets
  // fall back to the same 0.7 default on both sides.
  const tcEst = estimateTrailCapture(rows, keys, 10);
  const trailCapture = tcEst?.ratio ?? 0.7;

  const baseRec = buildRecommendation(
    stats, winR, lossR, mfes, baseline, propFirm,
    { mfeRPairs, winnersMaePips, trailCapture, tp1StarPairs: mfeRPairsForTp1 },
  );
  const recommendation: BucketRecommendation = {
    ...baseRec,
    walkForward: runWalkForward(rows, keys),
  };

  const sorted = [...closed].sort(
    (a, b) => (b.r_multiple_actual ?? 0) - (a.r_multiple_actual ?? 0),
  );
  const topTradeIds = sorted.slice(0, 3).map((t) => t.id);
  const bottomTradeIds = sorted.slice(-3).reverse().map((t) => t.id);

  const slUnit: "pips" | "points" =
    key.symbol && key.symbol !== "All" ? pipLabelForSymbol(key.symbol) : "pips";

  return { ...stats, recommendation, topTradeIds, bottomTradeIds, slUnit };
}

// ----------------------------------------------------------------------------
// Shared TP/SL helpers — used by both buildRecommendation and runWalkForward.
// ----------------------------------------------------------------------------

interface MfePair { mfeR: number; rActual: number; }

/**
 * Replay a candidate TP against (MFE_R, r_actual) pairs.
 *
 * Cases:
 *  - MFE reached the candidate TP → trade would have closed at `tp` (gain = tp R).
 *  - MFE never reached TP → trade exits at its *actual* realized outcome.
 *
 * Trail-capture is NOT mixed into the TP grid: that's a separate counterfactual
 * (no fixed TP, trailing stop from MFE). The old `trail` parameter was a
 * leftover from when the grid attempted to discount realized exits — removed
 * because it biased argmax low.
 */
function scoreTp(tp: number, sample: MfePair[]): number {
  if (sample.length === 0) return 0;
  let sum = 0;
  for (const p of sample) {
    if (p.mfeR >= tp) sum += tp;
    else sum += p.rActual;
  }
  return sum / sample.length;
}

function collectMfeRPairs(rows: Trade[], keys: PairLabFieldKeys): MfePair[] {
  const out: MfePair[] = [];
  for (const t of rows) {
    const mfeR = numericCf(t as any, keys.mfe);
    if (mfeR == null) continue;
    if (t.r_multiple_actual == null || !Number.isFinite(t.r_multiple_actual)) continue;
    out.push({ mfeR, rActual: t.r_multiple_actual });
  }
  return out;
}

/** Grid-search the best TP in R-space against MFE pairs. */
function pickBestTp(
  pairs: MfePair[],
  _trail: number,
): { tpR: number; expectancy: number; ladder: number[]; ci: [number, number] | null } | null {
  if (pairs.length < 10) return null;
  const grid: number[] = [];
  for (let r = 0.5; r <= 4.0001; r += 0.25) grid.push(Math.round(r * 4) / 4);
  const scored = grid.map((tp) => ({ tp, e: scoreTp(tp, pairs) }));
  let best: { tp: number; e: number } | null = null;
  for (const c of scored) if (!best || c.e > best.e) best = c;
  if (!best || !(best.e > 0)) return null;

  // Bootstrap CI on expectancy at the winning TP cell.
  let hash = pairs.length * 1000003;
  for (const p of pairs) {
    hash = (hash * 31 + Math.floor((p.mfeR * 1000 + p.rActual * 1000))) | 0;
  }
  const rand = makeSeededRng(hash);
  const iters = BOOTSTRAP_ITERATIONS;
  const samples: number[] = new Array(iters);
  const buf: MfePair[] = new Array(pairs.length);
  for (let i = 0; i < iters; i++) {
    for (let j = 0; j < pairs.length; j++) buf[j] = pairs[Math.floor(rand() * pairs.length)];
    samples[i] = scoreTp(best.tp, buf);
  }
  samples.sort((a, b) => a - b);
  const ci: [number, number] = [
    percentileFromSorted(samples, 0.025),
    percentileFromSorted(samples, 0.975),
  ];
  const ladder = Array.from(
    new Set([...scored].filter((c) => c.e > 0).sort((a, b) => b.e - a.e).slice(0, 3).map((c) => c.tp)),
  ).sort((a, b) => a - b);
  return { tpR: best.tp, expectancy: best.e, ladder, ci };
}

/**
 * Walk-forward validation: pick best TP on first 70% (chronological), score
 * that same TP on last 30%. Returns null when too few trades for a meaningful
 * out-of-sample read.
 */
export function runWalkForward(
  rows: Trade[],
  keys: PairLabFieldKeys,
): BucketRecommendation["walkForward"] {
  const closed = rows.filter((t) => t.net_pnl != null && t.entry_time);
  if (closed.length < 30) return null;
  const sorted = [...closed].sort(
    (a, b) => String(a.entry_time).localeCompare(String(b.entry_time)),
  );
  const cutoff = Math.floor(sorted.length * 0.7);
  const isRows = sorted.slice(0, cutoff);
  const oosRows = sorted.slice(cutoff);
  if (oosRows.length < 9) return null;

  const isPairs = collectMfeRPairs(isRows, keys);
  const oosPairs = collectMfeRPairs(oosRows, keys);
  if (isPairs.length < 10 || oosPairs.length < 5) return null;

  // Walk-forward must not estimate trailCapture on the OOS slice. We no
  // longer pass `trail` into `scoreTp`/`pickBestTp` (dead parameter removed),
  // but `pickBestTp`'s signature still accepts it as `_trail` for API
  // stability — passing 0 is a no-op.
  const isPick = pickBestTp(isPairs, 0);
  if (!isPick) return null;
  const inSampleE = isPick.expectancy;
  const outOfSampleE = scoreTp(isPick.tpR, oosPairs);
  const degradationPct = inSampleE > 0 ? (1 - outOfSampleE / inSampleE) * 100 : 0;
  // Report N as the OOS *pairs* that actually feed `scoreTp` — these are the
  // true degrees of freedom. `oosRows.length` (total OOS trades) can be much
  // larger than oosPairs.length when MFE coverage is sparse, which would
  // mislead the reader about how robust the OOS read is.
  return { inSampleE, outOfSampleE, degradationPct, oosN: oosPairs.length };
}



function buildRecommendation(
  s: BucketStats,
  winR: number[],
  lossR: number[],
  mfes: number[],
  baseline: BucketReport | null,
  propFirm: PropFirmContext | null,
  ctx: {
    mfeRPairs: Array<{ mfeR: number; rActual: number }>;
    winnersMaePips: number[];
    trailCapture: number;
    tp1StarPairs: Array<{ mfeR: number; rActual: number | null }>;
  },
): BucketRecommendation {
  // ----- SL: MAE-of-winners (Sweeney / van Tharp) -----
  // Tightest SL that preserves ~90% of winners, plus a 10% noise buffer.
  // Losers' MAE is meaningless (they were stopped); only winners tell us how
  // much heat the edge needs to absorb before reverting.
  let suggestedSlPips: number | null = null;
  let slMethod: "winners_mae" | "legacy" = "legacy";
  const slWinners = ctx.winnersMaePips.length >= 10
    ? quantile(ctx.winnersMaePips, WINNERS_MAE_SL_QUANTILE)
    : null;
  if (slWinners != null && slWinners > 0) {
    suggestedSlPips = slWinners * WINNERS_MAE_SL_BUFFER;
    slMethod = "winners_mae";
  } else {
    const maeCandidate = s.maeP75Pips != null ? s.maeP75Pips * MAE_P75_WIDEN_BUFFER : null;
    if (maeCandidate != null || s.idealSlMedian != null) {
      suggestedSlPips = Math.max(maeCandidate ?? 0, s.idealSlMedian ?? 0);
    }
  }

  // ----- TP: MFE-based expectancy grid (not realized win-R) -----
  // Replays each trade against candidate TPs using its MFE:
  //   MFE >= TP  → realized +TP (would have hit)
  //   MFE < TP & winner → r_actual × trailCapture (kept a fraction of the move)
  //   loser → r_actual (stop unchanged)
  // This sees TP levels we've never tried, unlike win-R quantiles.
  let suggestedTpR: number | null = null;
  let expectancyAtSuggested: number | null = null;
  let expectancyAtSuggestedCi: [number, number] | null = null;
  let tpMethod: "mfe_grid" | "legacy" = "legacy";
  let tpLadderR: number[] = [];

  const pick = pickBestTp(ctx.mfeRPairs, ctx.trailCapture);
  if (pick) {
    suggestedTpR = pick.tpR;
    expectancyAtSuggested = pick.expectancy;
    expectancyAtSuggestedCi = pick.ci;
    tpLadderR = pick.ladder;
    tpMethod = "mfe_grid";
  }

  if (tpMethod === "legacy") {
    // Legacy fallback: win-R quantiles (survivorship-biased but works at low n).
    const ladder: number[] = [];
    const pConservative = quantile(winR, 0.3);
    const pMedian       = quantile(winR, 0.5);
    const pAggressive   = quantile(winR, 0.75);
    for (const v of [pConservative, pMedian, pAggressive]) {
      if (v == null || v <= 0) continue;
      ladder.push(v);
    }
    tpLadderR = Array.from(new Set(ladder.map((v) => Math.round(v * 4) / 4))).slice(0, 3);
  }

  // Confidence:
  //  - "validated"  : both upgrades active AND bootstrap lower CI > 0
  //  - "low"        : both upgrades active but CI lower bound ≤ 0 (overfit risk)
  //  - "insufficient": at least one fallback fired (low winner/MFE coverage)
  let recommendationConfidence: BucketRecommendation["recommendationConfidence"];
  if (slMethod === "legacy" || tpMethod === "legacy") {
    recommendationConfidence = "insufficient";
  } else if (expectancyAtSuggestedCi && expectancyAtSuggestedCi[0] > 0) {
    recommendationConfidence = "validated";
  } else {
    recommendationConfidence = "low";
  }

  const avgWinR = winR.length > 0 ? winR.reduce((a, v) => a + v, 0) / winR.length : 0;
  const avgLossR = lossR.length > 0 ? lossR.reduce((a, v) => a + v, 0) / lossR.length : 1;
  const rawKelly = s.n >= 10 ? rawQuarterKellyPct(s.winRate, avgWinR, avgLossR) : null;
  const suggestedRiskPct = rawKelly != null ? Math.min(KELLY_CEILING_PCT, rawKelly) : null;
  const riskBelowFloor = rawKelly != null && rawKelly < KELLY_FLOOR_PCT;
  const suggestedRiskPctCi = s.n >= 10 ? bootstrapKellyCi(winR, lossR) : null;

  const tp1Star = computeTp1Star(ctx.tp1StarPairs, avgLossR || 1);

  // Prop-firm-aware risk cap. Uses observed worst losing streak (floored at 3)
  // to distribute the daily-loss budget over N consecutive full stops.
  let suggestedRiskPctPropFirm: number | null = null;
  let bindingConstraint: BucketRecommendation["bindingConstraint"] = null;
  if (propFirm && propFirm.balance > 0 && propFirm.dailyLossDollars != null) {
    const streak = Math.max(MIN_STREAK_FLOOR, s.worstLosingStreak || 0);
    const dailyBudgetPct = (propFirm.dailyLossDollars / propFirm.balance) * 100;
    const ddCappedPct = dailyBudgetPct / streak;
    suggestedRiskPctPropFirm = Math.max(0.1, Math.min(propFirm.hardCapPct, ddCappedPct));

    if (suggestedRiskPct == null) {
      bindingConstraint = "prop_firm_dd";
    } else if (suggestedRiskPctPropFirm < suggestedRiskPct) {
      bindingConstraint = suggestedRiskPctPropFirm >= propFirm.hardCapPct - 0.001
        ? "hard_cap"
        : "prop_firm_dd";
    } else {
      bindingConstraint = "kelly";
    }
  } else if (suggestedRiskPct != null) {
    bindingConstraint = "kelly";
  }

  let edgeVsBaseline: BucketRecommendation["edgeVsBaseline"] = null;
  if (baseline && baseline.n > 0 && s.key.symbol !== "All") {
    edgeVsBaseline = {
      winRateDelta: (s.winRate - baseline.winRate) * 100,
      expectedRDelta: s.expectedR - baseline.expectedR,
    };
  }

  return {
    suggestedSlPips,
    tpLadderR,
    tp1Star,
    suggestedRiskPct,
    riskBelowFloor,
    suggestedRiskPctCi,
    suggestedRiskPctPropFirm,
    bindingConstraint,
    edgeVsBaseline,
    recommendationConfidence,
    expectancyAtSuggested,
    expectancyAtSuggestedCi,
    suggestedTpR,
    walkForward: null, // populated by computeBucket which has the full rows
  };
}

// ----------------------------------------------------------------------------
// Empirical trail-capture estimate
//
// Replaces the hardcoded TRAIL_CAPTURE_FRAC = 0.8 in the simulator when the
// user has enough trades with both MFE and r_actual logged. Excludes all-out
// exits at TP (r_actual == MFE) since those have no trail to measure.
// ----------------------------------------------------------------------------

export interface TrailCaptureEstimate {
  /** Median r_actual / MFE on qualifying trades. */
  ratio: number;
  /** Number of trades the estimate is derived from. */
  n: number;
}

export function estimateTrailCapture(
  trades: Trade[],
  keys: PairLabFieldKeys,
  minSample = 10,
): TrailCaptureEstimate | null {
  const ratios: number[] = [];
  for (const t of trades) {
    if (t.is_open || t.is_archived) continue;
    const mfe = numericCf(t as any, keys.mfe);
    const r = t.r_multiple_actual;
    if (mfe == null || r == null) continue;
    if (!(mfe > 0)) continue;
    if (!(r > 0)) continue;
    // Exclude all-out exits at TP — they don't measure trail behaviour.
    if (mfe - r < 0.1) continue;
    const ratio = r / mfe;
    if (ratio > 0 && ratio < 1.05) ratios.push(ratio);
  }
  if (ratios.length < minSample) return null;
  const m = median(ratios);
  if (m == null || !(m > 0)) return null;
  return { ratio: Math.max(0.1, Math.min(0.95, m)), n: ratios.length };
}
