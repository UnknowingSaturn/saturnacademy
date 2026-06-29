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
import { resolveSlAtMae } from "@/lib/tradeMath";
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
  TRAIL_CAPTURE_FALLBACK,
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
  isUnrealized,
  ensureUtcMs,
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
  isUnrealized,
  ensureUtcMs,
};

export type ConfidenceLevel = "high" | "medium" | "low";

export interface PairLabFieldKeys {
  mfe: string | null;            // number (R-multiple)
  mae: string | null;            // number (broker TICKS — convert with ticksToPips)
  idealStopLoss: string | null;  // number (broker TICKS — convert with ticksToPips)
  idealStopLossPos: string | null; // select (initial_leg | last_leg)
  
}

export interface BucketKey {
  symbol: string;
  session: string;       // "Tokyo" | "London" | "NY AM" | "NY PM" | "All sessions"
}

export interface BucketEvent {
  ts: string;
  won: boolean;
  r: number;
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
  expectedR: number;          // mean of r_multiple_actual; NaN when expectedRSamples === 0
  expectedRMedian: number;    // median R-multiple; NaN when expectedRSamples === 0
  /** Count of trades with a finite `r_multiple_actual` — denominator behind expectedR/expectedRMedian. */
  expectedRSamples: number;
  /** Sum(winR) / Sum(|lossR|). null when no losses. Infinity is collapsed to null + `profitFactorAllWins` flag (JSON-safe). */
  profitFactor: number | null;
  /** True when there are wins but zero losses — profit factor is mathematically undefined / unbounded. */
  profitFactorAllWins: boolean;
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
  idealSlMedianPips: number | null;   // pips (S2.2: was `idealSlMedian`; unified with edge)
  slInitialMedianPips: number | null; // pips (S2.2: was `slInitialMedian`)
  /** @deprecated S2.2 — use `idealSlMedianPips`. Kept as a read-only alias for callers
   *  still on the old name; populated by `computeBucket`. */
  idealSlMedian?: number | null;
  /** @deprecated S2.2 — use `slInitialMedianPips`. */
  slInitialMedian?: number | null;
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
  /** Closed trades in this bucket, ordered by entry_time. Powers drift + cumulative chart. */
  events: BucketEvent[];
  /** Trailing window size used to compute `recent*` / `drift`. */
  recentN: number;
  /** Win rate over the last `recentN` events. null when fewer than 5 events. */
  recentWinRate: number | null;
  /** Mean R over the last `recentN` events. null when fewer than 5 events. */
  recentExpectedR: number | null;
  /** (recentWinRate − winRate) in percentage points. null when recentWinRate null. */
  drift: number | null;
  /** Count of trades whose `events[].r` was inferred from net_pnl sign (no r_multiple_actual). Surface as a "R inferred" badge. */
  eventsRFallbackCount: number;
}


/**
 * One row of the hypothetical SL sweep. CAVEAT: rescaling assumes purely
 * proportional sizing — trades that took partials, moved SL to BE, or used
 * trailing stops are over-deflated at wider candidate SLs because the actual
 * R was never at risk to the full new SL distance. Any UI that renders these
 * rows MUST surface this limitation (tooltip on the meanR / deltaR column).
 */
export interface SlSweepRow {
  /** Quantile of MAE distribution (e.g. 0.25, 0.40, 0.55, 0.70, 0.90). */
  q: number;
  /** SL distance in pips at this quantile. */
  slPips: number;
  /** Fraction of trades stopped out at this SL (0–1). */
  pctStopped: number;
  /** Mean R-multiple under this hypothetical SL. See interface doc for caveat. */
  meanR: number;
  /** Delta vs actual mean R (meanR − expectedR). See interface doc for caveat. */
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
  /**
   * Provenance of `suggestedSlPips`.
   *  - "ideal_sl": median of user-logged ideal SL (cf_ideal_stop_loss). Preferred.
   *  - "winners_mae": MAE-of-winners quantile (Sweeney). Used when ideal-SL coverage < 5.
   *  - "winners_mae_fallback": MAE p75 × widen buffer. Used when neither of the above qualifies.
   *  - "legacy": no SL data — recommendation suppressed.
   */
  slSource: "ideal_sl" | "winners_mae" | "winners_mae_fallback" | "legacy";
  /** N trades backing the SL source (e.g. count of ideal-SL samples). null when legacy. */
  slSourceN: number | null;
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
  
];

