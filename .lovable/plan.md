# Codebase Audit — Findings & Remediation Plan

Four parallel deep audits ran across **DB/RLS**, **edge functions**, **React frontend**, and **copier desktop + MQL5 EAs**. Below is the consolidated picture, tiered from "fix today, zero risk" to "structural redesigns worth doing properly".

---

## ✅ P0 BATCH — SHIPPED (2026-05-28)

Migration `20260528_p0_security_and_correctness` applied:
- All ~14 tables with PUBLIC-default policies rewritten with `TO authenticated`
- `trade_reviews` + `trade_features` policies switched to `has_trade_access()` helper
- Hot-path indexes added on `trades`, `events`, `shared_reports`, `shared_report_trades`, `copier_executions`
- Orphaned `copier_config_versions` table dropped (hooks + edge function updated; version now derived from `receiver_settings.updated_at`)
- Unused `ai_provider` enum dropped
- `trade_repair_events.action` got CHECK constraint
- All `NOT VALID` FKs validated
- New `apply_equity_delta(account_id, delta)` SECURITY DEFINER RPC for atomic equity updates

Code fixes:
- `copier-desktop/src-tauri/resources/TradeCopierMaster.mq5` — idempotency separator standardized to `:` (3 sites)
- `supabase/functions/ingest-events` — `.single()` → `.maybeSingle()` on dedup check; equity update switched to atomic `apply_equity_delta` RPC
- `supabase/functions/repair-snapshot-closed` — now computes `r_multiple_actual` (price-based, matches inline ingest-events behaviour)
- `supabase/config.toml` — added entries for `reclassify-sessions` and `trades-drift`

Deferred to R1: dual cloud upload path in the bundled Master EA (intentional combined copier+bridge mode; server-side idempotency dedupes it).

---

## ✅ P1 BATCH — SHIPPED (2026-05-28)

Backend:
- pg_cron job `prune-monitoring-snapshots` runs daily at 03:00 UTC — 90-day retention on `terminal_snapshots` and `account_balance_snapshots`
- COMMENT ON TABLE added to all intentionally append-only tables (`events`, `terminal_snapshots`, `account_balance_snapshots`, `trade_repair_events`)

Edge functions:
- Dropped the XHR polyfill from `copier-config` and `copier-executions` (Deno has native fetch)
- 12 edge functions now `import { corsHeaders } from "../_shared/cors.ts"` instead of redeclaring (also closes the missing-`x-api-key` gap in 3 of them)
- `copier-config` config hash is now SHA-256 (was a 32-bit shift-hash with collisions)
- `copier-config` config version is now derived from `receiver_settings.updated_at`

Frontend:
- `useUserSettings.tsx` — collapsed all duplicate `toast.error` calls in mutation error handlers (was firing twice per failure)
- `src/types/settings.ts` — stale `property_options` comments rewritten to reference `custom_field_definitions`

Deferred (low-risk file-org refactors with wide call-site impact — skipped to avoid touching many components):
- Folding `useFieldOverrides.tsx` into `useCustomFields.tsx` (hooks already work against the unified table; this is purely cosmetic)
- Extracting `computeBaseMetrics` to `src/lib/tradeMath.ts`
- Merging `symbolAliases.ts` + `symbolMapping.ts`
- Moving `LiveTradesProvider` inside the `/live-trades` route
- Deleting `@deprecated` broker-time helpers
- Desktop Rust cleanups (12 unused Tauri commands, AppData folder consolidation) — defer to R7/R8

---

## ✅ R7 PARTIAL — SHIPPED (2026-05-28) — Copier cache & path collapse

- 3 duplicate `find_terminal_files_path` / `get_terminal_files_path` implementations in `position_sync.rs`, `symbol_catalog.rs`, and `config_generator.rs` collapsed to thin wrappers around a new `mt5::bridge::resolve_files_path(terminal_id, create_if_missing)`.
- `mt5::bridge::find_terminal_path` made `pub` and switched to `discover_all_terminals_cached` instead of the uncached `discover_all_terminals`.
- Redundant 30s `TERMINAL_CACHE` layer in `event_processor.rs` deleted — `get_cached_terminals()` now goes straight to the single 10s `DISCOVERY_CACHE`, eliminating the double-staleness window.

