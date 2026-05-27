# Codebase Audit & Redesign Plan

Three parallel deep audits (edge functions, DB layer, frontend) converged on the same root cause: **the Phase D normalization (typed `trade_partial_fills` / `trade_modifications` / `trade_repair_events` + `trade_view`) was wired as write-only and never finished.** Around that core, a stack of repair edge functions and duplicated session/account logic has accumulated, plus several smaller dead-code clusters.

This plan is split into three phases. Each is independently shippable.

---

## Findings Summary (most consequential first)

### A. Phase D normalization is half-built
- `trade_partial_fills` — written by `ingest-events`, **zero readers**. Initial backfill from JSONB was **wiped 4 minutes after creation** (`20260527194623`) and never re-run. New trades have typed fills; old trades don't.
- `trade_modifications` — written, zero readers.
- `trade_repair_events` — table created, **never written or read** by anything. All repairs still push marker objects into `trades.partial_closes` JSONB.
- `trade_view` (resolves `account_id` via `install_id`/`broker_login`) — created, granted, never queried.
- Frontend still parses `trades.partial_closes` JSONB everywhere. `tradeMath.isRealFill()` guard exists only because real fills and repair markers share the same array.

### B. Repair / reprocess functions have heavy overlap
- **Orphan-exit creation** lives in 2 places: `ingest-events:930-994` (hot path) AND `reprocess-orphan-exits` (manual, called by `Accounts.tsx:83`). Same insert payload, different copies of `getPipSize`/`getPipValue`.
- **Sibling snapshot-closed repair** lives in 2 places: `ingest-events.tryRepairSiblingSnapshotClosed()` (auto) AND `repair-snapshot-closed` edge function (manual). Same search logic, both push markers to JSONB.
- **Session classification** has **4 independent copies**: `ingest-events:1157`, `reprocess-orphan-exits:39`, `reprocess-trades:246`, `reclassify-sessions:28`. One copy hardcodes `America/New_York` ignoring the session's own `timezone` field.
- **Account resolution cascade** is duplicated between `ingest-events:131-300` and `sync-account-state:76-162`.

### C. Hot-path performance bug
- `ingest-events:357-432` runs a 200-row scan of `events` on **every heartbeat** (every ~30–60s per account) just to detect broker DST. Should be cached on the account row.

### D. Schema thrash & missing GRANTs
- `terminal_accounts.is_currently_active` was CREATE → DROP → re-ADD on the same day. The DROP-then-readd reset every value to `false`.
- Duplicate index on `accounts(user_id, mt5_install_id, account_number)`: a unique partial index AND a non-unique full index covering the same hot path.
- 13 tables (mostly older copier/strategy-lab tables) have RLS policies but **no explicit GRANT** statements.
- `terminal_accounts` has only a SELECT policy — INSERT/UPDATE work only via service_role.
- `account_balance_snapshots` table exists with RLS + grants but **has no writer**.

### E. Frontend dead code & brittleness
- **Dead files**: `src/components/chart/TradeChart.tsx`, `TradingViewChart.tsx`, `ReplayControls.tsx` (entire replay subsystem, never wired). `src/lib/copierConfigGenerator.ts` (zero imports).
- **Dead context API**: `LiveTradesContext` chat-state subsystem (~80 lines, 5 methods, 2 Maps) — zero consumers.
- **`transformTrade` spreads raw rows** onto typed `Trade` objects, so the type lies about the runtime shape. Causes the next bullet.
- **R-multiple naming split**: code uses both `r_multiple_actual` (type + `exportUtils.ts`) and `n_actual` (every other consumer). Same value, two names, no enforcement.
- **`useTradeCompliance` position-size rule** is hardcoded to "passed" — shows a misleading green checkmark for an unevaluated rule.
- **Symbol normalization duplicated 4 ways**: `symbolAliases.ts:normalizeSymbol`, `symbolMapping.ts`, and ad-hoc inline regexes in `useOpenTrades` + `useTradeCompliance`.

### F. Strategy-Lab dead scaffold
- `strategy_conversations`, `generated_strategies`, `backtest_results`, `simulation_runs` — created April 14–15, **zero reads/writes** anywhere. `strategy-lab` edge function exists but doesn't touch them. Either integrate or drop.

### G. Other
- `pg_cron` schedule for `mark_dormant_accounts` will silently fail to register if extension is not enabled.
- `accounts.last_sync_at` is fine (active).
- `trades.terminal_id` vs new `trades.install_id` coexist — old column undocumented as deprecated.

---

## Recommended Plan — 3 Phases

### Phase 1 — Stop the bleeding (low risk, high payoff)

Pure cleanup. No behavior change for users.

1. **Delete dead frontend files**:
   `src/components/chart/{TradeChart,TradingViewChart,ReplayControls}.tsx`, `src/lib/copierConfigGenerator.ts`.
