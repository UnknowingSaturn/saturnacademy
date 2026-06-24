// ============================================================================
// Ideal-window math — per pair × hour × half quant stats.
//
// Pure functions, no React. Consumed by the Ideal Windows tab in Pair Lab.
//
// Bucketing rule:
//   - A trade contributes to bucket (pair, hour, half) when the user has tagged
//     `cf_ideal_entry_window_*` with a value that marks that half as `worked`
//     or `failed`. Trade W/L is ignored — these stats measure the *setup*.
//   - `hour` is the entry hour in the user's display timezone (matches what
//     they see everywhere else in the Journal). 0–23.
//
// Stats per bucket:
//   - worked / failed counts → worked-rate + Wilson 95% CI.
//   - mean of trade.r_multiple_actual across the same trades → expectancy in R,
//     plus a bootstrapped 95% CI on the mean (deterministic seed).
//   - Lift vs baseline (baseline = same stats over the full filtered trade set,
//     ignoring hour/half).
//   - One-proportion z-test of bucket worked-rate vs baseline worked-rate.
// ============================================================================

import type { Trade, TradeDirection, RegimeType } from "@/types/trading";
import { decode, readIdealWindow } from "@/lib/hourSetup";

export type Half = "first" | "second";

export interface IdealWindowFilters {
  /** Canonical pair the cells are computed for. Required. */
  pair: string;
  /** Hours (0–23) the user actively trades. Heatmap rows. */
  hours: number[];
  /** Optional regime filter. `null` = any. */
  regime: RegimeType | string | null;
  /** Optional direction filter. `null` = any. */
  direction: TradeDirection | null;
  /** Optional date range (UTC ISO strings, inclusive). */
  dateFrom?: string | null;
  dateTo?: string | null;
  /** Minimum sample size for a cell to be considered "trusted". */
  minN: number;
  /** Window size (in events) for the "recent" rate used to flag drift. Default 10. */
  recentN?: number;
}

export interface BucketEvent {
  ts: number;
  half: Half;
  worked: boolean;
  r: number | null;
  tradeId: string;
}

export interface BucketStats {
  hour: number;
  half: Half;
  worked: number;
  failed: number;
  n: number;
  /** worked / n; null when n = 0. */
  rate: number | null;
  /** Wilson 95% CI on the rate; null when n = 0. */
  rateCI: [number, number] | null;
  /** Mean r_multiple_actual across the bucket's trades; null when no R samples. */
  expectancy: number | null;
  /** Bootstrap 95% CI on the mean R; null when <5 R samples. */
  expectancyCI: [number, number] | null;
  /** Number of R samples used for expectancy. */
  rSamples: number;
  /** Trades feeding this bucket (id list, for drill-down). */
  tradeIds: string[];
  /** Lift vs baseline. Filled in by `attachBaselineLift`. */
  rateLift: number | null;
  expectancyLift: number | null;
  /** One-proportion z-test p-value vs baseline. Filled in by `attachBaselineLift`. */
  pValue: number | null;
  /** True when p<0.05 and n >= minN. */
  significant: boolean;
  /** True when n < minN (cell should render greyed/directional). */
  belowMinN: boolean;
  /** Causal event timeline sorted asc by ts, for walk-forward views. */
  events: BucketEvent[];
  /** Worked-rate over the last `recentN` events. Null when <recentN events. */
  recentRate: number | null;
  /** Sample count behind recentRate. */
  recentSamples: number;
  /** recentRate - rate (pp swing, signed). Null when either is null. */
  drift: number | null;
}

export interface BaselineStats {
  n: number;
  worked: number;
  failed: number;
  rate: number | null;
  expectancy: number | null;
  rSamples: number;
}

export interface SubGridBin {
  /** Start minute within the half, 0..29 (relative to hour start). */
  startMinute: number;
  endMinute: number;
  worked: number;
  failed: number;
  n: number;
  rate: number | null;
  expectancy: number | null;
}

// ---------------------------------------------------------------------------
// Time bucketing
// ---------------------------------------------------------------------------

/** Returns {hour, minute} in the given IANA timezone for a UTC timestamp. */
export function hourMinuteInTz(
  utcTimestamp: string,
  timezone: string,
): { hour: number; minute: number } | null {
  const d = new Date(utcTimestamp);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  let hour = 0;
  let minute = 0;
  for (const p of parts) {
    if (p.type === "hour") hour = parseInt(p.value, 10) % 24;
    if (p.type === "minute") minute = parseInt(p.value, 10);
  }
  return { hour, minute };
}

// ---------------------------------------------------------------------------
// Stats primitives
// ---------------------------------------------------------------------------

