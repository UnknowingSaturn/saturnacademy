
# Trade Copier — Verification + Discovery Overhaul

## Audit of prior phases (status)

| Item | Status | Evidence |
|---|---|---|
| 1.1 Receiver handles `execute` cmds + writes `resp_*.json` | ✅ Done | `TradeCopierReceiver.mq5` L430–434, `ProcessExecuteCommand` L538+ |
| 1.2 Use `DEAL_POSITION_ID` not `result.order` | ✅ Done | Receiver `ExecuteEntry` resolves via `HistoryDealGetInteger` |
| 1.3 EA stops recalculating risk; uses `calculated_lots` | ✅ Done | desktop `trade_executor.rs` L117 |
| 1.4 Canonical idempotency key everywhere | ✅ Done | Master EA + desktop |
| 1.5 Auto UTC offset in both EAs | ✅ Done | `RefreshUtcOffset` in both |
| 2.2 Per-receiver dynamic magic | ✅ Done | `ComputeCopierMagic` FNV-1a |
| 2.3 Slippage normalization | ✅ Done |
| 2.4 Daily P&L scoped to copier magic | ✅ Done |
| 2.7 Atomic heartbeat write | ✅ Done |
| 2.8 Per-receiver config parser | ✅ Done |
| 3.2 `copier-config` returns 200/empty when no master | ✅ Done |
| 3.4 `failedToday` filtered to today | ✅ Done |
| 3.3 server: `copier-executions` edge function | ✅ Done (last turn) |
| **3.3 client: actually call upload + process_queue** | ✅ Done |
| **MT5 discovery — UI sometimes finds nothing** | ✅ Done (unified + sysinfo + debug surface) |

The two remaining gaps are what this plan finishes.

---

## Problem 1 — MT5 terminal discovery is unreliable

There are two parallel discovery modules in `copier-desktop/src-tauri/src/mt5/`:

- `discovery.rs` (modern, used by UI/Tauri commands): registry + WMIC + AppData + `LOCALAPPDATA\Programs` + manual paths, cached, returns `TerminalInfo` with hash-based `terminal_id`.
- `bridge.rs::find_mt5_terminals` (legacy, used by `trade_executor`, `event_processor`, `file_watcher`, `position_sync`, `symbol_catalog`): scans only `%APPDATA%\MetaQuotes\Terminal` + a hard-coded list of Program Files / drive roots. Returns `Mt5Terminal` with `portable_<folder_name>` id.

Concrete failure modes this causes:

1. Installs only present in **registry** or `LOCALAPPDATA\Programs` (Windows 11 default location for many broker installers) are invisible to bridge → file_watcher never starts watching, event_processor never resolves accounts.
2. UI saves `accounts.terminal_id` from `discovery` (hash id). `trade_executor::find_terminal_path` later calls `bridge::find_mt5_terminals` and fails to match → "Terminal not found" silently aborts every trade.
3. `event_processor`'s 30s `TerminalCache` wraps `bridge` only, so `get_cached_account_info` returns `None` and lot-size calc falls back to `10000.0` baseline.
4. WMIC is gone from Windows 11 23H2+ default → `is_running` always false; discovery still works because of registry + AppData walk, but live status never flips on.
5. `find_terminal_path` doesn't know how to resolve a `discovery`-style hash id at all unless it happens to live under `%APPDATA%\MetaQuotes\Terminal\<id>`.

### Fix — collapse to one source of truth

1. **Make `discovery::discover_all_terminals` the only discovery API.** Convert `bridge::find_mt5_terminals` into a thin wrapper:
   ```text
   discovery::discover_all_terminals()
       .into_iter()
       .map(Mt5Terminal::from)   // adapter preserves shape for old callers
       .collect()
   ```
   This is non-breaking: same return type, same fields, but now the callers (`trade_executor`, `event_processor`, `file_watcher`, `position_sync`, `symbol_catalog`) inherit registry + LocalAppData + manual paths automatically.

2. **Single, robust `find_terminal_path`** in `bridge.rs`:
   - Look up by `terminal_id` against the cached discovery list first → return its `data_folder`.
   - If `terminal_id` starts with `portable_` and not found → fall back to scanning manual paths.
   - Only as last resort, try `%APPDATA%\MetaQuotes\Terminal\<id>` literal.
   - Return a structured error including which id was searched and how many terminals were known.

