// Re-export shim. Canonical source: shared/quant/symbolMapping.ts.
export {
  classifySymbol,
  tickSizeForSymbol,
  pipSizeForSymbol,
  pipLabelForSymbol,
  ticksToPips,
} from "../../shared/quant/symbolMapping";
export type { SymbolClass } from "../../shared/quant/symbolMapping";
