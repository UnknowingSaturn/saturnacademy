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
//   - We never recommend a TP target the trader has never actually reached
//     according to cf_tp_reached, even if the MFE distribution suggests it.
//   - Kelly is scaled to 0.25 (quarter-Kelly) and clamped, because the sample
//     sizes here are tiny by quant standards.
//   - Confidence is exposed as a sample-size bucket so the UI can hide the
//     numeric output when N < 10.
// ============================================================================

import type { Trade } from "@/types/trading";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface PairLabFieldKeys {
  mfe: string | null;            // number (R-multiple)
  mae: string | null;            // number (pips OR R, user decides)
  tpReached: string | null;      // multi_select (["1:1","1:2",…])
  idealStopLoss: string | null;  // number (pips)
  idealStopLossPos: string | null; // select (initial_leg | last_leg)
  idealEntryWindow: string | null; // select (first_30min | last_30min)
}

export interface BucketKey {
  symbol: string;
  session: string;       // "Tokyo" | "London" | "NY AM" | "NY PM" | "All sessions"
}

export interface BucketStats {
  key: BucketKey;
  n: number;
  wins: number;
  losses: number;
  winRate: number;            // 0–1
  expectedR: number;          // average R-multiple, mean of r_multiple_actual
  expectedRMedian: number;    // median R-multiple
  mfeP50: number | null;
  mfeP75: number | null;
  maeP50: number | null;
  maeP75: number | null;
  idealSlMedian: number | null;
  slInitialMedian: number | null;
  slDrift: "too_wide" | "too_tight" | "aligned" | null;
  tpHitDistribution: Record<string, number>; // "1:1" -> count
  mostCommonTpHit: string | null;
  confidence: ConfidenceLevel;
  // Two-sided bootstrap CI on expectedR — null when n < 5.
  expectedRCi: [number, number] | null;
}

export interface BucketRecommendation {
  suggestedSlPips: number | null;
  tpLadderR: number[];           // ascending R targets, 1-3 entries
  suggestedRiskPct: number | null; // % of account
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
  { alias: "tpReached",        labels: ["tp reached", "tps hit", "tp's hit", "tps reached"],                        prefixes: ["cf_tp_reached", "cf_tps_hit"] },
  { alias: "idealStopLoss",    labels: ["ideal stop-loss", "ideal stop loss", "ideal sl"],                          prefixes: ["cf_ideal_stop_loss_rnv7", "cf_ideal_stop_loss"] },
  { alias: "idealStopLossPos", labels: ["ideal stop-loss position", "ideal stop loss position"],                    prefixes: ["cf_ideal_stop_loss_position"] },
  { alias: "idealEntryWindow", labels: ["ideal entry window"],                                                      prefixes: ["cf_ideal_entry_window"] },
];

export function resolvePairLabFieldKeys(defs: CustomFieldDef[]): PairLabFieldKeys {
  const out: PairLabFieldKeys = {
    mfe: null, mae: null, tpReached: null,
    idealStopLoss: null, idealStopLossPos: null, idealEntryWindow: null,
  };
  for (const entry of LABEL_MAP) {
    // Prefer exact-position match (idealStopLoss vs idealStopLossPos) by
    // checking the more specific entry first — order in LABEL_MAP matters.
    const byLabel = defs.find((d) => entry.labels.includes((d.label || "").trim().toLowerCase()));
    if (byLabel) { out[entry.alias] = byLabel.key; continue; }
    const byPrefix = defs.find((d) => entry.prefixes.some((p) => (d.key || "").startsWith(p)));
    if (byPrefix) out[entry.alias] = byPrefix.key;
  }
  // Disambiguate: "Ideal Stop-Loss" prefix also matches "Ideal Stop-Loss Position".
  // If both ended up pointing at the same key, prefer the more specific one for Pos.
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

// Bootstrap mean CI (2.5% / 97.5%) with `iters` resamples.
// Deterministic seed so the UI doesn't flicker between renders.
export function bootstrapMeanCi(values: number[], iters = 500): [number, number] | null {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length < 5) return null;
  let seed = xs.length * 1000003;
  const rand = () => {
    // xorshift32
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) % 1_000_000) / 1_000_000;
  };
  const means: number[] = new Array(iters);
  for (let i = 0; i < iters; i++) {
    let sum = 0;
    for (let j = 0; j < xs.length; j++) sum += xs[Math.floor(rand() * xs.length)];
    means[i] = sum / xs.length;
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(iters * 0.025)], means[Math.floor(iters * 0.975)]];
}

