// ============================================================================
// Shared quant statistics — primitive helpers used by both src/lib/pairLabMath
// and supabase/functions/_shared/quant/pairLabMath. Dependency-free so the
// same source can run unchanged under Vite and Deno.
//
// Anything here must be a pure function. No DOM, no fetch, no Trade type.
// Everything that touches custom-field JSONB takes an `any` row.
// ============================================================================

import {
  KELLY_SCALE,
  KELLY_FLOOR_PCT,
  KELLY_CEILING_PCT,
  BOOTSTRAP_ITERATIONS,
  BH_FDR_ALPHA,
} from "./config";

// ---------------------------------------------------------------------------
// Quantiles / central tendency
// ---------------------------------------------------------------------------

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

/**
 * Downside deviation (penalises only sub-target outcomes). Divides squared
 * downside deviations by total-observation count − 1 (Bloomberg/Quantopian
 * Sortino convention).
 */
export function downsideStddev(values: number[], target = 0): number {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length < 2) return 0;
  const ss = xs.reduce((s, v) => s + Math.min(0, v - target) ** 2, 0);
  return Math.sqrt(ss / (xs.length - 1));
}

/** Standard linear-interpolation percentile (NIST type 7). Sorted ascending input. */
export function percentileFromSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos), w = pos - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

// ---------------------------------------------------------------------------
// Wilson CI / deterministic RNG / bootstraps
// ---------------------------------------------------------------------------

/** Wilson 95% CI for a binomial proportion. Returns null when n=0. */
export function wilsonCi(successes: number, n: number, z = 1.96): [number, number] | null {
  if (n <= 0) return null;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}

/** Seeded xorshift32 — deterministic across renders. */
export function makeSeededRng(seedBase: number): () => number {
  let seed = seedBase | 0;
  if (seed === 0) seed = 0x9e3779b9;
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) % 1_000_000) / 1_000_000;
  };
}

/**
 * Bootstrap mean CI (2.5% / 97.5%). Deterministic seed derived from both
 * sample size and a value hash so two buckets with the same N but different
 * values don't share an artificial CI alignment.
 */
export function bootstrapMeanCi(values: number[], iters = BOOTSTRAP_ITERATIONS): [number, number] | null {
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
  return [percentileFromSorted(means, 0.025), percentileFromSorted(means, 0.975)];
}

/**
 * One-sided bootstrap p-value that mean(values) > 0. p = fraction of
 * resampled means ≤ 0. Returns null when n < 5. Floored at 1/iters.
 */
