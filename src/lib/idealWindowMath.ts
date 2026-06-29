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
import { wilsonCi, bootstrapMeanCi, isUnrealized, bhSignificant, ensureUtcMs } from "../../shared/quant/stats";

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
  // S4.2: `new Date(naiveString)` is locale-dependent (Chrome=local,
  // Safari/Node=UTC) — assigned trades to the wrong half-hour bucket for
  // CSV-imported naive timestamps. ensureUtcMs normalises consistently.
  const ms = ensureUtcMs(utcTimestamp);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
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
// Stats primitives — Wilson CI and bootstrap mean CI live in shared/quant/stats
// so the client and edge functions cannot drift. The private mulberry32 +
// fixed-seed bootstrap that used to live here has been deleted; the shared
// helpers use a value-hash seed (more reproducible per-bucket). Local wrapper
// shims (`wilsonInterval`, `bootstrapMeanCI`) were removed in Phase C — call
// sites now use `wilsonCi`/`bootstrapMeanCi` directly.
// ---------------------------------------------------------------------------


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
    // F3 fix: exclude ideas/paper/missed/zero-PnL-no-mod from the heatmap.
    // Tagged ideas inflate the failed-rate (they never executed) and pull
    // R-expectancy toward null. Mirrors buildBuckets' default behaviour.
    if (isUnrealized(t as any)) continue;
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

    if (d.firstWorked) { addToBucket("first", true); baselineWorked += 1; }
    if (d.firstFailed) { addToBucket("first", false); baselineFailed += 1; }
    if (d.secondWorked) { addToBucket("second", true); baselineWorked += 1; }
    if (d.secondFailed) { addToBucket("second", false); baselineFailed += 1; }
    // M3 fix: push each trade's R into the baseline expectancy pool AT MOST
    // ONCE — both halves of `cf_ideal_entry_window_*` reference the same
    // trade, so pushing per-half (as the old code did) double- or quadruple-
    // counted r into the baseline mean. Per-cell buckets are unaffected
    // because they track distinct (hour, half) keys.
    if (r != null && (d.firstWorked || d.firstFailed || d.secondWorked || d.secondFailed)) {
      baselineRs.push(r);
    }
  }

  // Finalize each bucket: rate, CIs, expectancy, recent-window drift.
  const recentN = Math.max(1, filters.recentN ?? 10);
  for (const [k, b] of byKey) {
    b.n = b.worked + b.failed;
    b.rate = b.n > 0 ? b.worked / b.n : null;
    b.rateCI = b.n > 0 ? (wilsonCi(b.worked, b.n) ?? [0, 0]) : null;
    const rs = rsByKey.get(k) ?? [];
    b.rSamples = rs.length;
    b.expectancy = rs.length > 0 ? rs.reduce((s, x) => s + x, 0) / rs.length : null;
    b.expectancyCI = bootstrapMeanCi(rs);
    b.belowMinN = b.n < filters.minN;
    b.events.sort((a, c) => a.ts - c.ts);
    if (b.events.length >= recentN) {
      const tail = b.events.slice(-recentN);
      const w = tail.reduce((s, e) => s + (e.worked ? 1 : 0), 0);
      b.recentRate = w / tail.length;
      b.recentSamples = tail.length;
      // Stored as percentage points (matches `BucketStats.drift` in pairLabMath
      // so the 15pp drift-arrow threshold is unit-consistent across surfaces).
      b.drift = b.rate != null ? (b.recentRate - b.rate) * 100 : null;
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

  // Lift + raw p-values.
  for (const b of byKey.values()) {
    if (baseline.rate != null && b.rate != null) {
      b.rateLift = b.rate - baseline.rate;
    }
    if (baseline.expectancy != null && b.expectancy != null) {
      b.expectancyLift = b.expectancy - baseline.expectancy;
    }
    const test = twoProportionZTest(b.worked, b.n, baseline.worked, baseline.n);
    b.pValue = test?.p ?? null;
    b.significant = false; // set below via BH-FDR
  }

  // N2 fix: Benjamini-Hochberg FDR across all eligible cells. The previous
  // naive p<0.05 across ~48 buckets produced ~2-3 spurious "significant"
  // cells per heatmap. Cells flagged belowMinN are excluded from the test.
  const eligible = [...byKey.values()].filter((b) => !b.belowMinN && b.pValue != null);
  const sig = bhSignificant(eligible.map((b) => b.pValue));
  for (let i = 0; i < eligible.length; i++) eligible[i].significant = sig[i];

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
    if (isUnrealized(t as any)) continue; // O2 fix: drop ideas/paper/missed
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

/**
 * Causal cumulative worked-rate series from a bucket's event timeline.
 * Index i = rate after i+1 events (i.e. uses only data up to event i).
 * Pair with Wilson CI band by passing each cumulative (k, n) to wilsonCi.
 */
export function cumulativeSeries(events: BucketEvent[]): Array<{
  ts: number;
  k: number;
  n: number;
  rate: number;
  ci: [number, number];
}> {
  const out: Array<{ ts: number; k: number; n: number; rate: number; ci: [number, number] }> = [];
  let k = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i].worked) k += 1;
    const n = i + 1;
    out.push({ ts: events[i].ts, k, n, rate: k / n, ci: wilsonCi(k, n) ?? [0, 0] });
  }
  return out;
}

/** Rolling worked-rate over a window of `windowN` events (causal). */
export function rollingRateSeries(
  events: BucketEvent[],
  windowN: number,
): Array<{ ts: number; rate: number; n: number }> {
  if (windowN < 1) return [];
  const out: Array<{ ts: number; rate: number; n: number }> = [];
  for (let i = 0; i < events.length; i++) {
    const start = Math.max(0, i - windowN + 1);
    let w = 0;
    for (let j = start; j <= i; j++) if (events[j].worked) w += 1;
    const n = i - start + 1;
    out.push({ ts: events[i].ts, rate: w / n, n });
  }
  return out;
}