// Quarter-Kelly with a hard clamp. Returns null when the edge is non-positive.
export function quarterKellyPct(winRate: number, avgWinR: number, avgLossR: number): number | null {
  if (!(avgWinR > 0) || !(avgLossR > 0)) return null;
  const b = avgWinR / avgLossR;
  const p = winRate;
  const q = 1 - p;
  const kelly = (b * p - q) / b;
  if (kelly <= 0) return null;
  const quarter = kelly * 0.25 * 100; // percent of account
  return Math.max(0.25, Math.min(1.5, quarter));
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

function multiSelectCf(trade: any, key: string | null): string[] {
  const v = getCf(trade, key);
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v) return [v];
  return [];
}

function confidenceFor(n: number): ConfidenceLevel {
  if (n >= 30) return "high";
  if (n >= 10) return "medium";
  return "low";
}

export interface BuildBucketsOpts {
  /** Optional filter — only trades with a matching planned profile. */
  profile?: string | null;
  /** Optional filter — only trades whose actual_profile matches. */
  actualProfile?: string | null;
  /** Closed trades only when true (default). */
  closedOnly?: boolean;
}

export function buildBuckets(
  trades: Trade[],
  keys: PairLabFieldKeys,
  opts: BuildBucketsOpts = {},
): { perCell: BucketReport[]; perRow: BucketReport[]; baseline: BucketReport } {
  const closedOnly = opts.closedOnly !== false;
  const filtered = trades.filter((t) => {
    if (closedOnly && t.is_open) return false;
    if (t.is_archived) return false;
    if (opts.profile && t.profile !== opts.profile) return false;
    if (opts.actualProfile && t.actual_profile !== opts.actualProfile) return false;
    return true;
  });

  // Baseline = all symbols, all sessions (used for edge deltas).
  const baseline = computeBucket({ symbol: "All", session: "All sessions" }, filtered, keys, null);

  // Per-cell (symbol × session) and per-row (symbol × "All sessions").
  const cellMap = new Map<string, Trade[]>();
  const rowMap = new Map<string, Trade[]>();
  for (const t of filtered) {
    if (!t.symbol) continue;
    const sess = normalizeSession(t.session);
    const cellKey = `${t.symbol}__${sess}`;
    if (!cellMap.has(cellKey)) cellMap.set(cellKey, []);
    cellMap.get(cellKey)!.push(t);
    if (!rowMap.has(t.symbol)) rowMap.set(t.symbol, []);
    rowMap.get(t.symbol)!.push(t);
  }

  const perCell: BucketReport[] = [];
  cellMap.forEach((rows, cellKey) => {
    const [symbol, session] = cellKey.split("__");
    perCell.push(computeBucket({ symbol, session }, rows, keys, baseline));
  });
  const perRow: BucketReport[] = [];
  rowMap.forEach((rows, symbol) => {
    perRow.push(computeBucket({ symbol, session: "All sessions" }, rows, keys, baseline));
  });

  perCell.sort((a, b) => (b.n - a.n) || a.key.symbol.localeCompare(b.key.symbol));
  perRow.sort((a, b) => b.n - a.n);
  return { perCell, perRow, baseline };
}