## ⏸ R1 — SKIPPED per user
Bundled `resources/` EAs intentionally fused with bridge + cloud logic; collapsing to `mt5-bridge/` would regress live receivers. Revisit only with a feature-by-feature merge plan.

---





### Security: RLS role qualifier missing on ~14 tables
Many policies were created without `TO authenticated`, so they default to `PUBLIC` (anon **and** authenticated). Affected: `copier_executions`, `copier_config_versions`, `copier_symbol_mappings`, `copier_receiver_settings`, `notebook_entries`, `session_definitions`, `user_settings`, `playbooks`, `trade_comments`, `setup_tokens`, `trade_reviews`, `trade_features`. One migration, pure policy rewrite, no data change.

### Correctness: idempotency key separator mismatch in the installed Master EA
`copier-desktop/src-tauri/resources/TradeCopierMaster.mq5` (the file actually shipped in the installer) uses **underscore** separators (`term_deal_evtType`) while every other layer — `mt5-bridge/`, `public/`, Rust `idempotency.rs`, fallback construction in `event_processor.rs` / `file_watcher.rs` — uses **colon**. Result: the FIFO dedup cache never matches, and duplicates can slip through. Standardize on `{terminal_id}:{deal_id}:{event_type}`.

### Correctness: `repair-snapshot-closed` never recomputes `r_multiple_actual`
The manual repair sweep writes `exit_price`, `exit_time`, `net_pnl` but leaves `r_multiple_actual = NULL`. Inline repair in `ingest-events` does compute it. Trades repaired manually are permanently R-less.

### Correctness: `ingest-events` idempotency check uses `.single()`
`.single()` raises PGRST116 on zero rows. The catch block at line 596 silently turns this into a 500 the EA retries — masking that *every brand-new event* hits the error path. Replace with `.maybeSingle()`.

### Correctness: `equity_current` race on concurrent closes
`ingest-events` reads → computes → writes `accounts.equity_current` from JS. Two concurrent closes drop one update. Either use an atomic `equity_current = equity_current + $delta` RPC, or stop maintaining it on close events (heartbeats already overwrite it).

### Correctness: dual cloud upload from `resources/` Master EA
`resources/TradeCopierMaster.mq5` embeds 163 lines of `BuildCloudPayload`/`SendToCloud` that POST to the same `ingest-events` endpoint the desktop already uploads to via `sync/executions.rs`. Trades from a `resources/`-installed setup can double-write to the cloud. Pick one path and delete the other.

### Drift: 3 divergent copies of the EAs
| File | resources/ | mt5-bridge/ | public/ |
|---|---|---|---|
| Master | 1113 lines | 888 | 888 (identical to mt5-bridge) |
| Receiver | 3038 lines | 2400 | 2125 |

No declared source of truth. `mt5-bridge/` has the README; `resources/` is what ships. Developers naturally edit the wrong file.

### Missing config.toml entries
`reclassify-sessions` and `trades-drift` have no entries in `supabase/config.toml`. Add `verify_jwt = false` blocks.

---

## P1 — High-leverage cleanup (1-2 days, zero or low risk)

### Edge functions
1. **Validate all `NOT VALID` FKs** added in the Phase 1 migration (`accounts.master_account_id`, `reports.*`, `report_schedule_runs.*`, `knowledge_*`, `shared_reports.user_id`, `trade_partial_fills.user_id`, `trade_modifications.user_id`, `trade_repair_events.user_id`). Run `ALTER TABLE … VALIDATE CONSTRAINT …` per table.
2. **`trade_reviews` + `trade_features` RLS** still use a `trade_id IN (SELECT … FROM trades WHERE user_id = auth.uid())` subquery. The `has_trade_access(uuid)` SECURITY DEFINER helper was created for this — switch the policies over.
3. **Hot-path indexes**: `(account_id, event_timestamp DESC)` on `events`; `(account_id, entry_time DESC)` on `trades`; `(visibility, published_at)` on `shared_reports`; `(shared_report_id, sort_order)` on `shared_report_trades`; `(receiver_account_id, executed_at DESC)` on `copier_executions`.
4. **Drop `copier_config_versions`** — orphaned write-only table; the EA already polls `copier_receiver_settings.updated_at` for config change detection.
5. **Drop `ai_provider` enum** — owning tables were already dropped.
6. **Add `CHECK (action IN (…))` to `trade_repair_events.action`** so freeform values can't sneak in.
7. **Retention policy** for `terminal_snapshots` and `account_balance_snapshots` (pg_cron `DELETE` older than 90d). Both grow unboundedly today.
8. **Drop XHR polyfill** imports from `copier-config` and `copier-executions` (line 1 of each). Pure cold-start tax.
9. **Replace homebrew config hash in `copier-config`** with SHA-256. Current 32-bit shift-hash has nasty collisions, so config edits can be silently ignored by the EA.
10. **De-duplicate `corsHeaders`**: 5 functions redeclare it locally (3 of them missing `x-api-key`). Switch to `import { corsHeaders } from "../_shared/cors.ts"`.
11. **`reprocess-trades` / `reclassify-sessions`** should use `_shared/session.ts:loadSessions()` instead of inlining the query.

