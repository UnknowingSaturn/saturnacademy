// Symbol classification + tick/pip helpers used by Pair Lab unit conversion.
// Cross-broker alias normalization lives in `symbolAliasing.ts` (single source
// of truth). The former TradingView mapping table and alias-group exports
// were dead code and have been removed.

import { normalizeSymbol } from "./symbolAliasing";

export type SymbolClass =
  | "fx5"
  | "fx3"
  | "metal_xau"
  | "metal_xag"
  | "index"
  | "crypto"
  | "oil"
  | "unknown";

/**
 * Classify a raw broker symbol into a coarse asset class for tick-size
 * lookups. Matches alias groups + common naming conventions.
 */
export function classifySymbol(raw: string): SymbolClass {
  const n = normalizeSymbol(raw);
  // Metals first (XAU/XAG)
  if (/^XAU/.test(n) || n === "GOLD" || n === "GLD") return "metal_xau";
  if (/^XAG/.test(n) || n === "SILVER" || n === "SLV") return "metal_xag";
  // Crypto
  if (/^(BTC|ETH|LTC|XRP|XBT|BCH|SOL|ADA|DOT)/.test(n)) return "crypto";
  // Oil
  if (/(USOIL|UKOIL|WTI|BRENT|XTIUSD|XBRUSD|USOUSD|UKOUSD|CRUDE)/.test(n)) return "oil";
  // Indices (alias group keys + common tickers)
  if (
    /(NAS100|US100|USTEC|NDX|SPX|US500|US30|DJ30|DJI|DAX|DE40|DE30|GER40|GER30|UK100|FTSE|JP225|JPN225|NIKKEI|N225|HK50|HSI|EU50|STOXX|AUS200|US2000|RUSSELL|FRA40|CAC|CHINA50|CN50|A50)/.test(n)
  ) return "index";
  // FX: 6-letter pair
  if (/^[A-Z]{6}$/.test(n)) {
    return /JPY/.test(n) ? "fx3" : "fx5";
  }
  return "unknown";
}

/**
 * Tick size = smallest broker price increment. Used to convert tick counts
 * (e.g. TradingView position-calc "ticks" output) back to price distance
 * for R-multiple conversion.
 */
export function tickSizeForSymbol(raw: string): number {
  switch (classifySymbol(raw)) {
    case "fx5": return 0.00001;
    case "fx3": return 0.001;
    case "metal_xau": return 0.01;
    case "metal_xag": return 0.001;
    case "index": return 1.0;
    case "crypto": return 0.01;
    case "oil": return 0.01;
    default: return 0.0001; // conservative legacy 4-digit FX
  }
}

/** Pip size (10× tick on most instruments, equal to tick on indices). */
export function pipSizeForSymbol(raw: string): number {
  const cls = classifySymbol(raw);
  if (cls === "index") return 1.0;
  return tickSizeForSymbol(raw) * 10;
}

/** Human-readable unit for a symbol's SL/MAE distance. */
export function pipLabelForSymbol(raw: string): "pips" | "points" {
  return classifySymbol(raw) === "index" ? "points" : "pips";
}

/**
 * Convert a tick count (e.g. TradingView position-calc output) to pips
 * (or points for indices). On 5-digit FX 1 pip = 10 ticks; on indices the
 * tick == 1 point so ticks and "pips" are equal.
 *
 * Pair-Lab unit contract: MAE and Ideal-SL custom fields are logged in
 * broker TICKS. Every read site must convert through this helper before
 * comparing against SL distances expressed in pips.
 */
export function ticksToPips(symbol: string, ticks: number): number {
  const tick = tickSizeForSymbol(symbol);
  const pip = pipSizeForSymbol(symbol);
  if (!(tick > 0) || !(pip > 0)) return ticks;
  return (ticks * tick) / pip;
}