function computeBucket(
  key: BucketKey,
  rows: Trade[],
  keys: PairLabFieldKeys,
  baseline: BucketReport | null,
): BucketReport {
  const closed = rows.filter((t) => t.net_pnl != null);
  const wins = closed.filter((t) => (t.net_pnl ?? 0) > 0);
  const losses = closed.filter((t) => (t.net_pnl ?? 0) < 0);

  const rActuals = closed.map((t) => t.r_multiple_actual).filter((v): v is number => v != null);
  const winR = wins.map((t) => t.r_multiple_actual).filter((v): v is number => v != null && v > 0);
  const lossR = losses
    .map((t) => t.r_multiple_actual)
    .filter((v): v is number => v != null && v < 0)
    .map((v) => Math.abs(v));

  const mfes = rows.map((t) => numericCf(t as any, keys.mfe)).filter((v): v is number => v != null);
  const maes = rows.map((t) => numericCf(t as any, keys.mae)).filter((v): v is number => v != null);
  const idealSls = rows.map((t) => numericCf(t as any, keys.idealStopLoss)).filter((v): v is number => v != null);

  const slInitials: number[] = [];
  for (const t of rows) {
    if (t.sl_initial == null || t.entry_price == null) continue;
    // Convert SL distance to pips using a coarse 4-digit assumption — same
    // unit the user enters cf_ideal_stop_loss in. JPY/index handling left
    // to the user's existing journal conventions.
    const distance = Math.abs(t.entry_price - t.sl_initial);
    const digits = String(t.entry_price).split(".")[1]?.length ?? 4;
    const pipMultiplier = digits >= 4 ? 10_000 : 100;
    slInitials.push(distance * pipMultiplier);
  }

  // TP-hit distribution.
  const tpDist: Record<string, number> = {};
  for (const t of rows) {
    for (const v of multiSelectCf(t as any, keys.tpReached)) {
      tpDist[v] = (tpDist[v] ?? 0) + 1;
    }
  }
  const mostCommonTpHit = Object.entries(tpDist).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const n = closed.length;
  const winRate = n > 0 ? wins.length / n : 0;
  const expectedR = mean(rActuals);
  const expectedRMedian = median(rActuals) ?? 0;

  const idealMed = median(idealSls);
  const slInitMed = median(slInitials);
  let slDrift: BucketStats["slDrift"] = null;
  if (idealMed != null && slInitMed != null) {
    const ratio = idealMed / slInitMed;
    if (ratio < 0.8) slDrift = "too_wide";
    else if (ratio > 1.2) slDrift = "too_tight";
    else slDrift = "aligned";
  }

  const stats: BucketStats = {
    key,
    n,
    wins: wins.length,
    losses: losses.length,
    winRate,
    expectedR,
    expectedRMedian,
    mfeP50: median(mfes),
    mfeP75: quantile(mfes, 0.75),
    maeP50: median(maes),
    maeP75: quantile(maes, 0.75),
    idealSlMedian: idealMed,
    slInitialMedian: slInitMed,
    slDrift,
    tpHitDistribution: tpDist,
    mostCommonTpHit,
    confidence: confidenceFor(n),
    expectedRCi: bootstrapMeanCi(rActuals),
  };

  const recommendation = buildRecommendation(stats, winR, lossR, baseline);

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
  baseline: BucketReport | null,
): BucketRecommendation {
  // SL: max of (p75(MAE) × 1.15, median(ideal SL)). Both are in pips.
  let suggestedSlPips: number | null = null;
  const maeCandidate = s.maeP75 != null ? s.maeP75 * 1.15 : null;
  if (maeCandidate != null || s.idealSlMedian != null) {
    suggestedSlPips = Math.max(maeCandidate ?? 0, s.idealSlMedian ?? 0);
  }

  // TP ladder from MFE percentiles, capped by the most-common TP hit so we
  // never recommend a target the user has never reached in practice.
  const ladder: number[] = [];
  const cap = (() => {
    if (!s.mostCommonTpHit) return Infinity;
    const m = /1\s*:\s*(\d+(?:\.\d+)?)/.exec(s.mostCommonTpHit);
    return m ? Number(m[1]) : Infinity;
  })();
  const p70 = quantile(winR, 0.3); // R reached by ≥70 % of winners
  const p50 = quantile(winR, 0.5);
  const p25 = quantile(winR, 0.75);
  for (const v of [p70, p50, p25]) {
    if (v == null || v <= 0) continue;
    ladder.push(Math.min(v, cap));
  }
  // Deduplicate near-equal targets and round to 0.25R.
  const tpLadderR = Array.from(new Set(ladder.map((v) => Math.round(v * 4) / 4))).slice(0, 3);

  // Kelly sizing.
  const avgWinR = winR.length > 0 ? winR.reduce((s, v) => s + v, 0) / winR.length : 0;
  const avgLossR = lossR.length > 0 ? lossR.reduce((s, v) => s + v, 0) / lossR.length : 1;
  const suggestedRiskPct = s.n >= 10 ? quarterKellyPct(s.winRate, avgWinR, avgLossR) : null;

  let edgeVsBaseline: BucketRecommendation["edgeVsBaseline"] = null;
  if (baseline && baseline.n > 0 && s.key.symbol !== "All") {
    edgeVsBaseline = {
      winRateDelta: (s.winRate - baseline.winRate) * 100,
      expectedRDelta: s.expectedR - baseline.expectedR,
    };
  }

  return { suggestedSlPips, tpLadderR, suggestedRiskPct, edgeVsBaseline };
}
