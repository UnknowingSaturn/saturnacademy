# Full Codebase Audit — Findings & Redesign Roadmap

Four parallel deep audits ran across edge functions (~5.7K LOC), frontend (~12K LOC), Supabase schema (68 migrations), and the Tauri desktop + MQL5 EA. Below is the consolidated picture, ordered by severity, then a phased plan to fix and redesign without patch-on-patch creep.

---

## P0 — Active bugs / data-corruption / security holes

Fix these before anything else. Each is small in isolation; the damage if left is large.

| # | Where | Issue |
|---|---|---|
| 1 | `supabase` migration `20260527204815` | `trade_view` was recreated **without `WITH (security_invoker = on)`** → any authenticated user can read every user's trades via the view. RLS is bypassed. |
| 2 | `supabase/functions/copier-config/index.ts:194` | `.single()` on `copier_config_versions` crashes when the table is empty. Should be `.maybeSingle()`. |
| 3 | `mt5-bridge` Master EA + desktop `idempotency.rs:176` vs `event_processor.rs:133` | **Three incompatible idempotency-key formats** (`{terminal}:{deal}:{type}` vs 5-part vs `{terminal}:{posId}:modify:{ts}` with a timestamp suffix that makes modify replays non-idempotent). The desktop's dedup cache never matches EA-written keys. |
| 4 | `ingest-events/index.ts:751–756` (`tryRepairSiblingSnapshotClosed`) | "Repaired" action list is missing `"phase_a_one_shot"` → trades repaired by phase A can be silently re-repaired by the sibling path. |
| 5 | `ingest-events/index.ts:1007–1008` (orphan exits) | Sets `sl_initial = sl_final = exit_event.sl`, usually 0 → permanently wrong R-multiple. |
| 6 | `sync-account-state/index.ts:217–224` | `force_resync` blindly inserts a `snapshot_closed` row per poll; not idempotent → `trade_repair_events` bloats indefinitely while resync is on. |
| 7 | `repair-snapshot-closed` + sibling repair in `ingest-events` | Neither recalculates `r_multiple_actual` after writing exit data → repaired trades are permanently `null` on R. |
| 8 | `mt5-bridge` Master EA `HandlePositionModify:335` | Uses `InpBrokerUTCOffset * 3600`; when auto-detect is on (`InpBrokerUTCOffset == 0`) this becomes `0`, so modify events ship broker time as if it were UTC. |
| 9 | `mt5-bridge` Master EA `WriteOpenPositions:557–598` | Not written atomically (`.tmp` + move) → desktop reconciliation can read torn JSON. |
| 10 | `db: set_trade_number()` trigger | `MAX()+1` without a lock or `UNIQUE(user_id, trade_number)` → concurrent EA imports produce duplicate trade numbers. |
| 11 | `db: accounts.user_id` | **No index.** Every RLS subquery that ends in `accounts WHERE user_id = auth.uid()` scales linearly with the accounts table. |
| 12 | `get-shared-report/index.ts:151` | View-count read-modify-write is not atomic → undercounts under load. |
| 13 | `src/components/journal/TradeComments.tsx` & several other components | Direct `supabase.from(...).insert/update` with **no `queryClient.invalidateQueries`** → UI shows stale data after writes. |

---

## P1 — Unfinished work that misleads users or rots silently

- **EA "features" that don't exist**: `InpSyncHistory`, `InpMaxRetries`, `InpRetryDelayMs` on the Master EA are visible inputs but the functions they drive (`ProcessCloudQueue`, `SyncHistoricalDeals`) are 1-line stubs. Receiver EA's `allowed_sessions` config is parsed and `CheckSessionFilter` runs, but the desktop never writes the field → session filter is permanently inactive.
- **Desktop placeholders**: `test_copy` returns a fake success string and sends no trade; `get_diagnostics` returns hardcoded `0` for queue counters; `reconciliation::VolumeMismatch::auto_adjust_volume` logs "not yet implemented"; `add_manual_terminal` exists but `remove_manual_terminal` is not registered as a Tauri command.
- **Whole dead module**: `copier-desktop/src-tauri/src/copier/execution_queue.rs` (368 LOC) is fully implemented and **never instantiated**. So is the async path in `trade_executor.rs` (`execute_trade_async`, `execute_single_attempt`, `wait_for_response_async`).
- **`restore-trade-times` edge function** is documented for CSV imports, but CSV imports don't go through the `events` table at all → the function returns `{trades_updated: 0}` for its stated use case.
- **Edge function dead computations**: `generate-report` builds a `readQualityBlock` and never stores or sends it; computes `worstTradeNarratives` / `symbolExpectancy` / `reviewExcerpts` twice (once in main, once in `buildLlmContext`).
- **Tutorial system is half-shipped**: 9 pages got `PageIntroBanner`, but `TutorialDialog` + "How it works" exists only on Accounts/Copier; `useFirstVisit` auto-opens only on Accounts; `HintPopover` is exported and used in zero pages; Knowledge and SharedReportEditor have no onboarding at all; `Import.tsx` advertises drag-and-drop with no `onDrop` handler; `resetAllTutorials` is wired to `window` but no settings UI calls it.
- **Vestigial wrappers**: `Dashboard` and `Reports` are wrapped in `React.forwardRef<HTMLDivElement, object>` with no ref ever passed.
- **Double `toast.error` on failure** is copy-pasted across 7 mutation hooks in `useUserSettings.tsx`.

