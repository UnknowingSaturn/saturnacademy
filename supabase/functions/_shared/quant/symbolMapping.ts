// Re-export shim. Canonical source: shared/quant/symbolMapping.ts.
// Both the React client (src/lib/symbolMapping.ts) and edge functions import
// from the shared root to guarantee parity.
export {
  classifySymbol,
  tickSizeForSymbol,
  pipSizeForSymbol,
  pipLabelForSymbol,
  ticksToPips,
} from "../../../../shared/quant/symbolMapping.ts";
export type { SymbolClass } from "../../../../shared/quant/symbolMapping.ts";
