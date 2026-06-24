// Client-side symbol mapping shim. The canonical (server-safe) classifier
// lives in shared/quant/symbolMapping.ts. On the client we layer a per-symbol
// TICK-SIZE OVERRIDE map on top so brokers whose tick size doesn't match the
// default classifier (most often crypto, where one broker quotes in cents and
// another in whole dollars) can be corrected by the user without having to
// touch shared math.
//
// The override map is sourced from `symbol_groups.tick_size_overrides`
// (merged across all groups) and installed once at PairLab bootstrap via
// `setTickSizeOverrides()`.

import {
  classifySymbol,
  tickSizeForSymbol as baseTickSizeForSymbol,
  pipSizeForSymbol as basePipSizeForSymbol,
  pipLabelForSymbol,
} from "../../shared/quant/symbolMapping";
import { normalizeSymbol } from "../../shared/quant/symbolAliasing";

export { classifySymbol, pipLabelForSymbol };
export type { SymbolClass } from "../../shared/quant/symbolMapping";

// Module-level override map. Keys are NORMALIZED symbols (uppercase, alias-
// stripped) so callers don't need to canonicalize before lookup.
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

export function tickSizeForSymbol(raw: string): number {
  const n = normalizeSymbol(raw);
  if (TICK_OVERRIDES[n] != null) return TICK_OVERRIDES[n];
  return baseTickSizeForSymbol(raw);
}

export function pipSizeForSymbol(raw: string): number {
  const n = normalizeSymbol(raw);
  if (TICK_OVERRIDES[n] != null) {
    // Pip = 10× tick for non-index instruments, equal to tick for indices.
    const cls = classifySymbol(raw);
    return cls === "index" ? TICK_OVERRIDES[n] : TICK_OVERRIDES[n] * 10;
  }
  return basePipSizeForSymbol(raw);
}

export function ticksToPips(symbol: string, ticks: number): number {
  const tick = tickSizeForSymbol(symbol);
  const pip = pipSizeForSymbol(symbol);
  if (!(tick > 0) || !(pip > 0)) return ticks;
  return (ticks * tick) / pip;
}