export function resolvePairLabFieldKeys(defs: CustomFieldDef[]): PairLabFieldKeys {
  const out: PairLabFieldKeys = {
    mfe: null, mae: null,
    idealStopLoss: null, idealStopLossPos: null,
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

/**
 * K2 fix: when more than one custom field matches a Pair-Lab alias (e.g. the
 * user created `cf_mae_v1` and `cf_mae_v2`), `resolvePairLabFieldKeys` picks
 * the first via `Array.find` and silently discards the second. Returns the
 * set of aliases that had >1 matching definition so the UI can warn.
 */
export function detectAmbiguousFieldKeys(defs: CustomFieldDef[]): Set<keyof PairLabFieldKeys> {
  const ambiguous = new Set<keyof PairLabFieldKeys>();
  for (const entry of LABEL_MAP) {
    const byLabel = defs.filter((d) => entry.labels.includes((d.label || "").trim().toLowerCase()));
    if (byLabel.length > 1) { ambiguous.add(entry.alias); continue; }
    // Only count prefix collisions when the label didn't already nail down
    // a single match — label wins over prefix in resolvePairLabFieldKeys.
    if (byLabel.length === 1) continue;
    const byPrefix = defs.filter((d) => entry.prefixes.some((p) => (d.key || "").startsWith(p)));
    if (byPrefix.length > 1) ambiguous.add(entry.alias);
  }
  return ambiguous;
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
  closedOnly?: boolean;
  symbolResolver?: (raw: string) => string;
  propFirm?: PropFirmContext | null;
  /** Walk-forward: only include trades whose entry_time falls inside [dateFrom, dateTo]. ISO strings. */
  dateFrom?: string | null;
  dateTo?: string | null;
  /** Window length for `recent*` / `drift`. Default 10. */
  recentN?: number;
  /** When false (default) excludes ideas/paper/missed/dismissed/zero-PnL setup rows from every stat. */
  includeUnrealized?: boolean;
}

export interface BuildBucketsResult {
  perCell: BucketReport[];
  perRow: BucketReport[];
  baseline: BucketReport;
  /** How many trades were dropped because `isUnrealized(t)` returned true. */
  unrealizedExcluded: number;
}

export function buildBuckets(
  trades: Trade[],
  keys: PairLabFieldKeys,
  opts: BuildBucketsOpts = {},
): BuildBucketsResult {
  const closedOnly = opts.closedOnly !== false;
  const resolveSym = opts.symbolResolver ?? ((s: string) => s);
  const recentN = opts.recentN ?? 10;
  const dateFrom = opts.dateFrom ?? null;
  const dateTo = opts.dateTo ?? null;
  const includeUnrealized = opts.includeUnrealized === true;
  let unrealizedExcluded = 0;
  const filtered = trades.filter((t) => {
    if (closedOnly && t.is_open) return false;
    if (t.is_archived) return false;
    if (opts.profile && t.profile !== opts.profile && t.actual_profile !== opts.profile) return false;
    if (dateFrom || dateTo) {
      // S2.7: epoch-ms comparison via ensureUtcMs. ASCII string compare on
      // "2024-03-15 09:30:00" vs "2024-03-15T07:00:00.000Z" treats the naive
      // ' ' (0x20) as < 'T' (0x54), pulling every CSV-imported row earlier
      // than UTC strings and wrongly splitting the OOS window.
      const tsMs = ensureUtcMs(t.entry_time);
      if (!Number.isFinite(tsMs)) return false;
      if (dateFrom) {
        const fromMs = ensureUtcMs(dateFrom);
        if (Number.isFinite(fromMs) && tsMs < fromMs) return false;
      }
      if (dateTo) {
        const toMs = ensureUtcMs(dateTo);
        if (Number.isFinite(toMs) && tsMs > toMs) return false;
      }
    }
    if (!includeUnrealized && isUnrealized(t)) {
      unrealizedExcluded += 1;
      return false;
    }
    return true;
  });

  const baseline = computeBucket(
    { symbol: "All", session: "All sessions" },
    filtered,
    keys,
    null,
    opts.propFirm ?? null,
    recentN,
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
    const report = computeBucket({ symbol, session }, rows, keys, baseline, opts.propFirm ?? null, recentN);
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
      recentN,
    );
    report.rawSymbols = Array.from(rowRawSymbols.get(symbol) ?? []).sort();
    perRow.push(report);
  });

  perCell.sort((a, b) => (b.n - a.n) || a.key.symbol.localeCompare(b.key.symbol));
  perRow.sort((a, b) => b.n - a.n);
  return { perCell, perRow, baseline, unrealizedExcluded };
}

