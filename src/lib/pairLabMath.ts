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
import { tickSizeForSymbol, pipSizeForSymbol, ticksToPips } from "@/lib/symbolMapping";

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

export interface PropFirmContext {
  /** Account balance in money — used to translate DD limits to R. */
  balance: number;
  /** Daily loss limit as $ (already converted from % if needed). */
  dailyLossDollars: number | null;
  /** Max drawdown limit as $. */
  maxDrawdownDollars: number | null;
  /** User's planned risk per trade as a fraction (e.g. 0.01 for 1%). */
  riskPerTradeFrac: number;
  /** Hard cap on suggested risk %, e.g. account.risk_per_trade_cap or 2. */
  hardCapPct: number;
  firmName: string | null;
}

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
}

export interface BucketReport extends BucketStats {
  recommendation: BucketRecommendation;
  // Best / worst trades for citation (most positive / most negative R).
  topTradeIds: string[];
  bottomTradeIds: string[];
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
// Robust statistics
// ----------------------------------------------------------------------------

export function quantile(values: number[], q: number): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (xs.length === 0) return null;
  if (xs.length === 1) return xs[0];
  const pos = (xs.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const w = pos - lo;
  return xs[lo] * (1 - w) + xs[hi] * w;
}

export function median(values: number[]): number | null {
  return quantile(values, 0.5);
}

export function mean(values: number[]): number {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length === 0) return 0;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

/** Sample standard deviation (Bessel-corrected). 0 when n < 2. */
export function stddev(values: number[]): number {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length < 2) return 0;
  const m = xs.reduce((s, v) => s + v, 0) / xs.length;
  const ss = xs.reduce((s, v) => s + (v - m) * (v - m), 0);
  return Math.sqrt(ss / (xs.length - 1));
}

/** Downside deviation (penalises only sub-target outcomes). */
export function downsideStddev(values: number[], target = 0): number {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length < 2) return 0;
  const ss = xs.reduce((s, v) => s + Math.min(0, v - target) ** 2, 0);
  return Math.sqrt(ss / (xs.length - 1));
}

/**
 * Wilson 95% confidence interval for a binomial proportion.
 * Better than the normal approximation at small N. Returns null when n=0.
 */
export function wilsonCi(successes: number, n: number, z = 1.96): [number, number] | null {
  if (n <= 0) return null;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}

// Seeded xorshift32 — deterministic across renders.
function makeSeededRng(seedBase: number) {
  let seed = seedBase | 0;
  if (seed === 0) seed = 0x9e3779b9;
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) % 1_000_000) / 1_000_000;
  };
}

// Bootstrap mean CI (2.5% / 97.5%). Deterministic seed derived from both
// sample size and a value hash so two buckets with the same N but different
// values don't share an artificial CI alignment.
export function bootstrapMeanCi(values: number[], iters = 500): [number, number] | null {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length < 5) return null;
  let hash = xs.length * 1000003;
  for (let i = 0; i < xs.length; i++) {
    hash = (hash * 31 + Math.floor(xs[i] * 1000)) | 0;
  }
  const rand = makeSeededRng(hash);
  const means: number[] = new Array(iters);
  for (let i = 0; i < iters; i++) {
    let sum = 0;
    for (let j = 0; j < xs.length; j++) sum += xs[Math.floor(rand() * xs.length)];
    means[i] = sum / xs.length;
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(iters * 0.025)], means[Math.floor(iters * 0.975)]];
}

/**
 * One-sided bootstrap p-value that mean(values) > 0.
 * Resamples with replacement; p = fraction of resampled means ≤ 0.
 * Returns null when n < 5. Floor at 1/iters to avoid log(0) downstream.
 */
export function bootstrapPositivePValue(values: number[], iters = 500): number | null {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length < 5) return null;
  let hash = xs.length * 1000003 + 7;
  for (let i = 0; i < xs.length; i++) {
    hash = (hash * 31 + Math.floor(xs[i] * 1000)) | 0;
  }
  const rand = makeSeededRng(hash);
  let nonPos = 0;
  for (let i = 0; i < iters; i++) {
    let sum = 0;
    for (let j = 0; j < xs.length; j++) sum += xs[Math.floor(rand() * xs.length)];
    if (sum / xs.length <= 0) nonPos += 1;
  }
  return Math.max(1 / iters, nonPos / iters);
}

