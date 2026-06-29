# Phase U — Copier Root-Cause Remediation

Audit covered desktop agent (Rust/Tauri), MQL5 master/receiver EAs, web UI, edge functions, lot math, symbol mapping, and types. Findings below are cited with file:line; fixes are surgical and address root causes without expanding scope.

## Critical (must-fix, blockers / silent financial loss)

**U-1. Implement missing `wait_for_response_sync`** — `copier-desktop/src-tauri/src/copier/trade_executor.rs:186` calls a symbol that does not exist. Add it: poll `resp_{timestamp}.json` in command folder, 100ms interval, 5s timeout, parse into `TradeResponse`. Without this every desktop-initiated trade silently fails or the binary won't link.

**U-2. Stop session filter from blocking exit events** — `mt5-bridge/TradeCopierReceiver.mq5` `CheckSessionFilter()` gates ALL events including exits. If a session boundary falls mid-trade the receiver stays open while master closes. Change `ProcessPendingEvents()` to bypass the session check for `event_type ∈ {exit, partial_close, modify}`; only `entry` is gated.

**U-3. Fix idempotency key collision across master terminals** — `mt5-bridge/TradeCopierMaster.mq5:82` truncates server name to 10 chars and combines with account login. Two brokers sharing a 10-char prefix + same login collide. Replace truncation with a short hash of the full `AccountInfoString(ACCOUNT_SERVER)`. Mirror the change in `copier-desktop/src-tauri/src/copier/idempotency.rs::build_canonical_key` validation.

**U-4. Close safety daily-loss race** — `copier-desktop/src-tauri/src/copier/safety.rs:346-354` does `check_daily_reset` then `get_receiver_state` in separate locks. Merge into one critical section in a new `check_and_reserve` helper that returns the decision atomically.

## High (correctness & security)

**U-5. Remove wall-clock from modify idempotency key** — `mt5-bridge/TradeCopierMaster.mq5:384` includes `TimeCurrent()`. Use `{terminal_id}:{position_id}:modify:{sl_hash}_{tp_hash}` so identical SL/TP retries dedupe but real changes don't.

**U-6. Guard lot calc against default tick_value** — `copier-desktop/src-tauri/src/copier/lot_calculator.rs` Forex branch silently uses `SymbolInfo::default().tick_value = 10.0` when catalog is missing, miscalculating crosses by 30-40%. When catalog returns defaults, return an error from `calculate_lots` for `risk_dollar`/`risk_percent`/`intent` modes and fall back to `mirror` with a warning event written to executions log.

**U-7. Fix `agent-commands` PATCH scope** — `supabase/functions/agent-commands/index.ts:75` filters by `user_id` only; add `.eq("install_id", body.install_id)` so a stolen API key on one install can't ack other installs' commands. Require `install_id` in the PATCH body.

**U-8. Tighten `copier-executions` ingest** — `supabase/functions/copier-executions/index.ts`: (a) reject rows where `receiver_account_id` resolves to null (currently inserted with `unknown:...` key, collision-prone); (b) trim `SELECT *` on accounts to only `id, account_number, user_id`; (c) drop the `?api_key=` query-string fallback (also in `copier-config/index.ts:59`) — header only.

**U-9. Fix receiver multi-config parsing** — `mt5-bridge/TradeCopierReceiver.mq5:786-805` `ParseConfigJson` always picks the first `receiver_id` in the array. Walk the `receivers[]` array object-by-object, matching `receiver_id` against `AccountInfoInteger(ACCOUNT_LOGIN)` or `InpReceiverId`.

**U-10. Robust partial-close JSON read** — `mt5-bridge/TradeCopierReceiver.mq5:1364`: move `closed_volume`/`remaining_volume` to the top level of the master event JSON (`TradeCopierMaster.mq5:594`) instead of nesting under `partial_close_data`. Single-file change in both EAs; eliminates fragile flat-key search collisions.

## Medium (perf, correctness, drift)

**U-11. Cache symbol catalog reads** — `copier-desktop/src-tauri/src/copier/event_processor.rs:18` calls `fetch_symbol_catalog` per event. Wrap in `LazyLock<parking_lot::Mutex<HashMap<String, (SymbolCatalog, Instant)>>>` with 60s TTL keyed by `terminal_id`.

