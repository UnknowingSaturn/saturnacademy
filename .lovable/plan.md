## Pass D — Status

### Quant fixes (shipped earlier in this pass)
Q2 trail-capture parity, Q3 prop-firm cap parity, Q4 server raw-Kelly + `riskBelowFloor` flag, Q5 signed commission, Q6 fresh-restart block bootstrap, Q7 `Infinity` profit-factor sentinel. Q1 PnL reconciliation remains diagnostic-only (CSV exported) — awaits user decision on corrective migration.

### Dead code cleanup (shipped this turn)
- **D5** removed dead TradingView mapping (~80 lines) and dead alias-group exports (~140 lines) from `symbolMapping.ts`. File trimmed from 369 → 88 lines, only tick/pip helpers remain.
- **D6** consolidated `normalizeSymbol` — `symbolAliasing.ts` is now the single source of truth. `useTradeCompliance.tsx` migrated.
- **D7** deleted `src/lib/withForwardRef.tsx`. `tooltip.tsx` now re-exports Radix `Provider`/`Root` directly.
- **D8** deleted `src/components/NavLink.tsx`. `AppSidebar.tsx` uses `react-router-dom`'s `NavLink` with the className-callback API.
- **D12** replaced `(trade as any)[column]` in `Journal.tsx` with a typed `Record<string, unknown>` cast.

### Deferred (large refactors — explicit follow-up)
- **D3** `useCopierSetup()` selector extraction.
- **D4** `TradeTable.tsx` (940 lines) split into `SortableHeader` + `useTradeTableMutations` + helpers.
- **D10** 15 edge functions still inline CORS — migrate to `_shared/cors.ts` helpers.
- **D11** regenerate Supabase types to drop ~17 `(supabase as any)` casts in `useCustomFields`/`useSimulatorProfile`.

### Open question
**Q1**: 295 historical trades have `net_pnl` that no current formula reproduces. Decide: (a) keep diagnostic-only, (b) corrective migration to overwrite from `trade_partial_fills`, or (c) only enforce going forward via constraint.