### Frontend
12. **Delete `useFieldOverrides.tsx`** and fold its 3 mutations into `useCustomFields.tsx`. Collapse `usePropertyOptions` (inside `useUserSettings.tsx`) into the same hook. All three hit `custom_field_definitions` with only the `scope` differing — currently they fire 3 parallel queries and don't bust each other's cache.
13. **Extract `computeBaseMetrics(trades)`** to `src/lib/tradeMath.ts`. The win-rate / profit-factor / avgR formula is copy-pasted across `useReports`, `useDashboardMetrics`, `usePlaybookStats`, and `JournalCalendarView`. Same for `computeLotSize` (duplicated in two trade dialogs).
14. **Merge `src/lib/symbolAliases.ts` + `src/lib/symbolMapping.ts`** — both normalize broker symbols with subtly different rules (`.cash` suffix handled in one, not the other).
15. **Delete `@deprecated` broker-time helpers** in `src/lib/time.ts` after fixing the single live caller in `useOpenTrades.tsx:78`.
16. **Move `LiveTradesProvider` inside the `/live-trades` page** instead of wrapping the whole app at root.
17. **Fix double-toast on every settings mutation error** (`useUserSettings.tsx` — both `toast.error('Failed to save settings')` and the specific error are fired).
18. **Update stale `property_options` comments** in `src/types/settings.ts` (lines 71, 72, 75, 84, 253).

### Copier desktop
19. **Wire the Configuration tab's Save button** to `save_copier_config` (currently a `console.log` TODO). Or remove the tab.
20. **Consolidate AppData folder names** — `SaturnTradeCopier` (safety/idempotency) vs `TradeCopier` (reconciliation) vs `com.saturn.tradecopier` (sync). Pick one. State currently scatters across 3-4 OS paths.
21. **Delete 12 Tauri commands that no UI calls**: `find_terminals`, `get_copier_status`, `get_recent_executions`, `get_terminal_account_info`, `get_master_symbols`, `get_position_sync_status`, `get_master_heartbeat`, `check_master_online`, `set_reconciliation_config`, `get_recon_status`, `run_reconciliation_now`, `get_discovery_debug`.
22. **Remove `test_copy` placeholder** (`main.rs:424`) or implement it.

---

## P2 — Structural redesigns (worth proper planning)

These are the changes that make the app durable rather than patched.

### R1. Single source of truth for the EAs + build step
Delete `public/*.mq5` (byte-for-byte identical to `mt5-bridge/`; web download link can point to a generated artifact). Make `mt5-bridge/` canonical. Add a `beforeBuildCommand` in `tauri.conf.json` that copies `mt5-bridge/Trade*.mq5` into `copier-desktop/src-tauri/resources/`. Eliminates the hand-divergence that produced the idempotency bug.

### R2. Consolidate the 7 "trade-side-effect" edge functions
The boundary between `ingest-events`, `sync-account-state`, `reprocess-trades`, `restore-trade-times`, `repair-snapshot-closed`, `trades-drift`, `reclassify-sessions` is murky and many of them duplicate each other.

```text
Current (7 functions):                          Proposed (3 functions):

ingest-events ───────────┐                      ingest-events  (write-only hot path)
sync-account-state ──────┤  account+repair      reconcile      (combines sync-state +
repair-snapshot-closed ──┘  logic duplicated    │                repair-snapshot + drift)
                                                trade-rebuild  (combines reprocess +
reprocess-trades ────────┐  derived-field        reclassify-sessions + restore-times
reclassify-sessions ─────┤  recomputation        as a mode= param)
restore-trade-times ─────┤
trades-drift ────────────┘  read-only view  →   drop, replace with Postgres view
```