/**
 * Benjamini–Hochberg FDR adjustment. Returns a boolean[] same length as `pvals`
 * marking which hypotheses are significant at level `alpha` after BH correction.
 * Entries with null p-value are treated as non-significant.
 */
export function bhSignificant(pvals: Array<number | null>, alpha = 0.05): boolean[] {
  const indexed = pvals
    .map((p, i) => ({ p, i }))
    .filter((x): x is { p: number; i: number } => x.p != null && Number.isFinite(x.p));
  indexed.sort((a, b) => a.p - b.p);
  const m = indexed.length;
  const out = new Array<boolean>(pvals.length).fill(false);
  if (m === 0) return out;
  // Find largest k with p_(k) ≤ k/m * alpha.
  let kMax = -1;
  for (let k = 1; k <= m; k++) {
    if (indexed[k - 1].p <= (k / m) * alpha) kMax = k;
  }
  if (kMax < 0) return out;
  for (let k = 0; k < kMax; k++) out[indexed[k].i] = true;
  return out;
}

/**
 * Bootstrap 95% CI on the raw quarter-Kelly fraction (percent of account).
 * Resamples paired (winR, lossR) outcomes, recomputes Kelly per resample.
 */
export function bootstrapKellyCi(
  winR: number[],
  lossR: number[],
  iters = 500,
): [number, number] | null {
  const wins = winR.filter((v) => Number.isFinite(v) && v > 0);
  const losses = lossR.filter((v) => Number.isFinite(v) && v > 0);
  const n = wins.length + losses.length;
  if (n < 10) return null;
  // Combined draw with outcome labels.
  const pool: Array<{ r: number; win: boolean }> = [
    ...wins.map((r) => ({ r, win: true })),
    ...losses.map((r) => ({ r, win: false })),
  ];
  const rand = makeSeededRng((n * 1000003) ^ Math.floor((wins[0] ?? 0) * 1000));
  const ks: number[] = [];
  for (let i = 0; i < iters; i++) {
    let w = 0, l = 0, sw = 0, sl = 0;
    for (let j = 0; j < n; j++) {
      const pick = pool[Math.floor(rand() * n)];
      if (pick.win) { w += 1; sw += pick.r; }
      else { l += 1; sl += pick.r; }
    }
    if (w === 0 || l === 0) continue;
    const avgW = sw / w;
    const avgL = sl / l;
    const p = w / (w + l);
    const b = avgW / avgL;
    const kelly = (b * p - (1 - p)) / b;
    ks.push(kelly * 0.25 * 100);
  }
  if (ks.length < 10) return null;
  ks.sort((a, b) => a - b);
  return [ks[Math.floor(ks.length * 0.025)], ks[Math.floor(ks.length * 0.975)]];
}

/** Raw quarter-Kelly value (percent of account), uncapped. Null when edge is non-positive. */
export function rawQuarterKellyPct(winRate: number, avgWinR: number, avgLossR: number): number | null {
  if (!(avgWinR > 0) || !(avgLossR > 0)) return null;
  const b = avgWinR / avgLossR;
  const p = winRate;
  const q = 1 - p;
  const kelly = (b * p - q) / b;
  if (kelly <= 0) return null;
  return kelly * 0.25 * 100;
}

/** Back-compat wrapper that clamps to the historical floor/ceiling. */
export function quarterKellyPct(winRate: number, avgWinR: number, avgLossR: number): number | null {
  const raw = rawQuarterKellyPct(winRate, avgWinR, avgLossR);
  if (raw == null) return null;
  return Math.max(0.25, Math.min(1.5, raw));
}

// ----------------------------------------------------------------------------
// Bucket build + stats
// ----------------------------------------------------------------------------

const SESSION_LABELS: Record<string, string> = {
  tokyo: "Tokyo",
  asia: "Tokyo",
  london: "London",
  ny_am: "NY AM",
  ny_pm: "NY PM",
  ny: "NY AM",
  new_york: "NY AM",
  new_york_am: "NY AM",
  new_york_pm: "NY PM",
};

export function normalizeSession(raw: string | null | undefined): string {
  if (!raw) return "Unknown";
  return SESSION_LABELS[String(raw).toLowerCase()] ?? raw;
}

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

