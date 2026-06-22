## Pass D — Findings & Plan

Two parallel audits ran. The codebase is in much better shape than before Pass A/B/C — primary R-multiple math validates against real data to ±0.002 across 5 sample trades. But several **quant-impact issues** and a meaningful chunk of **dead/duplicated code** remain.

---

### Quant Findings (severity ordered)

**Q1 (P1) — Data integrity: 295 of 404 closed trades have `net_pnl` that no formula in the codebase can reproduce from the columns stored alongside it.** Example: trade `7522eeb3` has gross=41.13, commission=−41.13, swap=0, but `net_pnl=82.26`. Likely cause: the `trades` row stores final-fill values while `net_pnl` is the running total across all `trade_partial_fills`. All R-multiples on those trades are derived from a `net_pnl` we can't reconstruct.

**Q2 (P1) — Client/server trail-capture drift.** Client default `TRAIL_CAPTURE_FRAC=0.8` with `minSample=5`. Server default `0.7` with `minSample=10`. Same bucket → different runner expectancy in client vs server reports.

**Q3 (P1) — Client/server prop-firm cap drift.** Server hardcodes `HARD_CAP_PCT=2`, ignoring user's `propFirm.hardCapPct`, and applies an extra `maxDrawdownDollars/(streak×2)` cap the client doesn't. Different size recommendations on the same inputs.

**Q4 (P1) — Server Kelly is silently floored at 0.25%; `riskBelowFloor` flag missing on server.** Marginal edges (raw Kelly = 0.08%) get reported as 0.25% with no warning that the edge is too thin.

**Q5 (P2) — `−Math.abs(commission)` still in `tradeMath.ts:26` and `tradeTransform.ts:62`** while `pnl.ts` uses signed addition. Equivalent for MT5 (negative commission) but inverted for positive-commission brokers; the two paths silently disagree.

**Q6 (P2) — Block bootstrap wraps to index 0 instead of a fresh random start** (`propFirmMonteCarlo.ts:146`). Oversamples the head of `rSample` by ~`blockSize/N` (~6% for N=64).

**Q7 (P2) — `profitFactor` returns `null` for all-win buckets** instead of a sentinel — UI treats "perfect record" identically to "no data."

**What's already correct (don't touch):** R-multiple math, `downsideStddev`, `wilsonCi`, BH correction, NIST-7 percentiles, `computeTp1Star` conditional miss, `mulberry32`, Kelly CI two-stream RNG, `slSweep` rescaling, walk-forward split.

---

### Dead Code & Refactor Findings

**D1 (P0)** — `useOpenTrades.tsx:62` duplicate `if (error) throw error` (harmless, delete).
**D2 (P0)** — `CopierDashboard.tsx:35` computes `todayStats` that's never read; delete the `useMemo`.
**D3 (P1)** — `CopierDashboard` and `CopierDashboardView` both re-derive `masterAccount`/`receiverAccounts` from `useCopierAccounts()`. Extract `useCopierSetup()` selector into `useCopier.tsx`.
**D4 (P1)** — `TradeTable.tsx` (940 lines) mixes 3 concerns. Concrete extraction:
- `SortableHeader` (lines 36-63) → `src/components/journal/SortableHeader.tsx`
- 12 `handle*Change` mutation functions (256-314) → `useTradeTableMutations()` hook
- `isAwaitingRepair`, `getSnapshotInfo` (316-355) → `src/lib/tradeMath.ts`
- Keep `handleRepair` in component (owns `repairingId` state)
**D5 (P1)** — `symbolMapping.ts`: 5 dead exports (~140 lines): `mapToTradingViewSymbol`, `isTradingViewSupported`, `SYMBOL_ALIAS_GROUPS`, `findAliasGroup`, `getSuggestedSymbols`, `suggestBestMatch`.
**D6 (P1)** — Duplicate `normalizeSymbol` in `symbolMapping.ts:214` and `symbolAliasing.ts:58`. Privatize the mapping copy, use `symbolAliasing` everywhere.
**D7 (P1)** — `withForwardRef.tsx` still alive because `tooltip.tsx` wraps Radix `Provider`/`Root` (neither forwards refs). Replace with direct re-exports, delete the file.
**D8 (P1)** — `NavLink.tsx` is a single-consumer wrapper that adds nothing the consumer uses. Use `react-router-dom`'s `NavLink` directly in `AppSidebar.tsx`; delete the wrapper.
**D9 (P1)** — Dead exports: `tutorialStorage.clearDismissed`, `tutorialStorage.resetAllTutorials`, `pairLabPresets.getPreset`.
**D10 (P1)** — 15/18 edge functions inline `new Response(JSON.stringify(...))` + OPTIONS preflight when `_shared/cors.ts` already exposes `jsonResponse`/`corsPreflight`. Migrate them.
**D11 (P2)** — `useCustomFields.tsx` has ~15 `(supabase as any)` casts because `custom_field_definitions`/`custom_field_overrides` are missing from generated types. Same root cause for `useSimulatorProfile.tsx:71,77`. Resolved by regenerating Supabase types (no code edit needed beyond removing casts after regen).
**D12 (P2)** — `Journal.tsx:213` `(trade as any)[column]` → `trade[column as keyof Trade]`.

---

### Proposed Execution Order

**Pass D1 — Critical math/integrity (request approval first on Q1):**
- Q1: Investigate via a reconciliation query against `trade_partial_fills`. **This may require a data migration**, not just code — flag for explicit user decision before touching anything.
- Q2, Q3, Q4: Align client/server constants and formulas. Extract `TRAIL_CAPTURE_FRAC`, prop-firm cap, and raw Kelly into single sources of truth; mirror `riskBelowFloor` to server `BucketReport`.

**Pass D2 — Statistical hygiene:**
- Q5: Switch `tradeMath.ts:26` and `tradeTransform.ts:62` to signed addition.
- Q6: Fresh random restart on block-bootstrap wrap.
- Q7: Sentinel value for all-win profit factor (or render "∞" explicitly in UI).

**Pass D3 — Dead code (low risk, high cleanup yield):**
- D1, D2 first (trivial deletions).
- D5, D6, D7, D8, D9, D10 (export/file deletions and consolidation).
- D3 (extract `useCopierSetup` selector).
- D4 (`TradeTable` split — largest diff; do last).

**Pass D4 — Optional type hygiene:**
- D11: regenerate Supabase types, remove ~17 `as any` casts.
- D12: fix `Journal.tsx` sort cast.

---

### Questions Before I Proceed

1. **Q1 net_pnl reconciliation** — 295 trades have an unreconcilable PnL. Do you want me to (a) write a diagnostic script that reports exactly which trades and the proposed correct value (no writes), (b) write the script AND a corrective migration to overwrite `net_pnl`/`r_multiple` from `trade_partial_fills`, or (c) skip — accept that historical data is whatever it is and only enforce a CHECK constraint going forward?

2. **TradeTable split (D4)** — sizeable diff (~400 lines moved). OK to bundle into this pass, or defer to a follow-up?

3. **Edge function CORS migration (D10)** — touches 15 edge functions. OK to do all in one shot, or limit to the 5 most-used (trade-rebuild, pair-lab-report, trade-repair, copier-execute, mt5-events)?

If you don't answer these I'll default to: (1a) diagnostic only, (2) include in this pass, (3) all 15 in one shot.