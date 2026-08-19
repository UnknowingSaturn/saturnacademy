// GENERATED FILE — DO NOT EDIT.
// Vendored copy of shared/quant/ict/nulls.ts for the Deno edge bundler.
// Edit the canonical file at shared/quant/ and run `npm run quant:sync`.
// ============================================================================
// Reference nulls — the benchmarks a strategy has to beat to be an edge.
//
// A backtest that makes money proves nothing on its own: coin flips inside the
// same hour, with the same stop distance and the same trade frequency, make
// money too whenever the underlying drifts or the R:R is generous. These three
// nulls strip away one claim each:
//
//   (a) random entry, same windows  — is the SIGNAL doing anything, or is it
//       the hour and the stop geometry?
//   (b) other hours, same logic     — is the killzone special, or does the
//       logic work anywhere in the session?
//   (c) shuffled direction          — is the DIRECTION call informative, or is
//       the payoff structure alone responsible?
//
// All three re-use the same fill simulator so the comparison is apples to
// apples: same ambiguous-bar convention (stop assumed first), same costs.
// ============================================================================

import type { BarSeries } from "../bars.ts";
import { inWindow, type TradeWindow } from "../sessions.ts";
import type { BacktestTrade } from "./engine.ts";
import type { InstrumentSpec } from "./instruments.ts";
import { makeRng } from "./sweep.ts";

export interface SimulatedFill {
  rMultiple: number;
  exitReason: "stop" | "target" | "time";
  ambiguous: boolean;
}

/**
 * Walk bars forward from `entryIndex` with a fixed stop distance and optional
 * R target, exiting at `maxBars` if neither is hit. Costs are charged in ticks
 * (spread both sides + slippage both sides + commission expressed in ticks),
 * exactly as the engine does, but in R space so the null needs no sizing.
 */
export function simulateFill(
  series: BarSeries,
  entryIndex: number,
  direction: "long" | "short",
  stopPoints: number,
  targetR: number | null,
  maxBars: number,
  spec: InstrumentSpec,
): SimulatedFill | null {
  if (entryIndex < 0 || entryIndex >= series.length) return null;
  if (!(stopPoints > 0)) return null;
  const long = direction === "long";
  const entry = series.close[entryIndex];
  const stop = long ? entry - stopPoints : entry + stopPoints;
  const target =
    targetR && targetR > 0 ? (long ? entry + stopPoints * targetR : entry - stopPoints * targetR) : null;

  const costPoints = (spec.spreadTicks * 2 + spec.slippageTicks * 2) * spec.tickSize;
  const end = Math.min(series.length - 1, entryIndex + maxBars);

  for (let i = entryIndex + 1; i <= end; i++) {
    const hi = series.high[i];
    const lo = series.low[i];
    const hitStop = long ? lo <= stop : hi >= stop;
    const hitTarget = target !== null && (long ? hi >= target : lo <= target);
    if (hitStop || hitTarget) {
      // Both inside one bar → assume the stop filled first (conservative).
      const stopFirst = hitStop;
      const exitPx = stopFirst ? stop : (target as number);
      const gross = long ? exitPx - entry : entry - exitPx;
      return {
        rMultiple: (gross - costPoints) / stopPoints,
        exitReason: stopFirst ? "stop" : "target",
        ambiguous: hitStop && hitTarget,
      };
    }
  }
  const exitPx = series.close[end];
  const gross = long ? exitPx - entry : entry - exitPx;
  return { rMultiple: (gross - costPoints) / stopPoints, exitReason: "time", ambiguous: false };
}

// ---------------------------------------------------------------------------
// Distribution helpers
// ---------------------------------------------------------------------------

export interface NullDistribution {
  label: string;
  /** One statistic per iteration (mean R of that iteration's trade set). */
  samples: number[];
  mean: number;
  p05: number;
  p50: number;
  p95: number;
  /** Where the real result sits, 0-100. */
  realPercentile: number;
  real: number;
  /** True when the real result is not distinguishable from the null. */
  insideNull: boolean;
  iterations: number;
}