---

## P2 — Over-engineering, duplication, design drift

### Frontend
- `Playbooks.tsx` (886 LOC) owns 18 individual `useState` calls for one form, with the 80-line hydration block copy-pasted across `resetForm`, `openEditDialog`, and `handleDuplicatePlaybook`. The dialog (~450 LOC of inline JSX) belongs in its own component using `useReducer` or `react-hook-form`.
- `TradeTable.tsx` (939 LOC), `TradeDetailPanel.tsx` (593) + `TradeProperties.tsx` (548) — prop-drilling between the latter two should become a `TradeReviewContext`. `TradeTable` has a duplicate import block mid-file (line 64) — the file grew organically and needs splitting.
- `useUserSettings.tsx` (572 LOC) exports 11 hooks — split into 3 files. `useDashboardMetrics` ⊆ `useReports` (same formulas, two implementations). `usePlaybookStats` re-implements streak math from `useDashboardMetrics` and runs it client-side every 30s over all closed trades.
- Three independent copies of the color-picker palette (Playbooks, PropertyOptionsPanel, SessionConfigPanel). Two inline debounce implementations (`SharedReportEditor`, `useAutoSave`). N+1 serial-loop updates in `useReorderSessions`, `useReorderCustomFields`, `useEraseCustomFieldData`, `useUpdateCustomField`.
- Multiple components bypass their hooks and call `supabase` directly (TradeComments, DriftTray, ReportView, CitedTradeChip, EditAccountDialog, QuickConnectDialog, SessionConfigPanel) — each is a future cache-invalidation bug.

