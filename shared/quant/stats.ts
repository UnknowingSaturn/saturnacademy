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

/**
 * S2.4: returns null on empty / all-NaN input (was 0, which was indistinguishable
 * from a true zero-edge bucket). Callers that need a numeric should use
 * `mean(xs) ?? NaN` so downstream guards (Number.isFinite) keep behaving.
 */
export function mean(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length === 0) return null;
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
 * BCa (bias-corrected & accelerated) bootstrap 95% CI on the mean. Standard
 * fix for the under-coverage of the plain percentile bootstrap at small n
 * (10–30 samples) or when the sampling distribution is skewed. Requires a
 * jackknife pass to estimate acceleration.
 *
 * Falls back to the plain percentile CI when the acceleration estimator
 * degenerates (n < 5, zero variance, or all jackknife means identical).
 */
export function bootstrapMeanCiBCa(
  values: number[],
  iters = BOOTSTRAP_ITERATIONS,
): [number, number] | null {
  const xs = values.filter((v) => Number.isFinite(v));
  const n = xs.length;
  if (n < 5) return null;

  // Deterministic seed (mirrors bootstrapMeanCi).
  let hash = n * 1000003 + 11;
  for (let i = 0; i < n; i++) hash = (hash * 31 + Math.floor(xs[i] * 1000)) | 0;
  const rand = makeSeededRng(hash);

  const observed = xs.reduce((s, v) => s + v, 0) / n;

  // Bootstrap distribution of means.
  const means: number[] = new Array(iters);
  for (let i = 0; i < iters; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) sum += xs[Math.floor(rand() * n)];
    means[i] = sum / n;
  }
  means.sort((a, b) => a - b);

  // Bias-correction: z0 = Φ⁻¹(fraction of boot-means < observed mean).
  let below = 0;
  for (let i = 0; i < iters; i++) if (means[i] < observed) below += 1;
  const prop = Math.min(iters - 0.5, Math.max(0.5, below)) / iters;
  const z0 = invNormCdf(prop);

  // Acceleration: jackknife on the mean.
  const sum = xs.reduce((s, v) => s + v, 0);
  const jack: number[] = new Array(n);
  for (let i = 0; i < n; i++) jack[i] = (sum - xs[i]) / (n - 1);
  const jMean = jack.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const d = jMean - jack[i];
    num += d * d * d;
    den += d * d;
  }
  const acc = den > 0 ? num / (6 * Math.pow(den, 1.5)) : 0;

  const z025 = -1.959963984540054;
  const z975 = 1.959963984540054;
  const alphaLo = normCdf(z0 + (z0 + z025) / (1 - acc * (z0 + z025)));
  const alphaHi = normCdf(z0 + (z0 + z975) / (1 - acc * (z0 + z975)));

  if (!Number.isFinite(alphaLo) || !Number.isFinite(alphaHi) || alphaLo >= alphaHi) {
    return [percentileFromSorted(means, 0.025), percentileFromSorted(means, 0.975)];
  }
  return [
    percentileFromSorted(means, clamp01(alphaLo)),
    percentileFromSorted(means, clamp01(alphaHi)),
  ];
}

function clamp01(x: number): number {
  if (x < 0.001) return 0.001;
  if (x > 0.999) return 0.999;
  return x;
}

// Abramowitz & Stegun 26.2.23 — |error| < 4.5e-4. Sufficient for BCa endpoints.
function invNormCdf(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const q = p < 0.5 ? p : 1 - p;
  const t = Math.sqrt(-2 * Math.log(q));
  const c0 = 2.515517, c1 = 0.802853, c2 = 0.010328;
  const d1 = 1.432788, d2 = 0.189269, d3 = 0.001308;
  const num = c0 + c1 * t + c2 * t * t;
  const den = 1 + d1 * t + d2 * t * t + d3 * t * t * t;
  const x = t - num / den;
  return p < 0.5 ? -x : x;
}