/** Two-sided Wilson score interval for a binomial proportion. */
export function wilsonInterval(
  successes: number,
  n: number,
  z = 1.96,
): [number, number] {
  if (n <= 0) return [0, 0];
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const margin =
    (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}

/** Mulberry32 — small deterministic PRNG so bootstrap CIs are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bootstrap 95% CI on the mean. Returns null if fewer than 5 samples. */
export function bootstrapMeanCI(
  values: number[],
  iters = 1000,
  alpha = 0.05,
  seed = 1337,
): [number, number] | null {
  if (values.length < 5) return null;
  const rand = mulberry32(seed);
  const n = values.length;
  const means = new Float64Array(iters);
  for (let i = 0; i < iters; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) sum += values[Math.floor(rand() * n)];
    means[i] = sum / n;
  }
  const sorted = Array.from(means).sort((a, b) => a - b);
  const lo = sorted[Math.floor((alpha / 2) * iters)];
  const hi = sorted[Math.floor((1 - alpha / 2) * iters) - 1];
  return [lo, hi];
}

/** Standard normal CDF via the Abramowitz & Stegun approximation. */
function normalCdf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

/**
 * Two-proportion z-test comparing bucket (k1/n1) against baseline (k2/n2),
 * using a pooled standard error. Returns null when inputs are degenerate.
 */
