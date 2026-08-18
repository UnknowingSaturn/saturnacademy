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
  /**
   * Typical half-spread in ticks during the liquid killzones. Bars are BID
   * (or mid) only, so the spread has to be modelled rather than measured: it
   * is charged on entry AND exit, doubled outside the liquid windows.
   */
  spreadTicks: number;
  /** Smallest tradeable size increment (0.01 lots on retail CFD accounts). */
  sizeStep: number;
  /** Largest size the sizer may ever produce, as a guard rail. */
  maxSize: number;
}

const SPECS: Record<string, InstrumentSpec> = {
  // CME futures
  NQ: { symbol: "NQ", cls: "index", tickSize: 0.25, tickValue: 5, commissionPerSide: 2.09, slippageTicks: 1, spreadTicks: 1, sizeStep: 1, maxSize: 50 },
  ES: { symbol: "ES", cls: "index", tickSize: 0.25, tickValue: 12.5, commissionPerSide: 2.09, slippageTicks: 1, spreadTicks: 1, sizeStep: 1, maxSize: 50 },
  // CFD indices as quoted by retail brokers (1 unit = 1 index point per lot)
  NAS100: { symbol: "NAS100", cls: "index", tickSize: 0.25, tickValue: 0.25, commissionPerSide: 0, slippageTicks: 2, spreadTicks: 6, sizeStep: 0.01, maxSize: 100 },
  SP500: { symbol: "SP500", cls: "index", tickSize: 0.25, tickValue: 0.25, commissionPerSide: 0, slippageTicks: 2, spreadTicks: 3, sizeStep: 0.01, maxSize: 100 },
  NASUSD: { symbol: "NASUSD", cls: "index", tickSize: 0.25, tickValue: 0.25, commissionPerSide: 0, slippageTicks: 2, spreadTicks: 6, sizeStep: 0.01, maxSize: 100 },
  SPXUSD: { symbol: "SPXUSD", cls: "index", tickSize: 0.25, tickValue: 0.25, commissionPerSide: 0, slippageTicks: 2, spreadTicks: 3, sizeStep: 0.01, maxSize: 100 },
  // Metals
  XAUUSD: { symbol: "XAUUSD", cls: "fx", tickSize: 0.01, tickValue: 1, commissionPerSide: 0, slippageTicks: 3, spreadTicks: 15, sizeStep: 0.01, maxSize: 50 },
  XAGUSD: { symbol: "XAGUSD", cls: "fx", tickSize: 0.001, tickValue: 5, commissionPerSide: 0, slippageTicks: 3, spreadTicks: 20, sizeStep: 0.01, maxSize: 50 },
  // FX majors, 1 standard lot: 1 pip (0.0001) = $10, so one 0.00001 tick = $1
  EURUSD: { symbol: "EURUSD", cls: "fx", tickSize: 0.00001, tickValue: 1, commissionPerSide: 3.5, slippageTicks: 3, spreadTicks: 6, sizeStep: 0.01, maxSize: 50 },
  GBPUSD: { symbol: "GBPUSD", cls: "fx", tickSize: 0.00001, tickValue: 1, commissionPerSide: 3.5, slippageTicks: 3, spreadTicks: 8, sizeStep: 0.01, maxSize: 50 },
  USDJPY: { symbol: "USDJPY", cls: "fx", tickSize: 0.001, tickValue: 1, commissionPerSide: 3.5, slippageTicks: 3, spreadTicks: 7, sizeStep: 0.01, maxSize: 50 },
};

/** Spec for a symbol, or a conservative FX default when unknown. */
export function instrumentSpec(symbol: string): InstrumentSpec {
  const key = symbol.toUpperCase();
  // The bar store is keyed canonically, but a caller may still pass a broker
  // spelling (NASUSD, US100.cash) — resolve both.
  const hit = SPECS[key] ?? SPECS[normalizeSymbol(key)];
  if (hit) return hit;
  const isIndex = /(NAS|SPX|US30|GER|UK100|JP225|NQ|ES|YM|RTY)/.test(key);
  return isIndex
    ? { symbol: key, cls: "index", tickSize: 0.25, tickValue: 0.25, commissionPerSide: 0, slippageTicks: 2, spreadTicks: 6, sizeStep: 0.01, maxSize: 100 }
    : {
        symbol: key,
        cls: "fx",
        tickSize: key.includes("JPY") ? 0.001 : 0.00001,
        tickValue: 1,
        commissionPerSide: 3.5,
        slippageTicks: 3,
        spreadTicks: 8,
        sizeStep: 0.01,
        maxSize: 50,
      };
}

export function listInstrumentSpecs(): InstrumentSpec[] {
  return Object.values(SPECS);
}

/**
 * Merge user/journal-derived overrides onto the catalogue spec. Only finite,
 * positive numbers win — an empty input never silently zeroes a cost.
 */
export function withSpecOverrides(
  base: InstrumentSpec,
  over: Partial<InstrumentSpec> | null | undefined,
): InstrumentSpec {
  if (!over) return base;
  const out = { ...base };
  for (const k of ["tickSize", "tickValue", "commissionPerSide", "slippageTicks", "spreadTicks", "sizeStep", "maxSize"] as const) {
    const v = over[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      if (k === "tickSize" && v <= 0) continue;
      out[k] = v;
    }
  }
  if (over.cls === "fx" || over.cls === "index") out.cls = over.cls;
  return out;
}

/** Convert a distance in price points to ticks. */
export function pointsToTicks(points: number, spec: InstrumentSpec): number {
  return points / spec.tickSize;
}

/** Cash value of a points move for a given size. */
export function pointsToCash(points: number, spec: InstrumentSpec, size: number): number {
  return (points / spec.tickSize) * spec.tickValue * size;
}

/** Size (contracts/lots) that risks `riskCash` over a `riskPoints` stop. */
export function sizeForRisk(riskCash: number, riskPoints: number, spec: InstrumentSpec): number {
  if (!(riskCash > 0) || !(riskPoints > 0)) return 0;
  const cashPerUnit = (riskPoints / spec.tickSize) * spec.tickValue;
  if (!(cashPerUnit > 0)) return 0;
  const raw = riskCash / cashPerUnit;
  const step = spec.sizeStep > 0 ? spec.sizeStep : 0.01;
  const stepped = Math.floor(raw / step + 1e-9) * step;
  const clamped = Math.min(stepped, spec.maxSize);
  // Round to the step's precision so 0.1+0.2 style drift never reaches P&L.
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return Number(clamped.toFixed(decimals));
}

