// Deno port of src/lib/pairLabMath.ts — pure-functional pieces only.
// Trade rows are duck-typed (any) since edge functions have raw DB rows.
//
// Field keys: we follow the same prefix-and-label resolver as the client so
// the edge function reads the same custom_fields as the UI does.
//
// UNIT CONTRACT (2026-06):
//   cf_mae and cf_ideal_stop_loss are stored in broker TICKS (TradingView
//   position-calc output). Convert with `ticksToPips()` before comparing
//   against pip-denominated SL distances. The slUnit field on each
//   BucketReport surfaces the human-readable label.
//
// Intentional divergence from src/lib/pairLabMath.ts:
//   - server version uses duck-typed `any` rows (raw DB shape)
//   - client version has PropFirmContext, perRow, edgeVsBaseline (UI-only)

import { tickSizeForSymbol, pipSizeForSymbol, pipLabelForSymbol, ticksToPips } from "./symbolMapping.ts";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface PairLabFieldKeys {
  mfe: string | null;
  mae: string | null;
  idealStopLoss: string | null;
  idealStopLossPos: string | null;
  idealEntryWindow: string | null;
}

interface CustomFieldDef { key: string; label: string }

export interface PropFirmContext {
  /** prop firm id (e.g. "ftmo"), for labelling. */
  firm: string;
  /** balance starting value, used to translate % rules to R cap. */
  balance: number;
  /** Daily loss limit as $. */
  dailyLossDollars: number | null;
  /** Max drawdown as $. */
  maxDrawdownDollars: number | null;
  /** Profit target as $. */
  profitTargetDollars: number | null;
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

// --- robust stats ---
export function quantile(values: number[], q: number): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (xs.length === 0) return null;
  if (xs.length === 1) return xs[0];
  const pos = (xs.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos), w = pos - lo;
  return xs[lo] * (1 - w) + xs[hi] * w;
}
export function median(values: number[]): number | null { return quantile(values, 0.5); }
export function mean(values: number[]): number {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length === 0) return 0;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}
export function bootstrapMeanCi(values: number[], iters = 500): [number, number] | null {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length < 5) return null;
  let seed = xs.length * 1000003;
  for (let i = 0; i < xs.length; i++) seed = (seed * 31 + Math.floor(xs[i] * 1000)) | 0;
  if (seed === 0) seed = 0x9e3779b9;
  const rand = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return ((seed >>> 0) % 1_000_000) / 1_000_000;
  };
  const means: number[] = new Array(iters);
  for (let i = 0; i < iters; i++) {
    let sum = 0;
    for (let j = 0; j < xs.length; j++) sum += xs[Math.floor(rand() * xs.length)];
    means[i] = sum / xs.length;
  }
  means.sort((a, b) => a - b);
  return [percentileFromSorted(means, 0.025), percentileFromSorted(means, 0.975)];
}

/** Standard NIST-type-7 percentile via linear interpolation. */
function percentileFromSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos), w = pos - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

/** One-sided bootstrap p-value that mean(values) > 0. Null when n < 5. */
export function bootstrapPositivePValue(values: number[], iters = 500): number | null {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length < 5) return null;
  let seed = xs.length * 1000003 + 7;
  for (let i = 0; i < xs.length; i++) seed = (seed * 31 + Math.floor(xs[i] * 1000)) | 0;
  if (seed === 0) seed = 0x9e3779b9;
  const rand = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return ((seed >>> 0) % 1_000_000) / 1_000_000;
  };
  let nonPos = 0;
  for (let i = 0; i < iters; i++) {
    let sum = 0;
    for (let j = 0; j < xs.length; j++) sum += xs[Math.floor(rand() * xs.length)];
    if (sum / xs.length <= 0) nonPos += 1;
  }
  return Math.max(1 / iters, nonPos / iters);
}

