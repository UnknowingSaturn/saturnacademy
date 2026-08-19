// ============================================================================
// Layer 2 — ICT feature detectors over a 1-minute BarSeries.
//
// HARD RULE: every value emitted for bar i is computed from bars <= i only.
// Detectors that need a "confirmed" event (swings, sweeps, MSS) emit at the
// bar where the confirmation is *knowable*, not at the bar the pattern points
// back to. `detectors.test.ts` proves this by truncating the series and
// re-running: a detector output for bar i must be byte-identical whether the
// series ends at i or continues. The single exception is `htfBias("perfect")`,
// which is deliberately look-ahead and is only for measuring an upper bound.
//
// All distances are in PRICE POINTS (never percentages or ratios of price) so
// the numbers convert to ticks/R with the instrument's tick size, matching the
// project-wide "points, ticks or R" rule.
// ============================================================================

import { resample, type BarSeries } from "../bars";
import { sessionDate, isRth, toNewYork, type SessionInstrumentClass, type TradeWindow } from "../sessions";

// ---------------------------------------------------------------------------
// Fair value gaps
// ---------------------------------------------------------------------------

export type Direction = "bull" | "bear";

export interface FairValueGap {
  /** Index of the third (confirming) bar — the first bar at which the gap exists. */
  index: number;
  ts: number;
  direction: Direction;
  /** Edge nearest to price when the gap forms (entry side). */
  proximal: number;
  /** Far edge of the gap. */
  distal: number;
  /** Midpoint — the classic 50% "consequent encroachment" entry. */
  mid: number;
  /** Gap height in price points. */
  size: number;
}

/**
 * Three-bar FVG: bar i-2 high < bar i low (bullish) or i-2 low > bar i high
 * (bearish). Emitted at bar i, which is exactly when the gap becomes known.
 */
export function detectFvgs(s: BarSeries, minSize = 0): FairValueGap[] {
  const out: FairValueGap[] = [];
  for (let i = 2; i < s.length; i++) {
    const gapUp = s.low[i] - s.high[i - 2];
    if (gapUp > 0 && gapUp >= minSize) {
      out.push({
        index: i, ts: s.ts[i], direction: "bull",
        // Price falls back into a bullish gap from above: the top edge is hit first.
        proximal: s.low[i], distal: s.high[i - 2], mid: (s.low[i] + s.high[i - 2]) / 2, size: gapUp,
      });
      continue;
    }
    const gapDown = s.low[i - 2] - s.high[i];
    if (gapDown > 0 && gapDown >= minSize) {
      out.push({
        index: i, ts: s.ts[i], direction: "bear",
        proximal: s.high[i], distal: s.low[i - 2], mid: (s.high[i] + s.low[i - 2]) / 2, size: gapDown,
      });
    }
  }
  return out;
}

/**
 * First index > gap.index at which price trades into the gap, or -1.
 * "Filled" here means touched to `fillFraction` of the gap depth measured from
 * the proximal edge (0 = touch the near edge, 0.5 = 50% fill, 1 = full fill).
 */