2. **Gut `LiveTradesContext`** to `{ selectedTradeId, setSelectedTradeId, pendingSavesRef }`. Move compliance state local to `LiveTradeCompliancePanel`.
3. **Consolidate session classification** into `supabase/functions/_shared/session.ts`. Replace the 4 copies. Fix the timezone-hardcoding bug in `reprocess-trades`.
4. **Consolidate `getPipSize` / `getPipValue`** — `reprocess-orphan-exits` already has private copies; import from `_shared/rMultiple.ts`.
5. **Consolidate symbol normalization** — single `normalizeSymbol` export, replace inline regexes in `useOpenTrades` and `useTradeCompliance`.
6. **Cache broker DST detection** on the account row — replace the per-heartbeat 200-row scan with a one-time detection that updates `accounts.broker_dst_profile` and skips re-detection.
7. **Migration**: drop the redundant non-unique `idx_accounts_user_install_login` index. Add explicit GRANTs to the 13 tables missing them.
8. **Either fix or remove** the position-size compliance rule (currently lies).
9. **Decide on Strategy-Lab tables** — either ask user to confirm intent, or drop the 4 unused tables in a migration. (Will surface this as a question rather than auto-drop.)

### Phase 2 — Finish or revert Phase D normalization

The big decision: **finish the typed-table cutover, or revert and stay on JSONB**. Recommend: **finish it**. The JSONB approach is what forces `isRealFill` guards, single-array storage of fills + markers, the unbounded snapshot/repair cycle, and the brittle `transformTrade` spread.

To finish:

1. **Wire `trade_repair_events` writers**: every repair path (`ingest-events.tryRepairSiblingSnapshotClosed`, `repair-snapshot-closed`, `sync-account-state` auto-close, snapshot re-open) inserts a typed row instead of pushing a marker into `partial_closes`.
2. **Backfill migration** (re-do the one that was wiped): scan existing `trades.partial_closes[]`, emit real fills → `trade_partial_fills`, marker entries → `trade_repair_events`.
3. **Update `fresh-start`** to delete from `trade_partial_fills`, `trade_modifications`, `trade_repair_events` as well (currently leaves orphans).
4. **Cutover reads**: `useTrades` / `useOpenTrades` / `tradeTransform` switch to joining `trade_partial_fills` instead of parsing `partial_closes`. Delete `isRealFill` / `getRealPartialCloses` / `original_lots` fallback in `tradeMath`.
5. **Adopt `trade_view`** in the same hooks to pick up `resolved_account_id`, fixing cross-login account reassignment.
6. **Drop `trades.partial_closes` column** in a final migration once readers are confirmed live.
7. **Kill the `transformTrade` spread** — map every field explicitly so the type matches runtime.
8. **Pick one R-multiple name** (recommend `r_multiple_actual` to match DB) and migrate all UI off `n_actual`.

### Phase 3 — Consolidate the repair surface

Once Phase 2 lands, the 5 repair edge functions can collapse:

1. **Delete `reprocess-orphan-exits`** — its job is already done by `ingest-events` hot path. The only reason it exists is to handle events that were processed before the orphan branch was added. After a one-time historical replay, it's dead.
2. **Merge `repair-snapshot-closed`** into a single library function called by both `ingest-events.tryRepairSiblingSnapshotClosed()` (auto) and a thin manual-trigger wrapper (UI button). Eliminate the duplicated search logic.
3. **`reprocess-trades`** stays (recalc-on-config-change is legitimate) but uses `_shared/session.ts` and `_shared/rMultiple.ts`.
4. **`restore-trade-times`** stays (broker TZ correction is a one-shot user action).
5. **`trades-drift`** stays (read-only signal).
6. **Decide on `account_balance_snapshots`** — either wire a writer in `ingest-events`/`sync-account-state` and surface in equity-curve UI, or drop the table.
7. **Drop `trades.terminal_id` column** (superseded by `install_id` + `broker_login`).

---

## What I'm asking for before I touch anything

Three decisions drive how much I do in Phase 1 vs. defer:

1. **Strategy-Lab tables** (`strategy_conversations`, `generated_strategies`, `backtest_results`, `simulation_runs`) — drop, keep as scaffold, or actively building? If "actively building", I leave them alone.
2. **Phase D normalization** — go ahead and finish in Phase 2, or revert and stay on `partial_closes` JSONB forever? My recommendation is finish.
3. **Scope of this turn** — execute Phase 1 only and report back, or chain straight through to Phase 2? Phase 1 is ~1–2 hours of mechanical cleanup with no schema changes that touch real data. Phase 2 includes a JSONB→typed backfill and a column drop, which is the riskiest single step in the whole plan.

Once approved with answers to those three, I'll execute in order and stop after Phase 1 for review before touching the data migration.