/** Benjamini–Hochberg FDR. Returns boolean[] aligned to input order. */
export function bhSignificant(pvals: Array<number | null>, alpha = 0.05): boolean[] {
  const indexed = pvals
    .map((p, i) => ({ p, i }))
    .filter((x): x is { p: number; i: number } => x.p != null && Number.isFinite(x.p));
  indexed.sort((a, b) => a.p - b.p);
  const m = indexed.length;
  const out = new Array<boolean>(pvals.length).fill(false);
  if (m === 0) return out;
  let kMax = -1;
  for (let k = 1; k <= m; k++) {
    if (indexed[k - 1].p <= (k / m) * alpha) kMax = k;
  }
  if (kMax < 0) return out;
  for (let k = 0; k < kMax; k++) out[indexed[k].i] = true;
  return out;
}
export function quarterKellyPct(winRate: number, avgWinR: number, avgLossR: number): number | null {
  if (!(avgWinR > 0) || !(avgLossR > 0)) return null;
  const b = avgWinR / avgLossR, p = winRate, q = 1 - p;
  const kelly = (b * p - q) / b;
  if (kelly <= 0) return null;
  return Math.max(0.25, Math.min(1.5, kelly * 0.25 * 100));
}

const SESSION_LABELS: Record<string, string> = {
  tokyo: "Tokyo", asia: "Tokyo", london: "London",
  ny_am: "NY AM", new_york_am: "NY AM", ny_pm: "NY PM", new_york_pm: "NY PM",
  new_york: "NY AM", ny: "NY AM",
};
export function normalizeSession(raw: string | null | undefined): string {
  if (!raw) return "Unknown";
  return SESSION_LABELS[String(raw).toLowerCase()] ?? raw;
}

function getCf(t: any, key: string | null): unknown {
  if (!key) return undefined;
  const cf = t?.custom_fields;
  if (!cf || typeof cf !== "object") return undefined;
  return cf[key];
}
export function numericCf(t: any, key: string | null): number | null {
  const v = getCf(t, key);
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
export function multiSelectCf(t: any, key: string | null): string[] {
  const v = getCf(t, key);
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v) return [v];
  return [];
}

export function parseTpLabel(s: string): number | null {
  if (!s) return null;
  const clean = s.trim().toUpperCase();
  const ratio = clean.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (ratio) { const a = Number(ratio[1]), b = Number(ratio[2]); if (a > 0) return b / a; }
  const tp = clean.match(/^TP\s*(\d+(?:\.\d+)?)$/);
  if (tp) return Number(tp[1]);
  const num = clean.match(/^(\d+(?:\.\d+)?)R?$/);
  if (num) return Number(num[1]);
  return null;
}

export interface BucketKey { symbol: string; session: string }
export interface Tp1Star { r: number; hitRate: number; hitRateCi: [number, number] | null; expectancyR: number }

export interface BucketReport {
  key: BucketKey;
  n: number;
  wins: number;
  losses: number;
  winRate: number;
  expectedR: number;
  expectedRMedian: number;
  expectedRCi: [number, number] | null;
  mfeP50: number | null;
  mfeP75: number | null;
  maeP50: number | null;
  maeP75: number | null;
  maeP75Pips: number | null;
  idealSlMedianPips: number | null;
  slInitialMedianPips: number | null;
  slDrift: "too_wide" | "too_tight" | "aligned" | null;
  confidence: ConfidenceLevel;
  suggestedSlPips: number | null;
  /** "pips" for FX/metals/crypto/oil, "points" for indices. */
  slUnit: "pips" | "points";
  tpLadderR: number[];
  /** TP that wins the MFE-grid expectancy search (R). null when fallback used. */
  suggestedTpR: number | null;
  /** Expectancy at the chosen TP cell. null when fallback used. */
  expectancyAtSuggested: number | null;
  /** Bootstrap 95% CI on expectancyAtSuggested. null when fallback used. */
  expectancyAtSuggestedCi: [number, number] | null;
  /** "validated" (CI > 0) | "low" (CI ≤ 0) | "insufficient" (fallback used). */
  recommendationConfidence: "validated" | "low" | "insufficient";
  /** Walk-forward IS/OOS check on the SL/TP recommendation. null when N<30 or OOS<5. */
  walkForward: { inSampleE: number; outOfSampleE: number; degradationPct: number; oosN: number } | null;
  tp1Star: Tp1Star | null;
  suggestedRiskPct: number | null;
  /** Prop-firm-aware cap on suggested risk (% of balance). null when no prop-firm context. */
  suggestedRiskPctPropFirmCap: number | null;
  worstLosingStreak: number;
  loggedMfeCount: number;
  loggedMaeCount: number;
  topTradeIds: string[];
  bottomTradeIds: string[];
}