export function fvgFillIndex(s: BarSeries, gap: FairValueGap, fillFraction = 0): number {
  const level = gap.direction === "bull"
    ? gap.proximal - gap.size * fillFraction
    : gap.proximal + gap.size * fillFraction;
  for (let i = gap.index + 1; i < s.length; i++) {
    if (gap.direction === "bull" ? s.low[i] <= level : s.high[i] >= level) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Fractal swings
// ---------------------------------------------------------------------------

export interface Swing {
  /** Index of the pivot bar itself. */
  index: number;
  ts: number;
  price: number;
  kind: "high" | "low";
  /** Index at which the pivot became confirmed (pivot + right strength). */
  confirmedIndex: number;
}

/**
 * Fractal pivots with `strength` bars on each side. A pivot at index p is only
 * confirmed at p + strength, so `confirmedIndex` is what causal consumers must
 * gate on — never `index`.
 */
export function detectSwings(s: BarSeries, strength = 2): Swing[] {
  const out: Swing[] = [];
  for (let p = strength; p < s.length - strength; p++) {
    let isHigh = true;
    let isLow = true;
    for (let k = 1; k <= strength; k++) {
      if (s.high[p] <= s.high[p - k] || s.high[p] < s.high[p + k]) isHigh = false;
      if (s.low[p] >= s.low[p - k] || s.low[p] > s.low[p + k]) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) out.push({ index: p, ts: s.ts[p], price: s.high[p], kind: "high", confirmedIndex: p + strength });
    if (isLow) out.push({ index: p, ts: s.ts[p], price: s.low[p], kind: "low", confirmedIndex: p + strength });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Session liquidity levels
// ---------------------------------------------------------------------------

export type LiquidityKind =
  | "prior_session_high" | "prior_session_low"
  | "prior_rth_high" | "prior_rth_low"
  | "pre_window_high" | "pre_window_low"
  | "swing_high" | "swing_low";

export interface LiquidityLevel {
  kind: LiquidityKind;
  price: number;
  /** Session the level was formed in. */
  sourceDate: string;
  /** First bar index at which the level is usable (the next session's open). */
  validFromIndex: number;
}

interface SessionSpan { dateKey: string; from: number; to: number; }

/** Contiguous index spans per session date, in chronological order. */
export function sessionSpans(s: BarSeries, cls: SessionInstrumentClass): SessionSpan[] {
  const out: SessionSpan[] = [];
  let cur: SessionSpan | null = null;
  for (let i = 0; i < s.length; i++) {
    const key = sessionDate(s.ts[i], cls);
    if (!cur || cur.dateKey !== key) {
      if (cur) out.push(cur);
      cur = { dateKey: key, from: i, to: i };
    } else {
      cur.to = i;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Prior-session and prior-RTH extremes. Each level is stamped with the index of
 * the first bar of the *following* session, so a consumer that filters on
 * `validFromIndex <= i` can never read a level from the session it is trading.
 */
export function priorSessionLevels(s: BarSeries, cls: SessionInstrumentClass): LiquidityLevel[] {
  const spans = sessionSpans(s, cls);
  const out: LiquidityLevel[] = [];
  for (let k = 0; k < spans.length - 1; k++) {
    const sp = spans[k];
    const validFromIndex = spans[k + 1].from;
    let hi = -Infinity, lo = Infinity, rthHi = -Infinity, rthLo = Infinity;
    for (let i = sp.from; i <= sp.to; i++) {
      if (s.high[i] > hi) hi = s.high[i];
      if (s.low[i] < lo) lo = s.low[i];
      if (isRth(s.ts[i])) {
        if (s.high[i] > rthHi) rthHi = s.high[i];
        if (s.low[i] < rthLo) rthLo = s.low[i];
      }
    }
    out.push({ kind: "prior_session_high", price: hi, sourceDate: sp.dateKey, validFromIndex });
    out.push({ kind: "prior_session_low", price: lo, sourceDate: sp.dateKey, validFromIndex });
    if (rthHi > -Infinity) {
      out.push({ kind: "prior_rth_high", price: rthHi, sourceDate: sp.dateKey, validFromIndex });
      out.push({ kind: "prior_rth_low", price: rthLo, sourceDate: sp.dateKey, validFromIndex });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Liquidity sweeps
// ---------------------------------------------------------------------------

export interface Sweep {
  index: number;
  ts: number;
  /** "high" = liquidity above was taken then rejected (bearish implication). */
  side: "high" | "low";
  level: number;
  levelKind: string;
  /** How far past the level price traded, in points. */
  penetration: number;
}

/**
 * A sweep is a wick through a known level that closes back on the origin side
 * within the same bar. Only levels whose `validFromIndex <= i` are considered,
 * so no future level can be swept.
 */
export function detectSweeps(
  s: BarSeries,
  levels: LiquidityLevel[],
  minPenetration = 0,
  opts: { k?: number; onceOnly?: boolean } = {},
): Sweep[] {
  // k = only the K nearest still-unswept levels on each side are eligible.
  // This is the taught workflow: you mark the handful of levels closest to
  // price before the session, not every level in history.
  const k = opts.k && opts.k > 0 ? opts.k : Infinity;
  const onceOnly = opts.onceOnly ?? false;
  const highs = levels.filter((l) => l.kind.endsWith("high")).sort((a, b) => a.validFromIndex - b.validFromIndex);
  const lows = levels.filter((l) => l.kind.endsWith("low")).sort((a, b) => a.validFromIndex - b.validFromIndex);
  const sweptHigh = new Set<LiquidityLevel>();
  const sweptLow = new Set<LiquidityLevel>();
  const out: Sweep[] = [];

  for (let i = 0; i < s.length; i++) {
    const ref = i > 0 ? s.close[i - 1] : s.open[i];
    const eligible = (side: LiquidityLevel[], swept: Set<LiquidityLevel>) => {
      const live: LiquidityLevel[] = [];
      for (const l of side) {
        if (l.validFromIndex > i) break;
        if (onceOnly && swept.has(l)) continue;
        live.push(l);
      }
      if (live.length <= k) return live;
      // Nearest K by distance from the previous close — the levels price is
      // actually working towards.
      return live
        .map((l) => ({ l, d: Math.abs(l.price - ref) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, k)
        .map((x) => x.l);
    };

    for (const l of eligible(highs, sweptHigh)) {
      const pen = s.high[i] - l.price;
      if (pen > minPenetration && s.close[i] < l.price) {
        out.push({ index: i, ts: s.ts[i], side: "high", level: l.price, levelKind: l.kind, penetration: pen });
        sweptHigh.add(l);
      }
    }
    for (const l of eligible(lows, sweptLow)) {
      const pen = l.price - s.low[i];
      if (pen > minPenetration && s.close[i] > l.price) {
        out.push({ index: i, ts: s.ts[i], side: "low", level: l.price, levelKind: l.kind, penetration: pen });
        sweptLow.add(l);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Displacement
// ---------------------------------------------------------------------------

/**
 * Wilder-style ATR in points, causal: atr[i] uses bars <= i. The first
 * `period` entries are NaN because the average is not yet defined.
 */
export function atrPoints(s: BarSeries, period = 14): Float64Array {
  const out = new Float64Array(s.length).fill(NaN);
  if (s.length < period + 1) return out;
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += trueRange(s, i);
  let atr = sum / period;
  out[period] = atr;
  for (let i = period + 1; i < s.length; i++) {
    atr = (atr * (period - 1) + trueRange(s, i)) / period;
    out[i] = atr;
  }
  return out;
}

function trueRange(s: BarSeries, i: number): number {
  const prevClose = s.close[i - 1];
  return Math.max(s.high[i] - s.low[i], Math.abs(s.high[i] - prevClose), Math.abs(s.low[i] - prevClose));
}

export interface Displacement {
  index: number;
  ts: number;
  direction: Direction;
  /** Body size in points. */
  body: number;
  /** body / ATR at the bar. */
  atrMultiple: number;
}

/**
 * Displacement = an unusually large directional body. Measured against the
 * causal ATR (mode "atr") or against the rolling percentile of the previous
 * `lookback` bodies (mode "percentile"), which adapts to regime without a
 * hand-tuned multiple.
 */
export function detectDisplacement(
  s: BarSeries,
  opts: { mode?: "atr" | "percentile"; atrPeriod?: number; atrMultiple?: number; lookback?: number; percentile?: number } = {},
): Displacement[] {
  const { mode = "atr", atrPeriod = 14, atrMultiple = 1.5, lookback = 240, percentile = 0.9 } = opts;
  const atr = atrPoints(s, atrPeriod);
  const out: Displacement[] = [];
  const bodies = new Float64Array(s.length);
  for (let i = 0; i < s.length; i++) bodies[i] = Math.abs(s.close[i] - s.open[i]);

  for (let i = 0; i < s.length; i++) {
    const body = bodies[i];
    if (body <= 0) continue;
    const direction: Direction = s.close[i] > s.open[i] ? "bull" : "bear";
    if (mode === "atr") {
      const a = atr[i];
      if (!Number.isFinite(a) || a <= 0) continue;
      const mult = body / a;
      if (mult >= atrMultiple) out.push({ index: i, ts: s.ts[i], direction, body, atrMultiple: mult });
    } else {
      // Percentile of the PREVIOUS `lookback` bodies — bar i is excluded so the
      // threshold cannot be moved by the bar it is judging.
      const from = i - lookback;
      if (from < 0) continue;
      const window = Array.from(bodies.slice(from, i)).sort((a, b) => a - b);
      const threshold = window[Math.min(window.length - 1, Math.floor(window.length * percentile))];
      if (body >= threshold && threshold > 0) {
        const a = atr[i];
        out.push({ index: i, ts: s.ts[i], direction, body, atrMultiple: Number.isFinite(a) && a > 0 ? body / a : NaN });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Market structure shift
// ---------------------------------------------------------------------------

export interface MarketStructureShift {
  index: number;
  ts: number;
  direction: Direction;
  /** The swing that was broken. */
  brokenSwingIndex: number;
  brokenPrice: number;
}

/**
 * MSS: a close through the most recent *confirmed* opposing swing. Because a
 * swing is only confirmed `strength` bars after its pivot, an MSS at bar i can
 * only reference pivots with confirmedIndex <= i.
 */
export function detectMss(s: BarSeries, swings: Swing[], strengthGuard = true): MarketStructureShift[] {
  const ordered = [...swings].sort((a, b) => a.confirmedIndex - b.confirmedIndex);
  const out: MarketStructureShift[] = [];
  let cursor = 0;
  let lastHigh: Swing | null = null;
  let lastLow: Swing | null = null;
  let brokenHigh = -1;
  let brokenLow = -1;

  for (let i = 0; i < s.length; i++) {
    while (cursor < ordered.length && ordered[cursor].confirmedIndex <= i) {
      const sw = ordered[cursor++];
      if (strengthGuard && sw.confirmedIndex > i) continue;
      if (sw.kind === "high") lastHigh = sw; else lastLow = sw;
    }
    if (lastHigh && lastHigh.index !== brokenHigh && s.close[i] > lastHigh.price) {
      out.push({ index: i, ts: s.ts[i], direction: "bull", brokenSwingIndex: lastHigh.index, brokenPrice: lastHigh.price });
      brokenHigh = lastHigh.index;
    }
    if (lastLow && lastLow.index !== brokenLow && s.close[i] < lastLow.price) {
      out.push({ index: i, ts: s.ts[i], direction: "bear", brokenSwingIndex: lastLow.index, brokenPrice: lastLow.price });
      brokenLow = lastLow.index;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Higher-timeframe bias
// ---------------------------------------------------------------------------

export type BiasMode = "prior_close" | "trend" | "perfect";
export type Bias = "long" | "short" | "neutral";

/**
 * Per-bar HTF bias.
 *  - "prior_close": price above/below the prior session close.
 *  - "trend": sign of the slope of the last `trendDays` prior-session closes.
 *  - "perfect": LOOK-AHEAD — the session's own close vs its open. Only valid
 *    for measuring the ceiling a perfect bias filter would give; never trade it.
 */
export function htfBias(
  s: BarSeries,
  cls: SessionInstrumentClass,
  mode: BiasMode = "prior_close",
  trendDays = 3,
): Int8Array {
  const spans = sessionSpans(s, cls);
  const out = new Int8Array(s.length); // 1 long, -1 short, 0 neutral
  const closes: number[] = [];

  for (let k = 0; k < spans.length; k++) {
    const sp = spans[k];
    if (mode === "perfect") {
      const dir = s.close[sp.to] > s.open[sp.from] ? 1 : s.close[sp.to] < s.open[sp.from] ? -1 : 0;
      for (let i = sp.from; i <= sp.to; i++) out[i] = dir;
    } else if (mode === "prior_close" && k > 0) {
      const ref = closes[closes.length - 1];
      for (let i = sp.from; i <= sp.to; i++) out[i] = s.close[i] > ref ? 1 : s.close[i] < ref ? -1 : 0;
    } else if (mode === "trend" && closes.length >= trendDays) {
      const recent = closes.slice(-trendDays);
      const dir = recent[recent.length - 1] > recent[0] ? 1 : recent[recent.length - 1] < recent[0] ? -1 : 0;
      for (let i = sp.from; i <= sp.to; i++) out[i] = dir;
    }
    closes.push(s.close[sp.to]);
  }
  return out;
}

export function biasLabel(v: number): Bias {
  return v > 0 ? "long" : v < 0 ? "short" : "neutral";
}

/** ET minute-of-day for each bar — handy for window filters in the engine. */
export function etMinutes(s: BarSeries): Int16Array {
  const out = new Int16Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = toNewYork(s.ts[i]).minuteOfDay;
  return out;
}

// ---------------------------------------------------------------------------
// Higher-timeframe features (5m FVGs, 15m swings, 15m structure bias)
//
// Every HTF feature is stamped with the index of the 1-MINUTE bar at which the
// HTF candle closes, so the causal contract above survives aggregation: a 5m
// FVG printed by the 10:10–10:15 candle is only visible from the 10:14 minute
// bar onward, never at 10:10.
// ---------------------------------------------------------------------------

/** FVGs on an aggregated timeframe, projected back onto 1-minute indices. */
export function detectFvgsTf(s: BarSeries, timeframeMinutes: number, minSize = 0): FairValueGap[] {
  if (!(timeframeMinutes > 1)) return detectFvgs(s, minSize);
  const { series, closeIndex } = resample(s, timeframeMinutes);
  return detectFvgs(series, minSize).map((g) => {
    const i = closeIndex[g.index];
    return { ...g, index: i, ts: s.ts[i] };
  });
}

/** Fractal swings on an aggregated timeframe, projected onto 1-minute indices. */
export function detectSwingsTf(s: BarSeries, timeframeMinutes: number, strength = 2): Swing[] {
  if (!(timeframeMinutes > 1)) return detectSwings(s, strength);
  const { series, closeIndex } = resample(s, timeframeMinutes);
  return detectSwings(series, strength).map((sw) => {
    const pivot = closeIndex[sw.index];
    const confirmed = closeIndex[Math.min(sw.confirmedIndex, closeIndex.length - 1)];
    return { ...sw, index: pivot, ts: s.ts[pivot], confirmedIndex: Math.max(pivot, confirmed) };
  });
}

/**
 * Swing-structure trend bias: +1 while the last two confirmed swing highs AND
 * lows are both rising (HH + HL), -1 while both are falling (LH + LL), and it
 * holds the last state in between (an incomplete leg is not a reversal).
 * Feed it `detectSwingsTf(s, 15, strength)` for the taught 15m definition.
 */
export function structureBias(s: BarSeries, swings: Swing[]): Int8Array {
  const ordered = [...swings].sort((a, b) => a.confirmedIndex - b.confirmedIndex);
  const out = new Int8Array(s.length);
  let cursor = 0;
  let state = 0;
  let hi1: number | null = null, hi2: number | null = null;
  let lo1: number | null = null, lo2: number | null = null;

  for (let i = 0; i < s.length; i++) {
    while (cursor < ordered.length && ordered[cursor].confirmedIndex <= i) {
      const sw = ordered[cursor++];
      if (sw.kind === "high") { hi2 = hi1; hi1 = sw.price; }
      else { lo2 = lo1; lo1 = sw.price; }
      if (hi1 != null && hi2 != null && lo1 != null && lo2 != null) {
        if (hi1 > hi2 && lo1 > lo2) state = 1;
        else if (hi1 < hi2 && lo1 < lo2) state = -1;
      }
    }
    out[i] = state as -1 | 0 | 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Liquidity universes
// ---------------------------------------------------------------------------

export type SweepUniverse =
  | "session_refs"
  | "session_refs_plus_swings"
  | "bsl_ssl_15m"
  | "swings_only";

/**
 * Pre-window extremes: the high/low made in the session BEFORE the trade
 * window opens (e.g. the 18:00→10:00 ET run-up into Silver Bullet). Valid from
 * the first bar of the window itself.
 */
export function preWindowLevels(s: BarSeries, cls: SessionInstrumentClass, windows: TradeWindow[]): LiquidityLevel[] {
  const spans = sessionSpans(s, cls);
  const etMin = etMinutes(s);
  const out: LiquidityLevel[] = [];
  for (const sp of spans) {
    for (const w of windows) {
      let hi = -Infinity, lo = Infinity, start = -1;
      for (let i = sp.from; i <= sp.to; i++) {
        if (etMin[i] >= w.startMin) { start = i; break; }
        if (s.high[i] > hi) hi = s.high[i];
        if (s.low[i] < lo) lo = s.low[i];
      }
      if (start < 0 || hi === -Infinity) continue;
      out.push({ kind: "pre_window_high", price: hi, sourceDate: sp.dateKey, validFromIndex: start });
      out.push({ kind: "pre_window_low", price: lo, sourceDate: sp.dateKey, validFromIndex: start });
    }
  }
  return out;
}

/** Confirmed swings as liquidity levels — usable only once confirmed. */
export function swingLevels(s: BarSeries, cls: SessionInstrumentClass, swings: Swing[]): LiquidityLevel[] {
  return swings.map((sw) => ({
    kind: (sw.kind === "high" ? "swing_high" : "swing_low") as LiquidityKind,
    price: sw.price,
    sourceDate: sessionDate(sw.ts, cls),
    validFromIndex: sw.confirmedIndex,
  }));
}

export interface UniverseOptions {
  universe: SweepUniverse;
  windows: TradeWindow[];
  swingStrength: number;
  /** Timeframe (minutes) for the swing component of the universe. */
  swingTimeframe: number;
}

/**
 * Build the liquidity universe a config sweeps AND targets from — one list, so
 * "next opposing liquidity" can never point at a level the sweep rule doesn't
 * even consider.
 */
export function buildLiquidityUniverse(
  s: BarSeries,
  cls: SessionInstrumentClass,
  opts: UniverseOptions,
): LiquidityLevel[] {
  const { universe, windows, swingStrength, swingTimeframe } = opts;
  const sessionRefs = () => [...priorSessionLevels(s, cls), ...preWindowLevels(s, cls, windows)];
  switch (universe) {
    case "swings_only":
      return swingLevels(s, cls, detectSwingsTf(s, swingTimeframe, swingStrength));
    case "session_refs_plus_swings":
      return [...sessionRefs(), ...swingLevels(s, cls, detectSwings(s, swingStrength))];
    case "bsl_ssl_15m":
      return [...sessionRefs(), ...swingLevels(s, cls, detectSwingsTf(s, 15, swingStrength))];
    case "session_refs":
    default:
      return sessionRefs();
  }
}
