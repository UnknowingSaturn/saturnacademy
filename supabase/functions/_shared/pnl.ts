// Thin re-export shim — canonical source lives at shared/quant/pnl.ts so
// the client (Vite) and edge functions (Deno) consume the same formula.
// Existing edge function imports of `_shared/pnl.ts` keep working.
export { computeNetPnl } from "../../../shared/quant/pnl.ts";