function confidenceFor(n: number): ConfidenceLevel {
  // Tightened 2026-06: "high" requires n≥50 — at n=30 the 95% CI on win-rate
  // is still ±18pp, too loose to gate real-money parameter changes.
  if (n >= 50) return "high";
  if (n >= 15) return "medium";
  return "low";
}
function longestLossStreak(rows: any[]): number {
  const sorted = [...rows]
    .filter((t) => t.net_pnl != null && t.entry_time)
    .sort((a, b) => String(a.entry_time).localeCompare(String(b.entry_time)));
  let run = 0, worst = 0;
  for (const t of sorted) {
    if ((t.net_pnl ?? 0) < 0) { run += 1; if (run > worst) worst = run; }
    else run = 0;
  }
  return worst;
}
function wilsonCi(successes: number, n: number, z = 1.96): [number, number] | null {
  if (n <= 0) return null;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}

function computeTp1Star(
  pairs: Array<{ mfeR: number; rActual: number | null }>,
  avgLossR: number,
): Tp1Star | null {
  if (pairs.length < 5) return null;
  const candidates = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0];
  let best: Tp1Star | null = null;
  const fallbackMiss = -Math.abs(avgLossR);
  // Empirical miss cost: when MFE < r, use the conditional mean r_actual of
  // missing trades (BE / partial / full stop) rather than the worst-case
  // avgLossR. Falls back to −avgLossR when fewer than 5 misses with rActual.
  for (const r of candidates) {
    let hits = 0;
    const missRs: number[] = [];
    for (const p of pairs) {
      if (p.mfeR >= r) hits += 1;
      else if (p.rActual != null && Number.isFinite(p.rActual)) missRs.push(p.rActual);
    }
    const hitRate = hits / pairs.length;
    if (hitRate < 0.4) continue;
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

/** Convert a stored `cf_mae` / `cf_ideal_stop_loss` value (TICKS) into the per-trade R-multiple, given the trade's SL distance. */
function ticksToR(ticks: number, t: any): number | null {
  if (t.sl_initial == null || t.entry_price == null || !t.symbol) return null;
  const pip = pipSizeForSymbol(t.symbol);
  if (!(pip > 0)) return null;
  const slDistPips = Math.abs(t.entry_price - t.sl_initial) / pip;
  if (!(slDistPips > 0)) return null;
  const pips = ticksToPips(t.symbol, Math.abs(ticks));
  return pips / slDistPips;
}

// ----- TP grid + walk-forward helpers (mirror src/lib/pairLabMath.ts) -----
interface MfePair { mfeR: number; rActual: number }

// Trail-capture is intentionally not threaded into scoreTp; mixing it with
// realized exits biases the TP-grid argmax low. See client scoreTp.
function scoreTp(tp: number, sample: MfePair[]): number {
  if (sample.length === 0) return 0;
  let sum = 0;
  for (const p of sample) {
    if (p.mfeR >= tp) sum += tp;
    else sum += p.rActual;
  }
  return sum / sample.length;
}

function collectMfeRPairs(rows: any[], keys: PairLabFieldKeys): MfePair[] {
  const out: MfePair[] = [];
  for (const t of rows) {
    const mfeR = numericCf(t, keys.mfe);
    if (mfeR == null) continue;
    if (t.r_multiple_actual == null || !Number.isFinite(t.r_multiple_actual)) continue;
    out.push({ mfeR, rActual: t.r_multiple_actual });
  }
  return out;
}

function estimateTrailCaptureRows(rows: any[], keys: PairLabFieldKeys, minSample = 10): number {
  const ratios: number[] = [];
  for (const t of rows) {
    if (t.is_open || t.is_archived) continue;
    const mfe = numericCf(t, keys.mfe);
    const r = t.r_multiple_actual;
    if (mfe == null || r == null) continue;
    if (!(mfe > 0) || !(r > 0)) continue;
    if (mfe - r < 0.1) continue;
    const ratio = r / mfe;
    if (ratio > 0 && ratio < 1.05) ratios.push(ratio);
  }
  if (ratios.length < minSample) return 0.7;
  const m = median(ratios);
  if (m == null || !(m > 0)) return 0.7;
  return Math.max(0.1, Math.min(0.95, m));
}

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
  let seed = pairs.length * 1000003;
  for (const p of pairs) seed = (seed * 31 + Math.floor((p.mfeR * 1000 + p.rActual * 1000))) | 0;
  if (seed === 0) seed = 0x9e3779b9;
  const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) % 1_000_000) / 1_000_000; };
  const iters = 500;
  const samples: number[] = new Array(iters);
  const buf: MfePair[] = new Array(pairs.length);
  for (let i = 0; i < iters; i++) {
    for (let j = 0; j < pairs.length; j++) buf[j] = pairs[Math.floor(rand() * pairs.length)];
    samples[i] = scoreTp(best.tp, buf);
  }
  samples.sort((a, b) => a - b);
  const ci: [number, number] = [percentileFromSorted(samples, 0.025), percentileFromSorted(samples, 0.975)];
  const ladder = Array.from(
    new Set([...scored].filter((c) => c.e > 0).sort((a, b) => b.e - a.e).slice(0, 3).map((c) => c.tp)),
  ).sort((a, b) => a - b);
  return { tpR: best.tp, expectancy: best.e, ladder, ci };
}