### Edge functions
- ~300 LOC of cross-function duplication crying out for `_shared/` modules: JWT auth pattern (9 copies), API-key + setup-token resolution cascade (2 ~40-line copies), install-sibling auto-create (2 ~80-line copies), `isSnapshotClosed` + repair-action constants (4 divergent copies — root cause of bug #4 above), corsHeaders (17 copies). Plus `reprocess-trades` imports `loadSessions` from `_shared/session.ts` then does the query manually anyway.
- `_shared/rMultiple.ts` falls back to "% of equity" but stores it in `r_multiple_actual` with no flag → silent unit mismatch downstream.

### Desktop / EA
- Two Tauri terminal-discovery commands (`find_terminals`, `discover_terminals`) returning different shapes for the same data. Two reconciliation-config commands. Broker detection duplicated between `detect_terminal` and `detect_portable_terminal`. Wizard ships both `SymbolMappingStep.tsx` and `SymbolMappingStepV2.tsx`. Four different AppData folder names (`SaturnTradeCopier`, `TradeCopier`, `com.saturn.tradecopier`, …) for one app's state.
- Log rotation is daily/date-based, not the 1 MB cap memory claims. EA log file has no rotation at all. No checksums on queue files (memory says there are).

### Schema
- **Account identity sprawl**: `account_number`, `terminal_id`, `mt5_install_id`, `install_id`, `broker_login` exist across `accounts`, `events`, `trades`, `terminal_accounts` with overlapping semantics. Phase D meant `(mt5_install_id, account_number)` to be canonical, but the older `terminal_id` columns were never dropped.
- **Five places store column/field config**: `property_options`, `custom_field_definitions`, `field_overrides`, `user_settings.column_overrides`, `user_settings.field_label_overrides`. These should collapse into `custom_field_definitions` + one settings JSONB.
- `accounts.balance_start` / `equity_current` drift from `account_balance_snapshots` (dual source of truth). `accounts.last_sync_at` was added and is never set. `trade_features` may be populated by no function and read by no UI. `terminal_accounts.is_currently_active` was added → dropped → re-added across 3 migrations with different index semantics each time.
- Many `user_id` columns lack FKs to `auth.users` (reports, knowledge_*, shared_reports, trade_partial_fills, trade_modifications, trade_repair_events, report_schedule_runs) → orphan rows on user deletion.
- `copier_symbol_mappings.updated_at` and `copier_receiver_settings.updated_at` have no trigger → frozen at insert time.

---

## Redesign roadmap

Rather than patch each item, do this in four passes:

### Phase 1 — Stop the bleeding (P0 only, ~1–2 days)
A single migration + targeted code edits covering items 1–13 above. No new abstractions — just fix bugs in place. Specifically:
1. Migration: re-add `WITH (security_invoker = on)` to `trade_view`; add `idx_accounts_user_id` and the other missing user_id indexes; add `UNIQUE(user_id, trade_number)` after backfilling collisions; add `auth.users` FKs; replace `set_trade_number` with a SECURITY DEFINER function using `pg_advisory_xact_lock(hashtext(user_id::text))`.
2. Edge: `.maybeSingle()` fix, `phase_a_one_shot` added to sibling-repair list, `r_multiple_actual` recomputed on every repair path, atomic `view_count` via RPC, idempotent `snapshot_closed` insert in `sync-account-state`.
3. EA: fix `HandlePositionModify` UTC math, make `WriteOpenPositions` atomic, drop the timestamp suffix from the modify idempotency key.
4. Frontend: route the 7 components bypassing hooks through their hooks (or add `invalidateQueries`).

### Phase 2 — Extract `_shared/` and one canonical idempotency key (~2–3 days)
Create `_shared/auth.ts`, `_shared/apiKey.ts`, `_shared/accountResolve.ts`, `_shared/snapshotRepair.ts` (with the canonical `REPAIR_ACTIONS` constant). Migrate `ingest-events` and `sync-account-state` to consume them; delete the divergent copies. Pick the canonical idempotency key `{terminal_id}:{deal_id}:{event_type}`; rewrite `file_watcher.rs` to read `event.idempotency_key` from the JSON instead of regenerating its own; delete `idempotency::generate_idempotency_key`'s 5-part format.

### Phase 3 — Delete the dead weight (~1 day, almost all removals)
- Delete `execution_queue.rs` and the async `trade_executor` path.
- Delete one of `find_terminals` / `discover_terminals`; delete one symbol-mapping wizard step; delete the unused `xhr` polyfill imports; delete `readQualityBlock` computation in `generate-report`; delete the duplicate `worstTradeNarratives` / `symbolExpectancy` / `reviewExcerpts` blocks in `buildLlmContext`.
- Either implement or remove EA inputs `InpSyncHistory`, `InpMaxRetries`, `InpRetryDelayMs`, the receiver `allowed_sessions` filter, the `test_copy` placeholder, the queue counters in `get_diagnostics`, the `remove_manual_terminal` UI gap, and `restore-trade-times` (fold its DST logic into `reprocess-trades` as a flag).
- Consolidate the 4 AppData folder names into one.
- Delete `HintPopover` (or actually use it); delete the `forwardRef` wrappers on Dashboard/Reports.

### Phase 4 — Targeted refactors for long-term robustness (~1 week, optional but high-leverage)
- **Frontend**: extract `<PlaybookFormDialog>` + `usePlaybookForm` reducer; introduce `TradeReviewContext` to kill the `TradeDetailPanel` → `TradeProperties` prop wall; split `useUserSettings.tsx` into 3 files; extract a shared `<ScreenshotGrid>`, `<DateRangePicker>`, `useDebounce`, `useBulkReorder`, and `colorPalette.ts`; set a global React Query `staleTime: 60_000`; collapse `useDashboardMetrics` into `useReports`.
- **Schema**: collapse `property_options` + `field_overrides` into `custom_field_definitions` (add `is_system` / `is_override` flags); drop `accounts.terminal_id` and `events.terminal_id` after confirming no readers; remove `accounts.equity_current` / `balance_start` and derive from `account_balance_snapshots` via a view; add a `playbook_questions` table so checklist answers don't orphan; replace all `trade_id IN (SELECT …)` RLS policies with one `has_trade_access(uuid)` SECURITY DEFINER helper; add `updated_at` triggers to the two copier tables; revoke default `anon` table grants and rely on explicit `authenticated` grants + RLS.
- **Contracts**: version `copier-config.json` and the `TradeEvent` queue files; have the Receiver EA refuse unknown `schema_version` rather than silently dropping unknown fields.

---

## Suggested order of work

I'd recommend approving and shipping **Phase 1** as one tight follow-up plan first — those are the bugs actively risking data or security. Phases 2–3 are almost pure deletion/extraction with low risk and very high leverage. Phase 4 is genuine redesign and should be planned in its own session with you so we agree on scope.

Each phase will be its own approved plan with concrete file diffs — this document is the map, not the implementation.