**U-12. Use cached terminal discovery** — `copier-desktop/src-tauri/src/mt5/bridge.rs:12` `find_mt5_terminals` calls `discover_all_terminals()` (uncached) on every command tick. Switch to `discover_all_terminals_cached(false)`.

**U-13. Reliable receiver position lookup** — `mt5-bridge/TradeCopierReceiver.mq5:1226` `Sleep(50)` + single lookup is fragile; falls back to storing `result.order` (wrong ticket). Retry lookup 5× with 100ms gaps; if still missing, log explicit error and skip storing the misleading ticket.

**U-14. Verify `config_hash`** — `supabase/functions/copier-config/index.ts:229` emits a SHA-256 the desktop ignores. Add `config_hash: Option<String>` to the Rust `CopierConfig`, recompute over the canonical body, abort load on mismatch.

**U-15. Pagination & true count for ExecutionHistory** — `src/components/copier/ExecutionHistory.tsx:296` heuristic `executions.length < pageSize` shows phantom Next. Switch query to `.select('*', { count: 'exact' })`, expose `total`, drive button state from it. Mirror fix in `useCopierStats` (`src/hooks/useCopier.tsx:320`) by replacing the 1000-row fetch with an RPC aggregate (success rate, avg slippage) so stats stop silently truncating.

**U-16. UTC day boundary in stats** — `src/hooks/useCopier.tsx:335` `setHours(0,0,0,0)` is local. Use `Date.UTC(...)` so "today" matches stored UTC `executed_at`.

**U-17. Realtime channel filter** — `src/hooks/useCopier.tsx:254` realtime sub only filters by `user_id`. When the hook has a `receiverAccountId`, append `,receiver_account_id=eq.${id}` to the postgres_changes filter to cut refetch storms.

**U-18. `.maybeSingle()` for master lookup** — `supabase/functions/copier-config/index.ts:71` uses `.single()` which 500s on missing/duplicate keys. Replace with `.maybeSingle()` plus explicit duplicate-key branch.

**U-19. Replace `std::sync::Mutex` with `parking_lot`** — `copier-desktop/src-tauri/src/mt5/discovery.rs:178` uses `std::sync::Mutex` + `.unwrap()`; rest of the codebase uses `parking_lot`. Swap for consistency and to drop poisoning panics.

## Low (cleanup, observability)

**U-20. Delete dead `bridge::detect_terminal`** — `copier-desktop/src-tauri/src/mt5/bridge.rs:18-97` is `#[allow(dead_code)]`; superseded by `discovery` module. Remove the 80-line shadow function and the `#[allow]`. Audit `sync/config.rs` and `copier/commands.rs` file-level `#![allow(dead_code)]` — if truly unused, delete; otherwise wire up and remove the suppression.

**U-21. Master EA log rotation** — `mt5-bridge/TradeCopierMaster.mq5:117` appends forever. In `OnTimer()` (already runs), check `FileSize`; if >5MB, close, rename to `.log.1`, reopen fresh. Same change in Receiver EA's log path.

**U-22. Dedupe `useCopierExecutions` / `useCopierExecutionsRealtime`** — `src/hooks/useCopier.tsx:191` and `:239` are copy-pasted query bodies. Extract `buildExecutionsQuery(supabase, filters)` and let the realtime variant compose it + add the channel effect.

## Out of scope (deliberately deferred)

- E-4 (linear `g_processedDeals` search) — 100k comparisons/session is well within MQL5 budget; cost > benefit until a profile shows it.
- R-3 (processed-key flush crash window) — current `fs::rename` atomicity is sufficient on supported OSes; uncertain finding, no evidence of real loss.
- M-2 (stale `master_balance` in queued events) — needs product decision on staleness threshold; ask before adding.
- D-2 (`public/*.mq5` drift) — not byte-verified; `scripts/sync-mql5.mjs --check` is the correct guardrail and already exists.

## Technical execution order

1. U-1, U-2, U-3, U-4 (critical) — independent files, parallel edits.
2. U-5..U-10 (high) — EA changes (U-5, U-9, U-10) batched into one MQL5 sync run via `scripts/sync-mql5.mjs`.
3. U-11..U-19 (medium) — desktop + edge + web.
4. U-20..U-22 (cleanup) — last, since they touch surfaces other fixes also modify.

After each group: `bunx tsgo --noEmit` for TS, `cargo check` for Rust (desktop), and `bun run mql5:sync --check` to confirm MQL5 distribution parity.