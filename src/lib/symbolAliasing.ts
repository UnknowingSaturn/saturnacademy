// Re-export shim. Canonical source: shared/quant/symbolAliasing.ts.
export {
  normalizeSymbol,
  detectAliasSuggestions,
  buildSymbolResolver,
} from "../../shared/quant/symbolAliasing";
export type { SymbolAlias, AliasSuggestion } from "../../shared/quant/symbolAliasing";