// Unified "side of trade" classifier — uses r_multiple_actual when present
// (precise, BE = 0), falls back to net_pnl sign. Shared by streak math and
// `computeBucket.sideOf` so a commission-only BE never counts as a loss in
// one place and a non-loss in another.
function tradeSide(t: Trade | any): 1 | -1 | 0 {
  if (t?.r_multiple_actual != null) {
    if (t.r_multiple_actual > 0) return 1;
    if (t.r_multiple_actual < 0) return -1;
    return 0;
  }
  const p = t?.net_pnl ?? 0;
  return p > 0 ? 1 : p < 0 ? -1 : 0;
}

function longestLossStreak(rows: Trade[]): number {
  // R1.1: closed-only gate via `!is_open`. Previously `net_pnl != null` let
  // MT5 floating P&L on live positions bleed into streak math.
  const sorted = [...rows]
    .filter((t) => !t.is_open && t.entry_time)
    .sort((a, b) => ensureUtcMs(a.entry_time) - ensureUtcMs(b.entry_time));
  let run = 0;
  let worst = 0;
  for (const t of sorted) {
    if (tradeSide(t) === -1) {
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
  if (pairs.length < 10) return null; // O4 fix: 5 was too noisy for a TP recommendation
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
  recentN: number = 10,
): BucketReport {
  // R1.1: closed-only gate via `!is_open`. The previous `net_pnl != null`
  // filter let floating-P&L on live positions enter win/loss/Kelly math.
  const closed = rows.filter((t) => !t.is_open);

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

  // R1.3: explicitly reject NaN/Infinity. Previously `!= null` let
  // pathological R values through and shifted both mean and CI.
  const rActuals = closed.map((t) => t.r_multiple_actual).filter((v): v is number => v != null && Number.isFinite(v));
  const winR = wins.map((t) => t.r_multiple_actual).filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
  const lossR = losses
    .map((t) => t.r_multiple_actual)
    .filter((v): v is number => v != null && Number.isFinite(v) && v < 0)
    .map((v) => Math.abs(v));

  const mfes = rows.map((t) => numericCf(t as any, keys.mfe)).filter((v): v is number => v != null);
  // Paired (mfeR, rActual) used by computeTp1Star for empirical miss-cost.
  // B-fix: drop unrealized rows (idea / paper / missed / dismissed / zero-PnL
  // no-mod) so `includeUnrealized=true` doesn't lower the hit-rate denominator
  // by feeding `{ mfeR, rActual: null }` pairs that can never count as hits.
  const mfeRPairsForTp1: Array<{ mfeR: number; rActual: number | null }> = [];
  for (const t of rows) {
    if (isUnrealized(t as any)) continue;
    const m = numericCf(t as any, keys.mfe);
    if (m == null) continue;
    mfeRPairsForTp1.push({ mfeR: m, rActual: t.r_multiple_actual ?? null });
  }


  // MAE is stored in TICKS. Convert each value to pips for the SL math and to
  // R for the distribution display.
  //
  // S1.3 fix: SL distance for the R denominator now uses `resolveSlAtMae(t)`
  // (sl_final / latest sl modification ≤ exit), not raw `sl_initial`. Trades
  // moved to BE before the worst drawdown bar therefore drop out of `maesR`
  // instead of producing tiny 0.10–0.30 R-at-risk values that systematically
  // tightened the recommended SL.
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
    const slDistPrice = resolveSlAtMae(t);
    if (slDistPrice != null) {
      const slDistPips = slDistPrice / pip;
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
  // expectedR is NaN (not 0) when there is zero R coverage so the UI can
  // distinguish "no data" from a true zero-edge bucket. `expectedRSamples`
  // surfaces the underlying denominator for coverage chips.
  const expectedR = mean(rActuals) ?? NaN;
  const expectedRMedian = median(rActuals) ?? NaN;

  const sumWin = winR.reduce((s, v) => s + v, 0);
  const sumLoss = lossR.reduce((s, v) => s + v, 0);
  // PF math: ratio when both sides exist; null + `allWins` flag when no
  // losses (PF is mathematically undefined — JSON.stringify(Infinity)=null
  // would silently look identical to "no data").
  const profitFactorAllWins = sumLoss <= 0 && sumWin > 0;
  const profitFactor = sumLoss > 0 ? sumWin / sumLoss : null;
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
  //
  // CAVEAT (do not hide from consumers): the rescaling assumes purely
  // proportional sizing. Trades that took partials, moved SL to BE, or used
  // trailing stops are over-deflated at wider candidate SLs because the actual
  // R was never at risk to the full new SL distance. Surface this caveat in
  // any UI that renders `slSweep` (currently un-rendered — see SlSweepRow doc).
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
      // R1.5: baseline must come from the same population the sweep replays
      // over (sweepRows: trades with both MAE+SL). Previously deltaR used the
      // whole-bucket expectedR, which biases every Δ in one direction when
      // MAE coverage is incomplete.
      const sweepBaseR = sweepRows.reduce((s, r) => s + r.rActual, 0) / sweepRows.length;
      sweepOut.push({
        q,
        slPips: slCand,
        pctStopped: stopped / sweepRows.length,
        meanR,
        deltaR: meanR - sweepBaseR,
      });
    }
    if (sweepOut.length > 0) slSweep = sweepOut;
  }



  // Walk-forward event timeline — closed trades ordered by entry_time.
  // Used by the drift signal (recent vs lifetime) and the cumulative drilldown chart.
  // When r_multiple_actual is missing we infer ±1 from net_pnl sign; that count
  // is surfaced as `eventsRFallbackCount` so the UI can flag noisy buckets.
  let eventsRFallbackCount = 0;
  const events: BucketEvent[] = [...closed]
    .filter((t) => t.entry_time)
    // R1.6: numeric epoch sort. localeCompare on ISO strings drifts at the
    // OOS 70/30 boundary when entries mix `Z` and `+00:00` suffixes.
    .sort((a, b) => ensureUtcMs(a.entry_time) - ensureUtcMs(b.entry_time))
    .map((t) => {
      const hasR = t.r_multiple_actual != null && Number.isFinite(t.r_multiple_actual);
      if (!hasR) eventsRFallbackCount += 1;
      const r = hasR
        ? (t.r_multiple_actual as number)
        : ((t.net_pnl ?? 0) > 0 ? 1 : (t.net_pnl ?? 0) < 0 ? -1 : 0);
      return { ts: String(t.entry_time), won: r > 0, r };
    });
  const tail = events.slice(-recentN);
  const recentEnough = tail.length >= 5;
  const recentWinRate = recentEnough
    ? tail.filter((e) => e.won).length / tail.length
    : null;
  const recentExpectedR = recentEnough
    ? tail.reduce((s, e) => s + e.r, 0) / tail.length
    : null;
  const drift = recentWinRate != null
    ? (recentWinRate - winRate) * 100
    : null;

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
    expectedRSamples: rActuals.length,
    profitFactor,
    profitFactorAllWins,
    payoffRatio,
    mfeP50: median(mfes),
    mfeP75: quantile(mfes, 0.75),
    maeP50: median(maesR),
    maeP75: quantile(maesR, 0.75),
    maeP75Pips: quantile(maesPips, 0.75),
    maeP50Ticks: median(maesTicks),
    maeP75Ticks: quantile(maesTicks, 0.75),
    mfeMin: mfes.length > 0 ? mfes.reduce((a, b) => (a < b ? a : b)) : null,
    mfeMax: mfes.length > 0 ? mfes.reduce((a, b) => (a > b ? a : b)) : null,
    maeMinTicks: maesTicks.length > 0 ? maesTicks.reduce((a, b) => (a < b ? a : b)) : null,
    maeMaxTicks: maesTicks.length > 0 ? maesTicks.reduce((a, b) => (a > b ? a : b)) : null,
    idealSlMedianPips: idealMed,
    slInitialMedianPips: slInitMed,
    // Deprecated aliases — kept populated so any consumer still reading the
    // old names sees the same number until they upgrade. Will be removed.
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
    loggedIdealSlCount: idealSls.length,
    slSweep,
    events,
    recentN,
    recentWinRate,
    recentExpectedR,
    drift,
    eventsRFallbackCount,
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
  // C1 fix (2026-06): iterate raw rows so the SL recommendation isn't gated
  // on `sl_initial != null` (the old `sweepRows` filter excluded perfectly
  // good winners whose initial SL wasn't recorded — only the SL-sweep needs
  // that field, not the MAE-of-winners quantile). Mirrors edge ll. 416-422.
  const winnersMaePips: number[] = [];
  for (const t of rows) {
    if (t.r_multiple_actual == null || !(t.r_multiple_actual > 0)) continue;
    const maeTicks = numericCf(t as any, keys.mae);
    if (maeTicks == null || !t.symbol) continue;
    winnersMaePips.push(Math.abs(ticksToPips(t.symbol, Math.abs(maeTicks))));
  }
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
): { tpR: number; expectancy: number; ladder: number[]; ci: [number, number] | null } | null {
  if (pairs.length < 10) return null;
  // Q5: dynamic ceiling. Hard-cap 4R hid genuine outsize-MFE edges (e.g. news).
  // Extend grid to the 95th-percentile MFE (clamped to [4R, 10R]) so we can
  // surface 5R+ TPs on pairs that consistently print large excursions.
  const sortedMfe = pairs.map((p) => p.mfeR).sort((a, b) => a - b);
  const p95 = sortedMfe[Math.min(sortedMfe.length - 1, Math.floor(sortedMfe.length * 0.95))] ?? 4;
  const ceiling = Math.min(10, Math.max(4, Math.ceil(p95 * 4) / 4));
  const grid: number[] = [];
  for (let r = 0.5; r <= ceiling + 1e-6; r += 0.25) grid.push(Math.round(r * 4) / 4);
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
  // O1 fix: drop unrealized rows BEFORE the chronological split. Previously
  // ideas/paper/missed could land in either IS or OOS slice, leaking noise
  // into the degradation %.
  const closed = rows.filter(
    // R1.1: closed-only gate via `!is_open`.
    (t) => !t.is_open && t.entry_time && !isUnrealized(t as any),
  );
  if (closed.length < 30) return null;
  const sorted = [...closed].sort(
    // R1.6: numeric epoch sort.
    (a, b) => Date.parse(String(a.entry_time)) - Date.parse(String(b.entry_time)),
  );
  const cutoff = Math.floor(sorted.length * 0.7);
  const isRows = sorted.slice(0, cutoff);
  const oosRows = sorted.slice(cutoff);
  // Q4: standardise on DATA_TIER_INSUFFICIENT_N (10) — previously 9 inconsistently.
  if (oosRows.length < 10) return null;

  const isPairs = collectMfeRPairs(isRows, keys);
  const oosPairs = collectMfeRPairs(oosRows, keys);
  if (isPairs.length < 10 || oosPairs.length < 5) return null;

  // Walk-forward must not estimate trailCapture on the OOS slice. We no
  // longer pass `trail` into `scoreTp`/`pickBestTp` (dead parameter removed),
  // but `pickBestTp`'s signature still accepts it as `_trail` for API
  // stability — passing 0 is a no-op.
  const isPick = pickBestTp(isPairs);
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
  // ----- SL source cascade -----
  // Priority: ideal SL (user-logged structural stop) > MAE-of-winners (Sweeney)
  // > MAE p75 widen fallback. Ideal SL reflects the user's actual rule ("SL at
  // structure"); MAE is only a survival heuristic when structure isn't logged.
  let suggestedSlPips: number | null = null;
  let slSource: BucketRecommendation["slSource"] = "legacy";
  let slSourceN: number | null = null;

  const IDEAL_SL_MIN_N = 5;
  const idealMed = s.idealSlMedianPips ?? s.idealSlMedian ?? null;
  if (
    idealMed != null &&
    idealMed > 0 &&
    s.loggedIdealSlCount >= IDEAL_SL_MIN_N
  ) {
    suggestedSlPips = idealMed;
    slSource = "ideal_sl";
    slSourceN = s.loggedIdealSlCount;
  } else {
    const slWinners = ctx.winnersMaePips.length >= 10
      ? quantile(ctx.winnersMaePips, WINNERS_MAE_SL_QUANTILE)
      : null;
    if (slWinners != null && slWinners > 0) {
      suggestedSlPips = slWinners * WINNERS_MAE_SL_BUFFER;
      slSource = "winners_mae";
      slSourceN = ctx.winnersMaePips.length;
    } else if (s.maeP75Pips != null) {
      suggestedSlPips = s.maeP75Pips * MAE_P75_WIDEN_BUFFER;
      slSource = "winners_mae_fallback";
      slSourceN = s.loggedMaeCount;
    } else if (s.idealSlMedian != null && s.idealSlMedian > 0) {
      // Ideal SL present but below min-N → use it but mark as fallback grade.
      suggestedSlPips = s.idealSlMedian;
      slSource = "ideal_sl";
      slSourceN = s.loggedIdealSlCount;
    }
  }
  const slMethod: "legacy" | "ok" = slSource === "legacy" ? "legacy" : "ok";

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

  const pick = pickBestTp(ctx.mfeRPairs);
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
  // G6 parity: mirror edge — require `dailyLossDollars > 0` (treat 0 as
  // unset, not as a hard floor of 0.1%) and fall back hardCap to 2 when
  // `hardCapPct <= 0` so a missing profile setting doesn't clamp to 0.
  if (
    propFirm &&
    propFirm.balance > 0 &&
    propFirm.dailyLossDollars != null &&
    propFirm.dailyLossDollars > 0
  ) {
    const streak = Math.max(MIN_STREAK_FLOOR, s.worstLosingStreak || 0);
    const dailyBudgetPct = (propFirm.dailyLossDollars / propFirm.balance) * 100;
    const ddCappedPct = dailyBudgetPct / streak;
    const hardCap = propFirm.hardCapPct > 0 ? propFirm.hardCapPct : 2;
    suggestedRiskPctPropFirm = Math.max(0.1, Math.min(hardCap, ddCappedPct));

    if (suggestedRiskPct == null) {
      bindingConstraint = "prop_firm_dd";
    } else if (suggestedRiskPctPropFirm < suggestedRiskPct) {
      bindingConstraint = suggestedRiskPctPropFirm >= hardCap - 0.001
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
    slSource,
    slSourceN,
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
// Replaces the hardcoded TRAIL_CAPTURE_FRAC fallback (currently 0.7) in the
// simulator when the user has enough trades with both MFE and r_actual logged.
// Excludes all-out exits at TP (r_actual == MFE) since those have no trail.
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