function runWalkForward(rows: any[], keys: PairLabFieldKeys):
  | { inSampleE: number; outOfSampleE: number; degradationPct: number; oosN: number }
  | null {
  const closed = rows.filter((t) => t.net_pnl != null && t.entry_time);
  if (closed.length < 30) return null;
  const sorted = [...closed].sort((a, b) => String(a.entry_time).localeCompare(String(b.entry_time)));
  const cutoff = Math.floor(sorted.length * 0.7);
  const isRows = sorted.slice(0, cutoff);
  const oosRows = sorted.slice(cutoff);
  if (oosRows.length < 9) return null;
  const isPairs = collectMfeRPairs(isRows, keys);
  const oosPairs = collectMfeRPairs(oosRows, keys);
  if (isPairs.length < 10 || oosPairs.length < 5) return null;
  // `_trail` argument is vestigial — scoreTp no longer consumes it. Keep
  // signature stable for now; pass 0.
  const pick = pickBestTp(isPairs, 0);
  if (!pick) return null;
  const outOfSampleE = scoreTp(pick.tpR, oosPairs);
  const degradationPct = pick.expectancy > 0 ? (1 - outOfSampleE / pick.expectancy) * 100 : 0;
  // Report OOS pair count (true DoF for scoreTp), not raw row count.
  return { inSampleE: pick.expectancy, outOfSampleE, degradationPct, oosN: oosPairs.length };
}