// Standard normal CDF via erf (Abramowitz 7.1.26).
function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-a * a);
  return 0.5 * (1 + sign * y);
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

  // S1.6 fix: hash the FULL wins+losses arrays so two buckets sharing (n,
  // wins[0]) don't collapse to identical CI widths. Mirrors bootstrapMeanCi.
  let seedBase = n * 1000003;
  for (let i = 0; i < nW; i++) seedBase = (seedBase * 31 + Math.floor(wins[i] * 1000)) | 0;
  for (let i = 0; i < nL; i++) seedBase = (seedBase * 31 + Math.floor(losses[i] * 1000)) | 0;
  if (seedBase === 0) seedBase = 0x9e3779b9;
  // K1 fix: three independent streams so payoff, loss, and binomial draws
  // genuinely decorrelate within one iteration. Previously wins+losses both
  // consumed `randPayoff`, so the loss draw's state depended on the win
  // draw's output — bootstrap CI was mildly tighter than the true sampling
  // distribution.
  const randPayoff = makeSeededRng(seedBase);
  const randLoss = makeSeededRng(seedBase ^ 0x27d4eb2d);
  const randBinom = makeSeededRng(seedBase ^ 0x5bd1e995);
  const ks: number[] = [];
  const baseP = nW / n;
  for (let i = 0; i < iters; i++) {
    // N1 fix: draw the binomial win-count first, then resample EXACTLY `w`
    // wins and `n-w` losses. The previous loop hardcoded resample sizes
    // to `nW`/`nL` regardless of `w`, decoupling win-rate from payoff
    // distribution and shrinking the Kelly CI below its true sampling width.
    let w = 0;
    for (let j = 0; j < n; j++) if (randBinom() < baseP) w += 1;
    if (w === 0 || w === n) continue;
    const l = n - w;
    let sw = 0;
    for (let j = 0; j < w; j++) sw += wins[Math.floor(randPayoff() * nW)];
    let sl = 0;
    for (let j = 0; j < l; j++) sl += losses[Math.floor(randLoss() * nL)];
    const avgW = sw / w;
    const avgL = sl / l;
    if (!(avgW > 0) || !(avgL > 0)) continue;
    const p = w / n;
    const b = avgW / avgL;
    const kelly = (b * p - (1 - p)) / b;
    ks.push(kelly * KELLY_SCALE * 100);
  }
  if (ks.length < 10) return null;
  ks.sort((a, b) => a - b);
  return [percentileFromSorted(ks, 0.025), percentileFromSorted(ks, 0.975)];
}

/**
 * BCa (bias-corrected & accelerated) bootstrap 95% CI on the raw quarter-Kelly
 * fraction. Mirrors `bootstrapMeanCiBCa` but resamples wins/losses jointly via
 * a binomial-first, then-payoff-draw scheme (same as `bootstrapKellyCi`). Used
 * for the sizing recommendation at small n where percentile CIs under-cover.
 *
 * PR-2 item 2F. Falls back to percentile bootstrap on jackknife degeneracy.
 */