3. **Replace WMIC** with PowerShell `Get-CimInstance Win32_Process` (works on Windows 11) or, even better, the `sysinfo` crate (already a common Tauri dep — verify in `Cargo.toml`; if not present, add it). This restores `is_running` for the diagnostics tab and the wizard.

4. **`event_processor::TerminalCache`** keeps its own 30s cache but now wraps `discovery::discover_all_terminals_cached(false)` so it benefits from the same 10s discovery cache rather than re-walking the FS.

5. **Diagnostic surface:** add a Tauri command `get_discovery_debug()` returning `{registry: N, appdata: N, common_paths: N, manual: N, running: N, total: N}` so the user (and we) can immediately see which strategy succeeded. Wire to a small section in the existing `Diagnostics` tab.

6. **Manual-path UX safety net:** the wizard already has "Add terminal manually". Verify it: when the user picks a folder, we should accept it if it contains either `terminal64.exe` (install root) **or** `MQL5\\Files` (data root) — current code only accepts the install-root case.

### Files to touch

- `copier-desktop/src-tauri/src/mt5/bridge.rs` — gut `find_mt5_terminals`, rewrite `find_terminal_path`, add `From<TerminalInfo> for Mt5Terminal` adapter.
- `copier-desktop/src-tauri/src/mt5/discovery.rs` — replace WMIC with sysinfo (or PS fallback); broaden manual-path acceptance.
- `copier-desktop/src-tauri/src/copier/event_processor.rs` — point `TerminalCache` at discovery.
- `copier-desktop/src-tauri/src/main.rs` — register `get_discovery_debug` command.
- `copier-desktop/src/components/copier/Diagnostics.tsx` (or equivalent) — render the debug counts.

---

## Problem 2 — Phase 3.3 client side is still dead

Server endpoint exists now, but the desktop never calls it, so the web Activity tab will stay empty.

### Fix

1. In `event_processor::process_event`, after the success/error branch, call `sync::executions::queue_for_upload(&final_execution)` (best-effort; log on err).
2. In `main.rs` startup, spawn a tokio task:
   ```text
   loop {
       tokio::time::sleep(Duration::from_secs(30)).await;
       if let Some(api_key) = state.lock().api_key.clone() {
           let _ = sync::executions::process_queue(&api_key).await;
       }
   }
   ```
3. Remove `#[allow(dead_code)]` from `sync/executions.rs` items now that they're used.
4. Extend the `Execution` struct with optional `master_position_id`, `receiver_position_id`, `idempotency_key`, `master_account_number` so the edge function can dedupe and link rows correctly. Populate these in `event_processor` from the `TradeEvent` and the `TradeResponse`.

### Files to touch

- `copier-desktop/src-tauri/src/copier/mod.rs` — extend `Execution`.
- `copier-desktop/src-tauri/src/copier/event_processor.rs` — populate new fields, call `queue_for_upload`.
- `copier-desktop/src-tauri/src/sync/executions.rs` — drop dead-code allows.
- `copier-desktop/src-tauri/src/main.rs` — spawn periodic flush task.

---

## Out of scope for this batch

These remain queued from `.lovable/plan.md`, untouched here:

- 2.1 per-receiver queue routing
- 2.5 symbol catalog auto-mapping
- 2.6 reconciliation through trade_executor
- 2.9 drop sync executor / per-receiver tokio tasks
- 3.1 web manual-setup mode
- Phase 4 polish

---

## Risks / things to watch after this lands

- The discovery unification means callers that relied on the bridge's `Mt5Terminal.path` being the **install dir** will now get the **data folder** for AppData installs. The adapter must preserve "path = data folder when MQL5 is in data folder, else install dir" so command/event/queue file paths still resolve. I'll keep the existing behavior by selecting whichever of `data_folder` or install_dir contains `MQL5\\Files`.
- `sysinfo` adds ~200KB to the binary; acceptable.
- The first execution-upload run after release will flush whatever's in the local queue dir. That could be hundreds of stale entries from previous broken runs — wrap the first flush in a "max 200" cap so we don't hammer the edge function.