Extract a shared `_shared/accountResolution.ts` for the 3-step (account_number / install_id / api_key) resolution cascade duplicated in `ingest-events` and `sync-account-state`. Extract `_shared/pnl.ts` for the `gross - commission - abs(swap)` formula copy-pasted in 4 places. Add `insertRepairEvent()` helper for the 5 sites that hand-construct the same object.

### R3. Split `ingest-events` into a thin hot path + async processor
At 1130 lines it does account resolution, balance snapshot, DST detection, event insert, trade upsert, sibling repair, R-multiple compute, terminal binding — all synchronously in the EA's request loop. EA only needs ack. Move everything after the `events` insert into a Postgres trigger or a background `process-event` function so the hot path stays sub-100ms and repair work can't time out mid-flight.

### R4. Collapse `trade_reviews.journal_conversation` JSONB → `trade_journal_messages` table
Unbounded JSONB blob (turn-per-turn appends) becomes a 50-200KB array per trade. Can't paginate or stream. New table `(id, trade_review_id FK, role, content, created_at)` with backfill via `jsonb_array_elements`.

### R5. Reconcile session_type enum vs session_definitions table
`trades.session` uses the enum; `session_definitions` lets users create custom sessions that the column can't store. Change `trades.session` to `text` (with CHECK if desired), derive display from `session_definitions`, drop the enum.

### R6. Migrate `user_settings.live_trade_questions` → `custom_field_definitions` with `scope='live_question'`
Completes the schema-collapse you started. Removes the second place where question schema is defined and aligns with the `emotional_state` enum.

### R7. Collapse copier terminal-discovery and path-resolution
Three layered caches (`discovery::DISCOVERY_CACHE` 10s → `event_processor::TERMINAL_CACHE` 30s → ad-hoc per-call scans in `position_sync` / `symbol_catalog` / `commands` / `bridge`). Same for path resolution — 5 independent `find_terminal_files_path` copies with subtly different fallback orders. Collapse to one cache (`discovery::discover_all_terminals_cached`) and one helper (`mt5::bridge::resolve_files_path`).

### R8. Delete or finish `reconciliation.rs`
Three auto-action flags default to false, `VolumeMismatch` is "not yet implemented", zero UI calls `run_reconciliation_now`, and the background thread polls every 100ms regardless of the enabled flag. Either wire it up or remove ~450 lines + 11 Tauri commands.

### R9. Centralize lot-size + safety clamping
Desktop `lot_calculator` hardcodes `min_lot=0.01, lot_step=0.01` and never reads broker constraints; the EA silently clamps to real `SymbolInfoDouble` values. `apply_max_lot_limit` / `apply_min_lot_limit` are exported but never called. Either fetch broker specs into the desktop calc or move all clamping to the EA and have the desktop send the intended lot. Also: `max_daily_loss_r.map(|r| r * 1.0)` is a no-op masquerading as an R→% conversion.

### R10. Replace `terminal_accounts` with a view over `terminal_snapshots`
`accounts.mt5_install_id` + `terminal_snapshots` already carry the binding. `terminal_accounts.is_currently_active` is derivable via `DISTINCT ON (terminal_id, install_id) … ORDER BY last_active_at DESC`. Drop the table, keep a view if needed.

### R11. Reduce enum sprawl
Drop `ai_provider`. Merge `accounts.ea_type` and `accounts.copier_role` (identical semantics). Convert `prop_firm` to a `prop_firms` lookup table so new firms don't need DDL.

---

## Suggested execution order

1. **Today (P0 batch)**: RLS role-qualifier migration; idempotency separator fix in `resources/`; `repair-snapshot-closed` R-multiple fix; `.maybeSingle()` fix; `config.toml` entries for the 2 missing functions.
2. **This week (P1 batch)**: All P1 items — they're small, independent, low risk, and pay back instantly in correctness, perf, and ~600 lines deleted.
3. **Next iteration**: R1 (EA build step) + R7 (copier cache collapse) — biggest wins for desktop reliability.
4. **Next major refactor window**: R2 (edge function consolidation) + R3 (split ingest-events) — biggest wins for backend reliability.
5. **Schema modernization sprint**: R4, R5, R6, R10, R11 batched together to amortize migration risk.

After approval I can implement these in tranches starting with the P0/P1 batches.