export function bootstrapKellyCiBCa(
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

  let seedBase = n * 1000003 + 23;
  for (let i = 0; i < nW; i++) seedBase = (seedBase * 31 + Math.floor(wins[i] * 1000)) | 0;
  for (let i = 0; i < nL; i++) seedBase = (seedBase * 31 + Math.floor(losses[i] * 1000)) | 0;
  if (seedBase === 0) seedBase = 0x9e3779b9;
  const randPayoff = makeSeededRng(seedBase);
  const randLoss = makeSeededRng(seedBase ^ 0x27d4eb2d);
  const randBinom = makeSeededRng(seedBase ^ 0x5bd1e995);

  const observedAvgW = wins.reduce((s, v) => s + v, 0) / nW;
  const observedAvgL = losses.reduce((s, v) => s + v, 0) / nL;
  const observedP = nW / n;
  const observedB = observedAvgW / observedAvgL;
  const observedK = (observedB * observedP - (1 - observedP)) / observedB * KELLY_SCALE * 100;

  const ks: number[] = [];
  const baseP = observedP;
  for (let i = 0; i < iters; i++) {
    let w = 0;
    for (let j = 0; j < n; j++) if (randBinom() < baseP) w += 1;
    if (w === 0 || w === n) continue;
    const l = n - w;
    let sw = 0;
    for (let j = 0; j < w; j++) sw += wins[Math.floor(randPayoff() * nW)];
    let sl = 0;
    for (let j = 0; j < l; j++) sl += losses[Math.floor(randLoss() * nL)];
    const avgW = sw / w;
    const avgL = sl / l;
    if (!(avgW > 0) || !(avgL > 0)) continue;
    const p = w / n;
    const b = avgW / avgL;
    ks.push((b * p - (1 - p)) / b * KELLY_SCALE * 100);
  }
  if (ks.length < 10) return null;
  ks.sort((a, b) => a - b);

  // Bias-correction on the mean-of-Kelly draws (approximation — Kelly is
  // monotone in p and b so the ordering-based bias correction is defensible).
  let below = 0;
  for (const k of ks) if (k < observedK) below += 1;
  const prop = Math.min(ks.length - 0.5, Math.max(0.5, below)) / ks.length;
  const z0 = invNormCdf(prop);

  // Jackknife on Kelly point estimate — leave-one-out over the combined sample.
  const allSamples: Array<{ v: number; win: boolean }> = [
    ...wins.map((v) => ({ v, win: true })),
    ...losses.map((v) => ({ v, win: false })),
  ];
  const sumW = wins.reduce((s, v) => s + v, 0);
  const sumL = losses.reduce((s, v) => s + v, 0);
  const jack: number[] = [];
  for (let i = 0; i < allSamples.length; i++) {
    const s = allSamples[i];
    const jNW = s.win ? nW - 1 : nW;
    const jNL = s.win ? nL : nL - 1;
    if (jNW === 0 || jNL === 0) continue;
    const jSumW = s.win ? sumW - s.v : sumW;
    const jSumL = s.win ? sumL : sumL - s.v;
    const jAvgW = jSumW / jNW;
    const jAvgL = jSumL / jNL;
    if (!(jAvgW > 0) || !(jAvgL > 0)) continue;
    const jP = jNW / (jNW + jNL);
    const jB = jAvgW / jAvgL;
    jack.push((jB * jP - (1 - jP)) / jB * KELLY_SCALE * 100);
  }
  const jMean = jack.length > 0 ? jack.reduce((s, v) => s + v, 0) / jack.length : 0;
  let num = 0, den = 0;
  for (const jk of jack) {
    const d = jMean - jk;
    num += d * d * d;
    den += d * d;
  }
  const acc = den > 0 ? num / (6 * Math.pow(den, 1.5)) : 0;

  const z025 = -1.959963984540054;
  const z975 = 1.959963984540054;
  const alphaLo = normCdf(z0 + (z0 + z025) / (1 - acc * (z0 + z025)));
  const alphaHi = normCdf(z0 + (z0 + z975) / (1 - acc * (z0 + z975)));
  if (!Number.isFinite(alphaLo) || !Number.isFinite(alphaHi) || alphaLo >= alphaHi) {
    return [percentileFromSorted(ks, 0.025), percentileFromSorted(ks, 0.975)];
  }
  return [
    percentileFromSorted(ks, clamp01(alphaLo)),
    percentileFromSorted(ks, clamp01(alphaHi)),
  ];
}

