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

import type { BarSeries } from "../bars.ts";
import { sessionDate, isRth, toNewYork, type SessionInstrumentClass } from "../sessions.ts";

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

export interface LiquidityLevel {
  kind: "prior_session_high" | "prior_session_low" | "prior_rth_high" | "prior_rth_low";
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
export function detectSweeps(s: BarSeries, levels: LiquidityLevel[], minPenetration = 0): Sweep[] {
  const highs = levels.filter((l) => l.kind.endsWith("high")).sort((a, b) => a.validFromIndex - b.validFromIndex);
  const lows = levels.filter((l) => l.kind.endsWith("low")).sort((a, b) => a.validFromIndex - b.validFromIndex);
  const out: Sweep[] = [];
  for (let i = 0; i < s.length; i++) {
    for (const l of highs) {
      if (l.validFromIndex > i) break;
      const pen = s.high[i] - l.price;
      if (pen > minPenetration && s.close[i] < l.price) {
        out.push({ index: i, ts: s.ts[i], side: "high", level: l.price, levelKind: l.kind, penetration: pen });
      }
    }
    for (const l of lows) {
      if (l.validFromIndex > i) break;
      const pen = l.price - s.low[i];
      if (pen > minPenetration && s.close[i] > l.price) {
        out.push({ index: i, ts: s.ts[i], side: "low", level: l.price, levelKind: l.kind, penetration: pen });
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
