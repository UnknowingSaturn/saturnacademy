// Mirror of src/lib/symbolMapping.ts tick/pip helpers — kept in sync by hand.
// Used by the Pair-Lab quant ports below for unit conversion.
//
// Intentional divergence from src/lib/symbolMapping.ts: this file only exposes
// the helpers the server actually needs (tick/pip/label). The client file may
// add UI-only helpers without forcing a server update.

export type SymbolClass = "fx5" | "fx3" | "metal_xau" | "metal_xag" | "index" | "crypto" | "oil" | "unknown";

function normalizeSymbol(raw: string): string {
  return (raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function classifySymbol(raw: string): SymbolClass {
  const n = normalizeSymbol(raw);
  if (/^XAU/.test(n) || n === "GOLD" || n === "GLD") return "metal_xau";
  if (/^XAG/.test(n) || n === "SILVER" || n === "SLV") return "metal_xag";
  if (/^(BTC|ETH|LTC|XRP|XBT|BCH|SOL|ADA|DOT)/.test(n)) return "crypto";
  if (/(USOIL|UKOIL|WTI|BRENT|XTIUSD|XBRUSD|USOUSD|UKOUSD|CRUDE)/.test(n)) return "oil";
  if (
    /(NAS100|US100|USTEC|NDX|SPX|US500|US30|DJ30|DJI|DAX|DE40|DE30|GER40|GER30|UK100|FTSE|JP225|JPN225|NIKKEI|N225|HK50|HSI|EU50|STOXX|AUS200|US2000|RUSSELL|FRA40|CAC|CHINA50|CN50|A50)/.test(n)
  ) return "index";
  if (/^[A-Z]{6}$/.test(n)) return /JPY/.test(n) ? "fx3" : "fx5";
  return "unknown";
}

export function tickSizeForSymbol(raw: string): number {
  switch (classifySymbol(raw)) {
    case "fx5": return 0.00001;
    case "fx3": return 0.001;
    case "metal_xau": return 0.01;
    case "metal_xag": return 0.001;
    case "index": return 1.0;
    case "crypto": return 0.01;
    case "oil": return 0.01;
    default: return 0.0001;
  }
}

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
 * Convert a tick count to pips. Pair-Lab MAE and Ideal-SL custom fields are
 * stored in broker TICKS; this helper bridges to the pip-denominated SL math.
 */
export function ticksToPips(symbol: string, ticks: number): number {
  const tick = tickSizeForSymbol(symbol);
  const pip = pipSizeForSymbol(symbol);
  if (!(tick > 0) || !(pip > 0)) return ticks;
  return (ticks * tick) / pip;
}