function computeTp1Star(mfes: number[], avgLossR: number): Tp1Star | null {
  if (mfes.length < 5) return null;
  const candidates = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0];
  let best: Tp1Star | null = null;
  for (const r of candidates) {
    const hits = mfes.filter((v) => v >= r).length;
    const hitRate = hits / mfes.length;
    if (hitRate < 0.4) continue;
    const score = hitRate * Math.log(1 + r);
    const expectancyR = hitRate * r - (1 - hitRate) * avgLossR;
    if (!best || score > best.hitRate * Math.log(1 + best.r)) {
      best = { r, hitRate, hitRateCi: wilsonCi(hits, mfes.length), expectancyR };
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
    if (ratio < 0.8) slDrift = "too_wide";
    else if (ratio > 1.2) slDrift = "too_tight";
    else slDrift = "aligned";
  }

  // Hypothetical SL sweep: replay outcomes at candidate SLs drawn from the
  // MAE quantile distribution. If MAE > candidate SL, the trade is stopped
  // at −1R; otherwise the actual outcome is rescaled by the SL ratio.
  let slSweep: SlSweepRow[] | null = null;
  if (sweepRows.length >= 10) {
    const maePipsForQ = sweepRows.map((r) => r.maePips);
    const quants = [0.25, 0.4, 0.55, 0.7, 0.9];
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
    profitFactor: profitFactor === Infinity ? null : profitFactor,
    payoffRatio,
    mfeP50: median(mfes),
    mfeP75: quantile(mfes, 0.75),
    maeP50: median(maesR),
    maeP75: quantile(maesR, 0.75),
    maeP75Pips: quantile(maesPips, 0.75),
    maeP50Ticks: median(maesTicks),
    maeP75Ticks: quantile(maesTicks, 0.75),
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




  const recommendation = buildRecommendation(stats, winR, lossR, mfes, baseline, propFirm);

  const sorted = [...closed].sort(
    (a, b) => (b.r_multiple_actual ?? 0) - (a.r_multiple_actual ?? 0),
  );
  const topTradeIds = sorted.slice(0, 3).map((t) => t.id);
  const bottomTradeIds = sorted.slice(-3).reverse().map((t) => t.id);

  return { ...stats, recommendation, topTradeIds, bottomTradeIds };
}

function buildRecommendation(
  s: BucketStats,
  winR: number[],
  lossR: number[],
  mfes: number[],
  baseline: BucketReport | null,
  propFirm: PropFirmContext | null,
): BucketRecommendation {
  // SL: max of (p75(MAE pips) × 1.15, median(ideal SL pips)). Both in pips.
  let suggestedSlPips: number | null = null;
  const maeCandidate = s.maeP75Pips != null ? s.maeP75Pips * 1.15 : null;
  if (maeCandidate != null || s.idealSlMedian != null) {
    suggestedSlPips = Math.max(maeCandidate ?? 0, s.idealSlMedian ?? 0);
  }

  // TP ladder from win-R quantiles (conservative / median / aggressive).
  const ladder: number[] = [];
  const pConservative = quantile(winR, 0.3);
  const pMedian       = quantile(winR, 0.5);
  const pAggressive   = quantile(winR, 0.75);
  for (const v of [pConservative, pMedian, pAggressive]) {
    if (v == null || v <= 0) continue;
    ladder.push(v);
  }
  const tpLadderR = Array.from(new Set(ladder.map((v) => Math.round(v * 4) / 4))).slice(0, 3);


  const avgWinR = winR.length > 0 ? winR.reduce((a, v) => a + v, 0) / winR.length : 0;
  const avgLossR = lossR.length > 0 ? lossR.reduce((a, v) => a + v, 0) / lossR.length : 1;
  const rawKelly = s.n >= 10 ? rawQuarterKellyPct(s.winRate, avgWinR, avgLossR) : null;
  const suggestedRiskPct = rawKelly != null ? Math.min(1.5, rawKelly) : null;
  const riskBelowFloor = rawKelly != null && rawKelly < 0.25;
  const suggestedRiskPctCi = s.n >= 10 ? bootstrapKellyCi(winR, lossR) : null;

  const tp1Star = computeTp1Star(mfes, avgLossR || 1);

  // Prop-firm-aware risk cap. Uses observed worst losing streak (floored at 3)
  // to distribute the daily-loss budget over N consecutive full stops.
  let suggestedRiskPctPropFirm: number | null = null;
  let bindingConstraint: BucketRecommendation["bindingConstraint"] = null;
  if (propFirm && propFirm.balance > 0 && propFirm.dailyLossDollars != null) {
    const streak = Math.max(3, s.worstLosingStreak || 0);
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