// ---------------------------------------------------------------------------
// Path-ordering probability (PR-1 — MFE-vs-MAE ordering fix)
// ---------------------------------------------------------------------------
//
// When a counterfactual replay finds a trade breached BOTH its counterfactual
// TP (MFE ≥ tpR × slScale) AND its counterfactual SL (MAE ≥ slScale), we
// cannot tell from MFE/MAE alone which came first. Assuming TP-first (the
// legacy behaviour) inflates WR on early-TP presets; assuming SL-first
// deflates it. Neither is honest.
//
// This function returns P(TP hit before SL | both breached) under the
// classical driftless-random-walk barrier model (gambler's ruin):
//
//     P(TP first) = slR / (tpR + slR)
//
// Closer TP ⇒ higher P(TP first). Symmetric barriers ⇒ 0.5. This is the
// standard first-passage probability for a symmetric random walk with two
// absorbing barriers, and matches what serious retail backtesters use when
// they lack tick data.
//
// Consumers should split the trade weight: outcome = p × TP-first-result
// + (1-p) × SL-first-result. See `replayOneTrade` for the concrete mix.
export function pathProbTpFirst(tpR: number, slR: number, mfeR: number, maeR: number): number {
  if (!(tpR > 0) || !(slR > 0)) return 0.5;
  if (mfeR < tpR) return 0;   // TP was never touched
  if (maeR < slR) return 1;   // SL was never touched → TP is the only fill
  return slR / (tpR + slR);
}

export type ReplayMode = "expected" | "optimistic" | "pessimistic";

/** Resolve a raw bridge probability into the effective P(TP first) under the
 *  selected replay mode. Optimistic collapses ambiguity to TP-first (legacy);
 *  pessimistic collapses to SL-first. */
export function resolveTpFirstProb(rawP: number, mode: ReplayMode): number {
  if (mode === "optimistic") return 1;
  if (mode === "pessimistic") return 0;
  return rawP;
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
  const mapped = SESSION_LABELS[key];
  if (mapped) return mapped;
  // S2.5: previously passed unknown strings through unchanged. EA variants
  // like "pre_market" / "Pre-Market" then created phantom buckets that halved
  // the per-session N and inflated the BH-FDR denominator. Fold unknowns into
  // "Other" with a one-time console warn so the offending tag is still
  // discoverable in the devtools (helps users update their EA / CSV).
  if (typeof console !== "undefined" && !WARNED_SESSIONS.has(key)) {
    WARNED_SESSIONS.add(key);
    console.warn(`[normalizeSession] unknown session "${raw}" → folded into "Other"`);
  }
  return "Other";
}

