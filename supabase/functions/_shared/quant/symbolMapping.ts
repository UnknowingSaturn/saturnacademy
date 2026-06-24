// Edge-function shim. Canonical source: shared/quant/symbolMapping.ts.
// Both the React client (src/lib/symbolMapping.ts) and edge functions import
// from the shared root so per-symbol tick-size overrides are installed once
// per request and read by every consumer.
export {
  classifySymbol,
  tickSizeForSymbol,
  pipSizeForSymbol,
  pipLabelForSymbol,
  ticksToPips,
  setTickSizeOverrides,
  getTickSizeOverrides,
} from "../../../../shared/quant/symbolMapping.ts";
export type { SymbolClass } from "../../../../shared/quant/symbolMapping.ts";
