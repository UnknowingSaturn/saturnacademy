// ============================================================================
// Instrument specs for the backtest engine.
//
// Everything the engine needs to turn PRICE POINTS into money: tick size, the
// cash value of one tick for one unit of size, round-turn commission and the
// assumed slippage in ticks. No percentages, no ratios of price — the
// project-wide "points, ticks or R" rule holds end to end.
// ============================================================================

import type { SessionInstrumentClass } from "../sessions";

export interface InstrumentSpec {
  symbol: string;
  /** Session calendar to use (FX rolls 17:00 ET, index/futures 18:00 ET). */
  cls: SessionInstrumentClass;
  /** Minimum price increment in points. */
  tickSize: number;
  /** Cash value of one tick for one unit of size (1 contract / 1 lot). */
  tickValue: number;
  /** Commission per side, per unit of size, in cash. */
  commissionPerSide: number;
  /** Assumed adverse slippage in ticks, applied per fill (entry and exit). */
  slippageTicks: number;
}

const SPECS: Record<string, InstrumentSpec> = {
  // CME futures
  NQ: { symbol: "NQ", cls: "index", tickSize: 0.25, tickValue: 5, commissionPerSide: 2.09, slippageTicks: 1 },
  ES: { symbol: "ES", cls: "index", tickSize: 0.25, tickValue: 12.5, commissionPerSide: 2.09, slippageTicks: 1 },
  // CFD indices as quoted by retail brokers (1 unit = 1 index point per lot)
  NASUSD: { symbol: "NASUSD", cls: "index", tickSize: 0.25, tickValue: 0.25, commissionPerSide: 0, slippageTicks: 2 },
  SPXUSD: { symbol: "SPXUSD", cls: "index", tickSize: 0.25, tickValue: 0.25, commissionPerSide: 0, slippageTicks: 2 },
  // Metals
  XAUUSD: { symbol: "XAUUSD", cls: "fx", tickSize: 0.01, tickValue: 1, commissionPerSide: 0, slippageTicks: 3 },
  // FX majors, 1 standard lot: 1 pip (0.0001) = $10, so one 0.00001 tick = $1
  EURUSD: { symbol: "EURUSD", cls: "fx", tickSize: 0.00001, tickValue: 1, commissionPerSide: 3.5, slippageTicks: 3 },
  GBPUSD: { symbol: "GBPUSD", cls: "fx", tickSize: 0.00001, tickValue: 1, commissionPerSide: 3.5, slippageTicks: 3 },
  USDJPY: { symbol: "USDJPY", cls: "fx", tickSize: 0.001, tickValue: 1, commissionPerSide: 3.5, slippageTicks: 3 },
};

/** Spec for a symbol, or a conservative FX default when unknown. */
export function instrumentSpec(symbol: string): InstrumentSpec {
  const key = symbol.toUpperCase();
  const hit = SPECS[key];
  if (hit) return hit;
  const isIndex = /(NAS|SPX|US30|GER|UK100|JP225|NQ|ES|YM|RTY)/.test(key);
  return isIndex
    ? { symbol: key, cls: "index", tickSize: 0.25, tickValue: 0.25, commissionPerSide: 0, slippageTicks: 2 }
    : { symbol: key, cls: "fx", tickSize: key.includes("JPY") ? 0.001 : 0.00001, tickValue: 1, commissionPerSide: 3.5, slippageTicks: 3 };
}

export function listInstrumentSpecs(): InstrumentSpec[] {
  return Object.values(SPECS);
}

/** Convert a distance in price points to ticks. */
export function pointsToTicks(points: number, spec: InstrumentSpec): number {
  return points / spec.tickSize;
}

/** Cash value of a points move for a given size. */
export function pointsToCash(points: number, spec: InstrumentSpec, size: number): number {
  return (points / spec.tickSize) * spec.tickValue * size;
}