export function computeBucket(
  key: BucketKey,
  rows: any[],
  keys: PairLabFieldKeys,
  propFirm?: PropFirmContext | null,
): BucketReport {
  const closed = rows.filter((t) => t.net_pnl != null);
  const sideOf = (t: any): 1 | -1 | 0 => {
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
  const lossR = losses.map((t) => t.r_multiple_actual)
    .filter((v): v is number => v != null && v < 0)
    .map((v) => Math.abs(v));

  const mfes = rows.map((t) => numericCf(t, keys.mfe)).filter((v): v is number => v != null);

  // MAE is stored in TICKS. Convert to pips for the SL math, R for distribution.
  const maesR: number[] = [];
  const maesPips: number[] = [];
  for (const t of rows) {
    const maeTicks = numericCf(t, keys.mae);
    if (maeTicks == null || !t.symbol) continue;
    maesPips.push(Math.abs(ticksToPips(t.symbol, Math.abs(maeTicks))));
    const r = ticksToR(maeTicks, t);
    if (r != null) maesR.push(r);
  }

  // Ideal SL is stored in TICKS — convert to pips for the SL recommendation.
  const idealSls: number[] = [];
  for (const t of rows) {
    const idealTicks = numericCf(t, keys.idealStopLoss);
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
  const idealMed = median(idealSls);
  const slInitMed = median(slInitials);
  let slDrift: BucketReport["slDrift"] = null;
  if (idealMed != null && slInitMed != null && slInitMed > 0) {
    const ratio = idealMed / slInitMed;
    if (ratio < 0.8) slDrift = "too_wide";
    else if (ratio > 1.2) slDrift = "too_tight";
    else slDrift = "aligned";
  }

  const maeP75Pips = quantile(maesPips, 0.75);

  // ----- SL: MAE-of-winners (Sweeney). Tightest SL preserving 90% of winners. -----
  const winnersMaePips: number[] = [];
  for (const t of rows) {
    if (t.r_multiple_actual == null || !(t.r_multiple_actual > 0)) continue;
    const maeTicks = numericCf(t, keys.mae);
    if (maeTicks == null || !t.symbol) continue;
    winnersMaePips.push(Math.abs(ticksToPips(t.symbol, Math.abs(maeTicks))));
  }
  let suggestedSlPips: number | null = null;
  let slMethod: "winners_mae" | "legacy" = "legacy";
  const slWinners = winnersMaePips.length >= 10 ? quantile(winnersMaePips, 0.90) : null;
  if (slWinners != null && slWinners > 0) {
    suggestedSlPips = slWinners * 1.10;
    slMethod = "winners_mae";
  } else {
    const maeCandidate = maeP75Pips != null ? maeP75Pips * 1.15 : null;
    if (maeCandidate != null || idealMed != null) {
      suggestedSlPips = Math.max(maeCandidate ?? 0, idealMed ?? 0);
    }
  }

  // ----- TP: MFE-based expectancy grid (no survivorship bias). -----
  const mfeRPairs = collectMfeRPairs(rows, keys);
  const trailCapture = estimateTrailCaptureRows(rows, keys);
  const pick = pickBestTp(mfeRPairs, trailCapture);
  let suggestedTpR: number | null = null;
  let expectancyAtSuggested: number | null = null;
  let expectancyAtSuggestedCi: [number, number] | null = null;
  let tpLadderR: number[];
  let tpMethod: "mfe_grid" | "legacy" = "legacy";
  if (pick) {
    suggestedTpR = pick.tpR;
    expectancyAtSuggested = pick.expectancy;
    expectancyAtSuggestedCi = pick.ci;
    tpLadderR = pick.ladder;
    tpMethod = "mfe_grid";
  } else {
    const ladder: number[] = [];
    for (const v of [quantile(winR, 0.3), quantile(winR, 0.5), quantile(winR, 0.75)]) {
      if (v == null || v <= 0) continue;
      ladder.push(v);
    }
    tpLadderR = Array.from(new Set(ladder.map((v) => Math.round(v * 4) / 4))).slice(0, 3);
  }

  let recommendationConfidence: "validated" | "low" | "insufficient";
  if (slMethod === "legacy" || tpMethod === "legacy") recommendationConfidence = "insufficient";
  else if (expectancyAtSuggestedCi && expectancyAtSuggestedCi[0] > 0) recommendationConfidence = "validated";
  else recommendationConfidence = "low";

  const walkForward = runWalkForward(rows, keys);

  const avgWinR = winR.length > 0 ? winR.reduce((a, v) => a + v, 0) / winR.length : 0;
  const avgLossR = lossR.length > 0 ? lossR.reduce((a, v) => a + v, 0) / lossR.length : 1;
  const suggestedRiskPct = n >= 10 ? quarterKellyPct(winRate, avgWinR, avgLossR) : null;
  const tp1Star = computeTp1Star(mfes, avgLossR || 1);

  // Prop-firm cap: the lower of (daily loss limit / max DD) translated to a
  // single-trade risk %. Conservative — assumes 3-loss safety margin.
  let suggestedRiskPctPropFirmCap: number | null = null;
  if (propFirm && propFirm.balance > 0) {
    const limits: number[] = [];
    if (propFirm.dailyLossDollars && propFirm.dailyLossDollars > 0) {
      limits.push((propFirm.dailyLossDollars / propFirm.balance) * 100 / 3);
    }
    if (propFirm.maxDrawdownDollars && propFirm.maxDrawdownDollars > 0) {
      limits.push((propFirm.maxDrawdownDollars / propFirm.balance) * 100 / 5);
    }
    if (limits.length > 0) suggestedRiskPctPropFirmCap = +Math.min(...limits).toFixed(2);
  }

  const sorted = [...closed].sort((a, b) => (b.r_multiple_actual ?? 0) - (a.r_multiple_actual ?? 0));
  const topTradeIds = sorted.slice(0, 3).map((t) => t.id);
  const bottomTradeIds = sorted.slice(-3).reverse().map((t) => t.id);

  const slUnit = key.symbol && key.symbol !== "All" ? pipLabelForSymbol(key.symbol) : "pips";

  return {
    key,
    n,
    wins: wins.length,
    losses: losses.length,
    winRate,
    expectedR,
    expectedRMedian: median(rActuals) ?? 0,
    expectedRCi: bootstrapMeanCi(rActuals),
    mfeP50: median(mfes),
    mfeP75: quantile(mfes, 0.75),
    maeP50: median(maesR),
    maeP75: quantile(maesR, 0.75),
    maeP75Pips,
    idealSlMedianPips: idealMed,
    slInitialMedianPips: slInitMed,
    slDrift,
    confidence: confidenceFor(n),
    suggestedSlPips,
    slUnit,
    tpLadderR,
    suggestedTpR,
    expectancyAtSuggested,
    expectancyAtSuggestedCi,
    recommendationConfidence,
    walkForward,
    tp1Star,
    suggestedRiskPct,
    suggestedRiskPctPropFirmCap,
    worstLosingStreak: longestLossStreak(rows),
    loggedMfeCount: closed.filter((t) => numericCf(t, keys.mfe) != null).length,
    loggedMaeCount: closed.filter((t) => {
      const v = numericCf(t, keys.mae);
      return v != null && t.sl_initial != null && t.entry_price != null;
    }).length,
    topTradeIds,
    bottomTradeIds,
  };
}

export function buildBuckets(
  trades: any[],
  keys: PairLabFieldKeys,
  propFirm?: PropFirmContext | null,
  symbolResolver?: (raw: string) => string,
): {
  perCell: BucketReport[];
  baseline: BucketReport;
} {
  const resolveSym = symbolResolver ?? ((s: string) => s);
  const closed = trades.filter((t) => !t.is_open && !t.is_archived && t.net_pnl != null);
  const baseline = computeBucket({ symbol: "All", session: "All sessions" }, closed, keys, propFirm);
  const cellMap = new Map<string, any[]>();
  for (const t of closed) {
    if (!t.symbol) continue;
    const canonical = resolveSym(t.symbol);
    const sess = normalizeSession(t.session);
    const k = `${canonical}__${sess}`;
    if (!cellMap.has(k)) cellMap.set(k, []);
    cellMap.get(k)!.push(t);
  }
  const perCell: BucketReport[] = [];
  cellMap.forEach((rows, k) => {
    const [symbol, session] = k.split("__");
    perCell.push(computeBucket({ symbol, session }, rows, keys, propFirm));
  });
  // Match client ordering: sort by N descending (stable, sample-size first).
  perCell.sort((a, b) => (b.n - a.n) || a.key.symbol.localeCompare(b.key.symbol));
  return { perCell, baseline };
}