export function percentileOf(samples: number[], value: number): number {
  if (!samples.length) return 50;
  const below = samples.filter((s) => s < value).length;
  return (below / samples.length) * 100;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

export function describeNull(label: string, samples: number[], real: number): NullDistribution {
  const sorted = [...samples].sort((a, b) => a - b);
  const pct = percentileOf(samples, real);
  return {
    label,
    samples: sorted.length > 400 ? sorted.filter((_, i) => i % Math.ceil(sorted.length / 400) === 0) : sorted,
    mean: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0,
    p05: quantile(sorted, 0.05),
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    realPercentile: pct,
    real,
    insideNull: pct < 95,
    iterations: samples.length,
  };
}

// ---------------------------------------------------------------------------
// (a) Random entry, same windows
// ---------------------------------------------------------------------------

/**
 * Coin-flip direction at a uniform random minute inside the config's windows,
 * with the stop distance and target structure copied from the real trades and
 * the same trades-per-day count.
 */
export function randomEntryNull(
  series: BarSeries,
  trades: BacktestTrade[],
  windows: TradeWindow[],
  spec: InstrumentSpec,
  iterations = 1000,
  seed = 424242,
): number[] {
  if (!trades.length || !series.length) return [];

  // Index the eligible minutes by session date so a synthetic trade lands in
  // the same session the real one did.
  const byDate = new Map<string, number[]>();
  for (let i = 0; i < series.length; i++) {
    const ms = series.ts[i];
    if (!windows.some((w) => inWindow(ms, w))) continue;
    const key = new Date(ms).toISOString().slice(0, 10);
    const arr = byDate.get(key);
    if (arr) arr.push(i);
    else byDate.set(key, [i]);
  }

  const stops = trades.map((t) => t.riskPoints).filter((v) => v > 0);
  const targets = trades.map((t) => (t.targetPrice === null ? null : Math.abs(t.targetPrice - t.entryPrice) / Math.max(t.riskPoints, 1e-9)));
  const perDate = new Map<string, number>();
  for (const t of trades) perDate.set(t.sessionDate, (perDate.get(t.sessionDate) ?? 0) + 1);
  const maxBars = Math.max(...windows.map((w) => w.endMin - w.startMin), 30);

  const rng = makeRng(seed);
  const out: number[] = [];
  for (let it = 0; it < iterations; it++) {
    const rs: number[] = [];
    for (const [date, count] of perDate) {
      const minutes = byDate.get(date);
      if (!minutes || minutes.length < 2) continue;
      for (let k = 0; k < count; k++) {
        const idx = minutes[rng.int(minutes.length)];
        const stop = stops.length ? stops[rng.int(stops.length)] : 0;
        const tr = targets.length ? targets[rng.int(targets.length)] : null;
        const fill = simulateFill(series, idx, rng.next() < 0.5 ? "long" : "short", stop, tr, maxBars, spec);
        if (fill) rs.push(fill.rMultiple);
      }
    }
    if (rs.length) out.push(rs.reduce((a, b) => a + b, 0) / rs.length);
  }
  return out;
}

// ---------------------------------------------------------------------------
// (c) Shuffled direction
// ---------------------------------------------------------------------------

/**
 * Keep the real signal log, flip each trade's direction with p=0.5 and
 * re-simulate the fill only. Stop distance and target structure are preserved,
 * so only the directional call is destroyed.
 */
export function shuffledDirectionNull(
  series: BarSeries,
  trades: BacktestTrade[],
  spec: InstrumentSpec,
  iterations = 1000,
  seed = 909090,
): number[] {
  if (!trades.length) return [];
  const rng = makeRng(seed);
  const out: number[] = [];
  const maxBarsFor = (t: BacktestTrade) => Math.max(30, t.barsHeld * 3);

  for (let it = 0; it < iterations; it++) {
    const rs: number[] = [];
    for (const t of trades) {
      const flip = rng.next() < 0.5;
      if (!flip) {
        rs.push(t.rMultiple);
        continue;
      }
      const dir: "long" | "short" = t.direction === "long" ? "short" : "long";
      const targetR =
        t.targetPrice === null ? null : Math.abs(t.targetPrice - t.entryPrice) / Math.max(t.riskPoints, 1e-9);
      const fill = simulateFill(series, t.entryIndex, dir, t.riskPoints, targetR, maxBarsFor(t), spec);
      rs.push(fill ? fill.rMultiple : 0);
    }
    if (rs.length) out.push(rs.reduce((a, b) => a + b, 0) / rs.length);
  }
  return out;
}

// ---------------------------------------------------------------------------
// (b) Other hours — window enumeration
// ---------------------------------------------------------------------------

/**
 * Every non-overlapping 60-minute window inside the trading session, ET. The
 * caller runs the config's own logic on each of these and treats the resulting
 * set of statistics as the distribution.
 */
export function sessionHourWindows(startMin = 3 * 60, endMin = 16 * 60): TradeWindow[] {
  const out: TradeWindow[] = [];
  for (let m = startMin; m + 60 <= endMin; m += 60) {
    const h = Math.floor(m / 60);
    out.push({
      key: `h_${String(h).padStart(2, "0")}`,
      label: `${String(h).padStart(2, "0")}:00 ET`,
      startMin: m,
      endMin: m + 60,
    });
  }
  return out;
}