const WARNED_SESSIONS = new Set<string>();

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
//
// HARDENED (Phase H/13):
//   - Open positions are NEVER unrealized — they're live with a pending
//     outcome. Letting them fall into the zero-PnL branch would erase
//     in-flight trades from analytical surfaces the second their pnl
//     happened to read null.
//   - SL/TP equality uses null-aware Number coercion + strict === instead
//     of loose `==`. Loose equality silently coerces "" / "0" / 0 / null /
//     undefined into each other and produced false positives on partially
//     filled forms.
//   - The zero-PnL / untouched-orders branch only fires for trade_type
//     'executed' (or unspecified). It will not re-classify rows that
//     already carry an explicit non-executed label.
export function isUnrealized(t: any): boolean {
  if (!t) return false;
  // Live positions: explicit category, never "unrealized".
  if (t.is_open === true) return false;

  const tt = t.trade_type;
  if (tt === "idea" || tt === "paper" || tt === "missed") return true;
  if (t.repair_state === "manual_dismiss") return true;

  // Only consider the zero-PnL / untouched-orders branch for executed rows.
  if (tt && tt !== "executed") return false;

  const pnl = t.net_pnl;
  const rAct = t.r_multiple_actual;
  const exit = t.exit_time;
  const pnlMissing = pnl == null || pnl === 0;
  const rMissing = rAct == null;
  if (!pnlMissing || !rMissing || exit == null) return false;

  const slUntouched =
    t.sl_initial != null &&
    t.sl_final != null &&
    Number(t.sl_initial) === Number(t.sl_final);
  const tpUntouched =
    (t.tp_initial == null && t.tp_final == null) ||
    (t.tp_initial != null &&
      t.tp_final != null &&
      Number(t.tp_initial) === Number(t.tp_final));

  // Phase I expansion: also classify "flat fills" — broker filled the order
  // and closed it at (or within a tick of) the entry price with no SL/TP work
  // and no PnL. These are not real trades; including them as zero-R losses
  // drags expectancy toward 0 the same way idea/paper rows do.
  const ep = t.entry_price != null ? Number(t.entry_price) : null;
  const xp = t.exit_price != null ? Number(t.exit_price) : null;
  const flatFill =
    ep != null && xp != null && Number.isFinite(ep) && Number.isFinite(xp) && ep === xp;

  // Partial-fill heuristic: rows with an explicitly empty fills array confirm
  // the order never built size — treat like an idea/expired pending.
  const partialFills = Array.isArray(t.partial_fills) ? t.partial_fills : null;
  const noFills = partialFills != null && partialFills.length === 0;

  if (slUntouched && tpUntouched) return true;
  if (flatFill && (slUntouched || tpUntouched)) return true;
  if (noFills) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Naive-timestamp detector (Phase H/12)
// ---------------------------------------------------------------------------
//
// A timestamp string is "naive" when it carries no timezone designator (no
// trailing `Z` and no `±HH:MM` offset). Naive strings are interpreted
// differently by `new Date(...)` depending on the host JS engine and the
// user's OS locale — Chrome may read it as local time, Safari as UTC, and
// Node may differ from both. Pair Lab math standardizes via
// `brokerLocalToUtc`, but we still flag raw naive strings so the UI can
// prompt the user to configure the account's DST profile or re-ingest with
// timezone-qualified timestamps.
const NAIVE_TS_DETECTOR =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
const TZ_TS_DETECTOR = /(Z|[+-]\d{2}:?\d{2})$/;

export function isNaiveTimestamp(s: unknown): boolean {
  if (typeof s !== "string") return false;
  const trimmed = s.trim();
  if (!trimmed) return false;
  if (TZ_TS_DETECTOR.test(trimmed)) return false;
  return NAIVE_TS_DETECTOR.test(trimmed);
}

// ---------------------------------------------------------------------------
// ensureUtcMs — S2.7. Single helper for parsing entry_time strings to epoch
// ms in a TZ-safe, host-independent way.
//
//  - Strings ending in Z or ±HH:MM are absolute — return Date.parse().
//  - Naive strings (no offset) are decomposed by a strict regex and combined
//    via Date.UTC(). Avoids `new Date(naiveString)`, which Chrome interprets
//    as local time and Safari as UTC, producing different OOS splits per
//    browser.
//  - Unparseable inputs return NaN so the caller can drop the trade.
// ---------------------------------------------------------------------------
const ENSURE_UTC_NAIVE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/;
const ENSURE_UTC_TZ = /(Z|[+-]\d{2}:?\d{2})$/;

export function ensureUtcMs(s: unknown): number {
  if (s == null) return NaN;
  const str = String(s).trim();
  if (!str) return NaN;
  if (ENSURE_UTC_TZ.test(str)) {
    const ms = Date.parse(str);
    return Number.isFinite(ms) ? ms : NaN;
  }
  const m = ENSURE_UTC_NAIVE.exec(str);
  if (!m) {
    const ms = Date.parse(str);
    return Number.isFinite(ms) ? ms : NaN;
  }
  const [, y, mo, d, hh, mm, ss = "0", frac = "0"] = m;
  const msFrac = Number((frac + "000").slice(0, 3));
  return Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss, msFrac);
}

/** Counts trades whose `entry_time` is a naive (TZ-less) string. */
export function countNaiveEntryTimes(
  trades: Array<{ entry_time?: unknown }>,
): number {
  let n = 0;
  for (const t of trades) if (isNaiveTimestamp(t?.entry_time)) n += 1;
  return n;
}