export function twoProportionZTest(
  k1: number, n1: number, k2: number, n2: number,
): { z: number; p: number } | null {
  if (n1 <= 0 || n2 <= 0) return null;
  const p1 = k1 / n1;
  const p2 = k2 / n2;
  const pooled = (k1 + k2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return null;
  const z = (p1 - p2) / se;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  return { z, p: pValue };
}

// ---------------------------------------------------------------------------
// Trade filtering + bucketing
// ---------------------------------------------------------------------------

function resolveRegime(trade: Trade): string | null {
  return (
    (trade.actual_regime as string | null) ??
    ((trade as any).review?.regime as string | null) ??
    null
  );
}

export interface BucketTradesInput {
  trades: Trade[];
  filters: IdealWindowFilters;
  symbolResolver: (raw: string) => string;
  timezone: string;
}

export interface BucketedResult {
  byKey: Map<string, BucketStats>;
  baseline: BaselineStats;
  /** Total trades that passed pair/regime/direction/date filters (before hour gating). */
  scopedTradeCount: number;
}

const keyOf = (hour: number, half: Half) => `${hour}|${half}`;

export function bucketTrades({
  trades,
  filters,
  symbolResolver,
  timezone,
}: BucketTradesInput): BucketedResult {
  const dateFromMs = filters.dateFrom ? Date.parse(filters.dateFrom) : null;
  const dateToMs = filters.dateTo ? Date.parse(filters.dateTo) : null;
  const hourSet = new Set(filters.hours);

  const empty = (hour: number, half: Half): BucketStats => ({
    hour, half, worked: 0, failed: 0, n: 0,
    rate: null, rateCI: null,
    expectancy: null, expectancyCI: null, rSamples: 0,
    tradeIds: [], rateLift: null, expectancyLift: null,
    pValue: null, significant: false, belowMinN: true,
    events: [], recentRate: null, recentSamples: 0, drift: null,
  });

  const byKey = new Map<string, BucketStats>();
  // Track R samples per bucket separately so we can bootstrap them.
  const rsByKey = new Map<string, number[]>();

  let baselineWorked = 0;
  let baselineFailed = 0;
  const baselineRs: number[] = [];
  let scoped = 0;

  for (const t of trades) {
    if (t.is_archived) continue;
    if (!t.symbol) continue;
    if (symbolResolver(t.symbol) !== filters.pair) continue;
    if (filters.direction && t.direction !== filters.direction) continue;
    if (filters.regime && resolveRegime(t) !== filters.regime) continue;
    const tsMs = Date.parse(t.entry_time);
    if (Number.isNaN(tsMs)) continue;
    if (dateFromMs != null && tsMs < dateFromMs) continue;
    if (dateToMs != null && tsMs > dateToMs) continue;

    const value = readIdealWindow(t);
    if (!value || value === "none") continue;
    const d = decode(value);
    if (!d.firstWorked && !d.secondWorked && !d.firstFailed && !d.secondFailed) continue;

    const hm = hourMinuteInTz(t.entry_time, timezone);
    if (!hm) continue;
    if (!hourSet.has(hm.hour)) continue;

    scoped += 1;
    const r = typeof t.r_multiple_actual === "number" ? t.r_multiple_actual : null;

    const addToBucket = (half: Half, worked: boolean) => {
      const k = keyOf(hm.hour, half);
      let b = byKey.get(k);
      if (!b) { b = empty(hm.hour, half); byKey.set(k, b); }
      if (worked) b.worked += 1; else b.failed += 1;
      b.tradeIds.push(t.id);
      b.events.push({ ts: tsMs, half, worked, r, tradeId: t.id });
      if (r != null) {
        let rs = rsByKey.get(k);
        if (!rs) { rs = []; rsByKey.set(k, rs); }
        rs.push(r);
      }
    };

    if (d.firstWorked) { addToBucket("first", true); baselineWorked += 1; if (r != null) baselineRs.push(r); }
    if (d.firstFailed) { addToBucket("first", false); baselineFailed += 1; if (r != null) baselineRs.push(r); }
    if (d.secondWorked) { addToBucket("second", true); baselineWorked += 1; if (r != null) baselineRs.push(r); }
    if (d.secondFailed) { addToBucket("second", false); baselineFailed += 1; if (r != null) baselineRs.push(r); }
  }

  // Finalize each bucket: rate, CIs, expectancy, recent-window drift.
  const recentN = Math.max(1, filters.recentN ?? 10);
  for (const [k, b] of byKey) {
    b.n = b.worked + b.failed;
    b.rate = b.n > 0 ? b.worked / b.n : null;
    b.rateCI = b.n > 0 ? wilsonInterval(b.worked, b.n) : null;
    const rs = rsByKey.get(k) ?? [];
    b.rSamples = rs.length;
    b.expectancy = rs.length > 0 ? rs.reduce((s, x) => s + x, 0) / rs.length : null;
    b.expectancyCI = bootstrapMeanCI(rs);
    b.belowMinN = b.n < filters.minN;
    b.events.sort((a, c) => a.ts - c.ts);
    if (b.events.length >= recentN) {
      const tail = b.events.slice(-recentN);
      const w = tail.reduce((s, e) => s + (e.worked ? 1 : 0), 0);
      b.recentRate = w / tail.length;
      b.recentSamples = tail.length;
      b.drift = b.rate != null ? b.recentRate - b.rate : null;
    }
  }

  const baselineN = baselineWorked + baselineFailed;
  const baseline: BaselineStats = {
    n: baselineN,
    worked: baselineWorked,
    failed: baselineFailed,
    rate: baselineN > 0 ? baselineWorked / baselineN : null,
    expectancy: baselineRs.length > 0
      ? baselineRs.reduce((s, x) => s + x, 0) / baselineRs.length
      : null,
    rSamples: baselineRs.length,
  };

  // Lift + significance.
  for (const b of byKey.values()) {
    if (baseline.rate != null && b.rate != null) {
      b.rateLift = b.rate - baseline.rate;
    }
    if (baseline.expectancy != null && b.expectancy != null) {
      b.expectancyLift = b.expectancy - baseline.expectancy;
    }
    const test = twoProportionZTest(b.worked, b.n, baseline.worked, baseline.n);
    b.pValue = test?.p ?? null;
    b.significant = !b.belowMinN && b.pValue != null && b.pValue < 0.05;
  }

  return { byKey, baseline, scopedTradeCount: scoped };
}

/** Build a 15-min sub-grid of a (hour, half) bucket from the input trade list. */
export function subGridFifteenMin({
  trades,
  filters,
  symbolResolver,
  timezone,
  hour,
  half,
}: BucketTradesInput & { hour: number; half: Half }): SubGridBin[] {
  const halfStart = half === "first" ? 0 : 30;
  // Two 15-min bins per half: [0–15), [15–30) for first; [30–45), [45–60) for second.
  const bins: SubGridBin[] = [
    { startMinute: halfStart, endMinute: halfStart + 15, worked: 0, failed: 0, n: 0, rate: null, expectancy: null },
    { startMinute: halfStart + 15, endMinute: halfStart + 30, worked: 0, failed: 0, n: 0, rate: null, expectancy: null },
  ];
  const rs: number[][] = [[], []];

  const dateFromMs = filters.dateFrom ? Date.parse(filters.dateFrom) : null;
  const dateToMs = filters.dateTo ? Date.parse(filters.dateTo) : null;

  for (const t of trades) {
    if (t.is_archived || !t.symbol) continue;
    if (symbolResolver(t.symbol) !== filters.pair) continue;
    if (filters.direction && t.direction !== filters.direction) continue;
    if (filters.regime && resolveRegime(t) !== filters.regime) continue;
    if (dateFromMs != null) {
      const ts = Date.parse(t.entry_time);
      if (Number.isNaN(ts) || ts < dateFromMs) continue;
    }
    if (dateToMs != null) {
      const ts = Date.parse(t.entry_time);
      if (Number.isNaN(ts) || ts > dateToMs) continue;
    }

    const value = readIdealWindow(t);
    if (!value || value === "none") continue;
    const d = decode(value);
    const tagged = half === "first"
      ? (d.firstWorked || d.firstFailed)
      : (d.secondWorked || d.secondFailed);
    if (!tagged) continue;

    const hm = hourMinuteInTz(t.entry_time, timezone);
    if (!hm || hm.hour !== hour) continue;
    if (half === "first" && hm.minute >= 30) continue;
    if (half === "second" && hm.minute < 30) continue;

    const binIdx = ((hm.minute - halfStart) >= 15) ? 1 : 0;
    const worked = half === "first" ? d.firstWorked : d.secondWorked;
    const failed = half === "first" ? d.firstFailed : d.secondFailed;
    if (worked) bins[binIdx].worked += 1;
    if (failed) bins[binIdx].failed += 1;
    const r = typeof t.r_multiple_actual === "number" ? t.r_multiple_actual : null;
    if (r != null) rs[binIdx].push(r);
  }

  for (let i = 0; i < bins.length; i++) {
    const b = bins[i];
    b.n = b.worked + b.failed;
    b.rate = b.n > 0 ? b.worked / b.n : null;
    b.expectancy = rs[i].length > 0
      ? rs[i].reduce((s, x) => s + x, 0) / rs[i].length
      : null;
  }
  return bins;
}