export function bootstrapPositivePValue(values: number[], iters = BOOTSTRAP_ITERATIONS): number | null {
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
 * Benjamini–Hochberg FDR adjustment. Returns boolean[] marking which
 * hypotheses are significant at level `alpha` after BH correction. Null
 * p-values are treated as non-significant.
 */
export function bhSignificant(pvals: Array<number | null>, alpha = BH_FDR_ALPHA): boolean[] {
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

/**
 * Bootstrap 95% CI on the raw quarter-Kelly fraction (percent of account).
 * Resamples wins and losses INDEPENDENTLY (preserves empirical counts), and
 * draws win-rate from a fresh binomial via a SECOND seeded stream so payoff
 * and win-rate draws don't share RNG state within a single iteration.
 */
export function bootstrapKellyCi(
  winR: number[],
  lossR: number[],
  iters = BOOTSTRAP_ITERATIONS,
): [number, number] | null {
  const wins = winR.filter((v) => Number.isFinite(v) && v > 0);
  const losses = lossR.filter((v) => Number.isFinite(v) && v > 0);
  const nW = wins.length;
  const nL = losses.length;
  const n = nW + nL;
  if (n < 10 || nW === 0 || nL === 0) return null;

  const seedBase = (n * 1000003) ^ Math.floor((wins[0] ?? 0) * 1000);
  const randPayoff = makeSeededRng(seedBase);
  const randBinom = makeSeededRng(seedBase ^ 0x5bd1e995);
  const ks: number[] = [];
  const baseP = nW / n;
  for (let i = 0; i < iters; i++) {
    let sw = 0;
    for (let j = 0; j < nW; j++) sw += wins[Math.floor(randPayoff() * nW)];
    let sl = 0;
    for (let j = 0; j < nL; j++) sl += losses[Math.floor(randPayoff() * nL)];
    const avgW = sw / nW;
    const avgL = sl / nL;
    if (!(avgW > 0) || !(avgL > 0)) continue;
    let w = 0;
    for (let j = 0; j < n; j++) if (randBinom() < baseP) w += 1;
    if (w === 0 || w === n) continue;
    const p = w / n;
    const b = avgW / avgL;
    const kelly = (b * p - (1 - p)) / b;
    ks.push(kelly * KELLY_SCALE * 100);
  }
  if (ks.length < 10) return null;
  ks.sort((a, b) => a - b);
  return [percentileFromSorted(ks, 0.025), percentileFromSorted(ks, 0.975)];
}

// ---------------------------------------------------------------------------
// Kelly
// ---------------------------------------------------------------------------

/** Raw quarter-Kelly value (percent of account), uncapped. Null when edge ≤ 0. */
export function rawQuarterKellyPct(winRate: number, avgWinR: number, avgLossR: number): number | null {
  if (!(avgWinR > 0) || !(avgLossR > 0)) return null;
  const b = avgWinR / avgLossR;
  const p = winRate;
  const q = 1 - p;
  const kelly = (b * p - q) / b;
  if (kelly <= 0) return null;
  return kelly * KELLY_SCALE * 100;
}

/** Back-compat wrapper clamped to the historical floor/ceiling. */
export function quarterKellyPct(winRate: number, avgWinR: number, avgLossR: number): number | null {
  const raw = rawQuarterKellyPct(winRate, avgWinR, avgLossR);
  if (raw == null) return null;
  return Math.max(KELLY_FLOOR_PCT, Math.min(KELLY_CEILING_PCT, raw));
}

// ---------------------------------------------------------------------------
// Session normalization
// ---------------------------------------------------------------------------

const SESSION_LABELS: Record<string, string> = {
  // Tokyo / Asia variants
  tokyo: "Tokyo",
  asia: "Tokyo",
  asian: "Tokyo",
  asia_session: "Tokyo",
  jp: "Tokyo",
  japan: "Tokyo",
  sydney: "Tokyo",
  // London / Europe variants
  london: "London",
  ldn: "London",
  europe: "London",
  european: "London",
  eu: "London",
  frankfurt: "London",
  // NY AM variants
  ny_am: "NY AM",
  ny: "NY AM",
  nyam: "NY AM",
  "ny-am": "NY AM",
  new_york: "NY AM",
  new_york_am: "NY AM",
  newyork: "NY AM",
  us_open: "NY AM",
  us: "NY AM",
  america: "NY AM",
  // NY PM variants
  ny_pm: "NY PM",
  nypm: "NY PM",
  "ny-pm": "NY PM",
  new_york_pm: "NY PM",
  us_pm: "NY PM",
  // Overlap / off-hours
  overlap: "Overlap",
  london_ny: "Overlap",
  "london/ny": "Overlap",
  // F1 fix: detectSessionFromUtc() emits "overlap_london_ny" for 8–12 ET, and
  // the EA tagger may emit "ny_london"/"london_ny_overlap" variants. Without
  // these aliases the heatmap silently splits the Overlap session into raw-
  // string buckets.
  overlap_london_ny: "Overlap",
  ny_london: "Overlap",
  london_ny_overlap: "Overlap",
  off_hours: "Off-hours",
  off: "Off-hours",
  weekend: "Off-hours",
};

export function normalizeSession(raw: string | null | undefined): string {
  if (!raw) return "Unknown";
  const key = String(raw).trim().toLowerCase().replace(/\s+/g, "_");
  return SESSION_LABELS[key] ?? raw;
}

// ---------------------------------------------------------------------------
// custom_fields JSONB accessors
// ---------------------------------------------------------------------------

export function getCf(trade: any, key: string | null): unknown {
  if (!key) return undefined;
  const cf = trade?.custom_fields;
  if (!cf || typeof cf !== "object") return undefined;
  return (cf as Record<string, unknown>)[key];
}

export function numericCf(trade: any, key: string | null): number | null {
  const v = getCf(trade, key);
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function multiSelectCf(trade: any, key: string | null): string[] {
  const v = getCf(trade, key);
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v) return [v];
  return [];
}

// ---------------------------------------------------------------------------
// Trade classification — "Unrealized"
// ---------------------------------------------------------------------------
//
// Unrealized trades are setups that never produced a real P&L outcome: ideas,
// paper trades, missed entries, manually-dismissed stuck rows, and zero-PNL
// rows that closed without any SL/TP modification (broker glitches, expired
// pendings — neither a win nor a loss). They MUST be excluded from R-stat
// math by default; including them silently dilutes win-rate and expectancy.
// Surface a count so the UI can show "X unrealized excluded".
export function isUnrealized(t: any): boolean {
  if (!t) return false;
  const tt = t.trade_type;
  if (tt === "idea" || tt === "paper" || tt === "missed") return true;
  if (t.repair_state === "manual_dismiss") return true;
  const pnl = t.net_pnl;
  const rAct = t.r_multiple_actual;
  const exit = t.exit_time;
  if (
    (pnl == null || pnl === 0) &&
    (rAct == null) &&
    exit != null &&
    t.sl_initial != null && t.sl_final != null && t.sl_initial === t.sl_final &&
    t.tp_initial == t.tp_final
  ) {
    return true;
  }
  return false;
}
