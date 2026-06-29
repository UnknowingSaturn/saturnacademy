// Symbol classification + tick/pip helpers. Single source of truth for both
// the React client and Supabase edge functions. Dependency-free (Deno-safe).
//
// A module-level TICK-SIZE OVERRIDE map layers per-symbol corrections on top
// of the default classifier so brokers whose tick doesn't match the heuristic
// (most often crypto / exotic indices) can be patched without touching shared
// math. Overrides come from `symbol_groups.tick_size_overrides` and are
// installed once per request via `setTickSizeOverrides()`. Both client
// (src/lib/symbolMapping.ts) and edge functions
// (supabase/functions/_shared/quant/symbolMapping.ts) re-export from here so
// the override state stays a single shared cell.
//
// Cross-broker alias normalization lives in `./symbolAliasing.ts`.

import { normalizeSymbol } from "./symbolAliasing.ts";

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
  if (/^XAU/.test(n) || n === "GOLD" || n === "GLD") return "metal_xau";
  if (/^XAG/.test(n) || n === "SILVER" || n === "SLV") return "metal_xag";
  if (/^(BTC|XBT|ETH|LTC|XRP|BCH|SOL|ADA|DOT|DOGE|MATIC|POL|AVAX|BNB|LINK|UNI|SHIB|TRX|ATOM|ARB|OP|APT|NEAR|FIL|ICP|ETC|XLM|AAVE)/.test(n)) return "crypto";
  if (/(USOIL|UKOIL|WTI|BRENT|XTIUSD|XBRUSD|USOUSD|UKOUSD|CRUDE)/.test(n)) return "oil";
  if (
    /(NAS100|US100|USTEC|NDX|SPX|US500|US30|DJ30|DJI|DAX|DE40|DE30|GER40|GER30|UK100|FTSE|JP225|JPN225|NIKKEI|N225|HK50|HSI|EU50|STOXX|AUS200|US2000|RUSSELL|FRA40|CAC|CHINA50|CN50|A50)/.test(n)
  ) return "index";
  if (/^[A-Z]{6}$/.test(n)) {
    return /JPY/.test(n) ? "fx3" : "fx5";
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Per-symbol tick-size override map (shared between client + edge functions).
// Keys are NORMALIZED symbols so callers don't need to canonicalize first.
// ---------------------------------------------------------------------------

let TICK_OVERRIDES: Record<string, number> = {};

export function setTickSizeOverrides(map: Record<string, number>): void {
  const next: Record<string, number> = {};
  for (const [raw, v] of Object.entries(map ?? {})) {
    if (!raw || typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
    next[normalizeSymbol(raw)] = v;
  }
  TICK_OVERRIDES = next;
}

export function getTickSizeOverrides(): Readonly<Record<string, number>> {
  return TICK_OVERRIDES;
}

function defaultTickSize(raw: string): number {
  const n = normalizeSymbol(raw);
  // Per-symbol factory defaults — most brokers price these at a coarser tick
  // than the asset-class default would suggest. Without these overrides MAE→pips
  // is silently 10–100× off until the user sets a Symbol Groups override.
  if (n.startsWith("BTC") || n.startsWith("XBT")) return 1.0;     // BTCUSD: most brokers 1.0 (some 0.10)
  if (n.startsWith("ETH")) return 0.1;                            // ETHUSD: most brokers 0.10
  if (/^(NAS100|US100|USTEC|NDX)/.test(n)) return 0.25;           // CME-quoted Nasdaq
  if (/^(SPX500|US500)/.test(n)) return 0.25;                      // CME-quoted S&P
  if (/^(US30|DJ30|DJI)/.test(n)) return 1.0;                      // Dow
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

/**
 * Tick size = smallest broker price increment. Used to convert tick counts
 * back to price distance for R-multiple conversion. Consults the override
 * map first, then falls back to the asset-class default.
 */
export function tickSizeForSymbol(raw: string): number {
  const n = normalizeSymbol(raw);
  if (TICK_OVERRIDES[n] != null) return TICK_OVERRIDES[n];
  return defaultTickSize(raw);
}

/** Pip size (10× tick on FX/metals/oil; equal to tick on indices + crypto). */
export function pipSizeForSymbol(raw: string): number {
  const cls = classifySymbol(raw);
  const tick = tickSizeForSymbol(raw);
  // S2.12: crypto pip was 10× tick, which made a BTC 100-point SL render as
  // "10 pips" while the broker showed 100 points. R math still cancels but
  // the displayed number misled. Treat crypto like indices: 1 point = 1 tick.
  return cls === "index" || cls === "crypto" ? tick : tick * 10;
}

/** Human-readable unit for a symbol's SL/MAE distance. */
export function pipLabelForSymbol(raw: string): "pips" | "points" {
  const cls = classifySymbol(raw);
  return cls === "index" || cls === "crypto" ? "points" : "pips";
}

/**
 * Convert a tick count to pips (or points on indices). Pair-Lab MAE and
 * Ideal-SL custom fields are stored in broker TICKS; this helper bridges
 * to the pip-denominated SL math.
 */
export function ticksToPips(symbol: string, ticks: number): number {
  const tick = tickSizeForSymbol(symbol);
  const pip = pipSizeForSymbol(symbol);
  if (!(tick > 0) || !(pip > 0)) return ticks;
  return (ticks * tick) / pip;
}
