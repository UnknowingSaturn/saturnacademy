// Client shim — re-exports the shared symbol-mapping module. The TICK-SIZE
// OVERRIDE state lives in `shared/quant/symbolMapping.ts` so the React
// client and Supabase edge functions read from a single source of truth.
// Overrides are sourced from `symbol_groups.tick_size_overrides` and
// installed once at PairLab bootstrap via `setTickSizeOverrides()`.

export {
  classifySymbol,
  tickSizeForSymbol,
  pipSizeForSymbol,
  pipLabelForSymbol,
  ticksToPips,
  setTickSizeOverrides,
  getTickSizeOverrides,
} from "../../shared/quant/symbolMapping";
export type { SymbolClass } from "../../shared/quant/symbolMapping";
