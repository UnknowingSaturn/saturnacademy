
# Trade Copier — Full Audit & Rebuild Plan

After reading the Master EA, Receiver EA, the entire `copier-desktop/src-tauri` Rust code, the web surface, and `copier-config` edge function, I found that the system has **three independent pipelines that don't fit together**. Many "bugs" you've been hitting are not isolated — they're symptoms of architectural drift between the desktop app, the EAs, and the schema/memory rules. I'm proposing a phased fix.

This plan is grouped by severity. Phase 1 must land or nothing copies reliably. Phases 2–4 are stabilization and polish.

---

## Phase 1 — Make trades actually copy (CRITICAL)

These are blocker-class bugs. Until fixed, the copier cannot work end-to-end.

### 1.1 Pipeline mismatch: desktop writes commands the receiver EA ignores

The desktop's `trade_executor::execute_trade` writes `cmd_<timestamp>.json` files into each receiver's `MQL5/Files/CopierCommands/` folder with `action` = `"entry" | "exit" | "modify" | "partial_close"`. It then polls for a `resp_<timestamp>.json` file for up to 15 seconds.

The Receiver EA's `CheckEmergencyCommands` / `ProcessEmergencyCommand` (TradeCopierReceiver.mq5 ~L315–419) only handles `command_type = "close_all" | "pause_copying" | "resume_copying" | "open" | "close"`. Command files with `action = "entry"` etc. fall through every `if/else if`, then get **deleted unread** at the end of the function. **No response file is ever written.** Every desktop-driven trade times out.

Meanwhile the Receiver EA tries to read events directly from `InpQueuePath = "CopierQueue"` (its OWN `MQL5/Files/CopierQueue/pending/`) — but the Master EA writes to its own terminal's queue, not the receiver's. So in a typical two-terminal setup the receiver EA's pending folder is empty too.

**Fix — pick ONE pipeline and commit to it. Recommended (matches the existing memory rule "lot calc lives in desktop"):**

- Desktop app is the authoritative router. Master EA only writes events; Receiver EA only executes commands from the desktop.
- Add a new command schema: `{ "command_type": "execute", "action": "entry|exit|modify|partial_close", "symbol", "direction", "lots", "sl", "tp", "max_slippage_pips", "master_position_id", "request_id" }`.
- Receiver EA: extend `ProcessEmergencyCommand` with branches for `execute` that call `ExecuteEntry/ExecuteExit/ExecutePartialClose/ExecuteModify` and **write a `resp_<request_id>.json`** with `{ success, executed_price, slippage_pips, receiver_position_id, error }` before deleting the cmd file.
- Desktop `trade_executor` continues to use `cmd_*.json` filenames keyed by `request_id` (not raw timestamp — collisions are possible at ms resolution under load).
- Remove the receiver EA's direct `ProcessPendingEvents` reading from its own queue, OR keep it only as a same-machine fallback when desktop is offline (clearly flagged).

### 1.2 Position-id vs order-id mix-up on the receiver

`TradeCopierReceiver.mq5 ExecuteEntry` (~L978) stores `receiverPosId = (long)result.order`. That's the **order** ticket, not the **position** ticket. On exit/modify it does `PositionSelectByTicket((ulong)receiverPosId)`, which requires the position ticket. They are sometimes equal on initial market fills, but diverge after partial closes, requotes, or if `result.deal` differs.

**Fix:**
- After successful `OrderSend`, look up the resulting position via `HistoryDealSelect(result.deal)` then `HistoryDealGetInteger(result.deal, DEAL_POSITION_ID)` and store THAT as `receiver_position_id`.
- Apply the same change wherever `result.order` is being treated as a position id.

### 1.3 Receiver EA recalculates risk — contradicts the architecture rule

Memory rule: *"Risk lot size calculation is centralized in desktop app; MQL5 EA only clamps."* Currently `TradeCopierReceiver.CalculateLotSize` (~L1687) re-implements `balance_multiplier`, `risk_percent`, `risk_dollar`, `intent`. Two implementations drift; behavior depends on which path you go through.

**Fix:** Receiver EA's `CalculateLotSize` collapses to:
1. Take `calculated_lots` from the command payload (desktop already computed it).
2. Clamp to `[SYMBOL_VOLUME_MIN, SYMBOL_VOLUME_MAX]` and round to `SYMBOL_VOLUME_STEP`.
3. Log if clamping changed the value materially (>5% diff) so the desktop can warn the user.

Delete the duplicated risk-mode branches in MQL.

### 1.4 Idempotency key inconsistency across all three layers

Three different formats are in use today:

- Master EA writes `idempotency_key = g_terminalId + "_" + dealTicket + "_" + eventType`
- Desktop generates `format!("{}:{}:{}:{}:{}", event_type, ticket, deal_id, symbol, timestamp)`
- Memory says canonical is `{terminal_id}:{deal_id}:{event_type}`

This means the desktop's idempotency cache cannot dedupe master-supplied keys, and vice-versa. Re-runs and reconnects will double-execute or drop legitimate events.

**Fix:**
- Pick the memory-canonical form `{terminal_id}:{deal_id}:{event_type}` everywhere.
- Master EA emits it.
- Desktop uses it as-is (don't regenerate). If the field is missing, fall back to `unknown:{deal_id}:{event_type}`.
- Receiver EA's `IsEventExecuted` keys on the same string.
- Add a one-time migration: ignore old-format keys on first boot, then write new format.

### 1.5 Broker-time → UTC drift

Memory says: *"Auto UTC offset detection via TimeCurrent vs TimeGMT."* The current EAs use a manual `InpBrokerUTCOffset` input (default 2). If the user gets it wrong (most do), the heartbeat staleness check, daily-P&L window, and event timestamps all skew, breaking master-online detection and the daily-loss reset.

**Fix in both EAs:**
- On `OnInit`, compute `g_utcOffsetSec = (long)TimeCurrent() - (long)TimeGMT()` and round to nearest 1800s (handles half-hour brokers).
- Recompute on each `OnTimer` tick (Mon-Fri DST shifts).
- Treat `InpBrokerUTCOffset` as "manual override only when non-zero".

---

## Phase 2 — Stabilization (HIGH priority)

### 2.1 Master EA queue is write-only with no consumer ack

`pending/*.json` files are deleted by whoever consumes them (desktop watcher OR a co-located receiver EA — race) and there's no record of which receiver successfully executed. With multiple receivers the first one wins and the others never see the event.

**Fix:**
- Desktop watcher reads, parses, and **moves** the file to a per-receiver `pending/<receiver_terminal_id>/` subfolder so each receiver consumes its own copy. Or: keep one queue, but only the desktop deletes after all receivers have ack'd via `resp_*.json`.
- Add a `delivered_to[]` array updated by the desktop in a sidecar `<filename>.ack` file.

### 2.2 Magic number collisions

Receiver EA hard-codes `request.magic = 12345`. Any other EA using 12345 will be picked up by `CloseAllCopierPositions` and accidentally closed.

**Fix:**
- Generate a per-receiver magic from a hash of `(receiver_id, master_account_id)` so each install has a unique magic.
- Persist it in `copier-config.json` (already cached) so it's stable across restarts.
- Update `CloseAllCopierPositions` and the position-discovery code to use the configured magic.

### 2.3 Slippage calc wrong for indices and 4-digit forex

`CalculateSlippage` divides by 10 only when `digits == 5 || digits == 3`. For indices (digits 1–2) and 4-digit pairs the value is reported in **points** but compared against `max_slippage_pips`. Threshold checks become meaningless.

**Fix:** Use the same digit/symbol-type table that already exists in `lot_calculator.rs::SymbolType` and convert everything to a consistent "pips" unit per symbol class (1pt for indices, 10pt for 5-digit forex, 1pt for 4-digit, 10pt for JPY 3-digit).

### 2.4 Daily P&L includes non-copier trades on the receiver

`CalculateDailyPnL` sums every deal in the receiver's history today. If the user trades manually, the daily-loss kill switch trips on their manual losses too.

**Fix:** Filter `HistoryDealGetInteger(ticket, DEAL_MAGIC) == g_copierMagic` (after 2.2 lands).

### 2.5 Symbol mapping has no contract-spec fallback

Memory rule: *"Prioritizes contract specs over names for cross-broker match."* Today `MapSymbol` only does an exact lookup in `g_symbolMappings` and falls back to `SymbolInfoInteger(masterSymbol, SYMBOL_EXIST)`. No normalization (`USTECm` → `USTEC`, `EURUSD.cash` → `EURUSD`), no contract-size tie-breaker.

**Fix:**
- Receiver EA generates `CopierSymbolCatalog.json` on startup with `{name, normalized_key, tick_value, contract_size, digits, profit_currency}` — the structure already expected by `symbol_catalog.rs`.
- Desktop, on receiving a master event whose symbol has no mapping, picks the receiver symbol with the closest `(contract_size, profit_currency, digits)` triple and writes the resolved symbol into the command.
- Persist auto-mapped pairs back to `copier_symbol_mappings` with `auto_mapped=true` and surface them in the Web UI for confirmation.

### 2.6 Receiver-side reconciliation never auto-mapped through the executor

`reconciliation.rs handle_discrepancy` writes `SyncCommand { command_type: "open" }` with raw master volume. It bypasses the lot calculator AND skips symbol mapping. After 2.1/2.5 land, route reconciliation through the same `execute` command path so risk + symbol logic apply.

### 2.7 Master heartbeat write race

`WriteHeartbeat` opens with `FILE_WRITE` and overwrites in place — readers can hit a half-written file. Fix to write `heartbeat.json.tmp` then `FileMove` rename, matching the pattern already used for event files.

### 2.8 Receiver EA `ParseConfigJson` is fragile

The current parser uses string-find positional parsing on the JSON. With multiple receivers in a config it picks fields from the **first** receiver's block regardless of `InpReceiverId` (the `receiverId` lookup at L609 is computed but its `configStart` is never used to scope subsequent extractions — `ExtractJsonString(json, "account_name", receiversStart)` ignores it).

**Fix:** Replace the hand-rolled parser with a tiny purpose-built JSON walker (or use the `JAson.mqh` include) and restrict every extraction to the substring between the matched receiver's `{` and its closing `}`.

### 2.9 The "execute_trade_async" path is dead code that confuses maintenance

`execute_trade()` is sync; `execute_trade_async` and the `ExecutionQueue` are `#[allow(dead_code)]`. Either wire them in (better: process events through a tokio queue so multiple receivers get parallel execution) or delete them. Recommend: keep async, delete sync, and move `process_event` onto a `tokio::spawn` per receiver so a slow broker on receiver A doesn't block receiver B.

---

## Phase 3 — Web app surface fixes

### 3.1 No web fallback if desktop wizard fails

All setup happens in the Tauri wizard. The web `Trade Copier` page can only show status. Add to the web app:

- A "Manual Setup" mode under `src/components/copier/`: pick which existing accounts are master/receivers, set risk mode/value, set per-receiver symbol map. Writes directly to `accounts`, `copier_receiver_settings`, `copier_symbol_mappings`. The desktop app then only needs to scan terminals and install EAs.
- A "Copy this api key" button on each receiver account in `Accounts.tsx` (right now `receiverWithApiKey` only surfaces the first one found).

### 3.2 `copier-config` edge function returns 404 instead of empty receivers

When a receiver's API key is valid but the user hasn't marked any account as master yet, the function returns 404 "No active master account found", which the desktop reports as "config sync failed". Better UX: return `{master: null, receivers: []}` with 200 so the desktop can show "Set up a master in the web app".

### 3.3 Realtime executions list never receives non-DB writes

`useCopierExecutionsRealtime` listens on `copier_executions` INSERTs, but the desktop currently has `sync/executions.rs` marked `#[allow(dead_code)]` and **never uploads** executions to the cloud. The web Activity tab will always be empty.

**Fix:** Wire `executions::queue_for_upload` into `event_processor` after each execution and run `process_queue` on a 30s tokio interval. Add a `copier-executions` edge function (currently referenced by the Rust code as `{API}/copier-executions` but does not exist in `supabase/functions/`).

### 3.4 Stats card miscalculates "Failed Today"

`CopierDashboard.tsx` shows `stats.failedCount` which is "all-time failed across last 1000 executions", labeled as "Failed Today". Filter by `executed_at >= startOfToday`.

---

## Phase 4 — Quality, observability, polish

- **Diagnostics tab is mostly placeholder zeros** (`get_diagnostics` returns hard-coded `queue_pending: 0`, etc.). Wire in real counts by listing `pending/` and counting `cmd_*.json` files per receiver.
- **No structured logs from EAs.** Master/Receiver write plain text. Convert to one-JSON-per-line so the desktop's `export_debug_bundle` can parse and filter.
- **Tests:** Rust has tests for lot calculator and idempotency. Add tests for: command serialization roundtrip, symbol normalization, the new request_id flow, and the new resp_*.json wait/timeout.
- **Receiver EA `ProcessPendingEvents` sorts files alphabetically** — but filenames are date-prefixed without time, so ordering within a day is by deal_id, not chronological. Switch to timestamped filenames or sort by `FileGetInteger(..., FILE_CREATE_DATE)`.
- **Reconciliation default interval is 30s, disabled by default** — fine, but UI should make it obvious it's off and provide a one-click "enable safe defaults" (auto-sync SL/TP only).

---

## Suggested execution order

1. Phase 1.1 + 1.2 + 1.4 together (one PR) — pipeline + position id + idempotency. Without these nothing else matters.
2. Phase 1.3 + 1.5 (lot calc and timezones).
3. Phase 2.1, 2.2, 2.5, 2.8 (multi-receiver, magic, symbol catalog, parser).
4. Phase 2.3, 2.4, 2.6, 2.7, 2.9 (correctness polish).
5. Phase 3 (web surface) once desktop is solid.
6. Phase 4 (observability) last.

---

## What I need from you before starting

I've laid out everything I see as broken or risky. Two things to confirm before I start coding:

1. **Pipeline direction (1.1):** OK with making the desktop app the sole router (Master EA → desktop → Receiver EA via cmd/resp), and deprecating the receiver EA's direct queue read? This is the cleanest design but means the desktop app must be running for any copying to occur. Alternative is a same-machine direct EA-to-EA mode as a fallback, which doubles the test matrix.
2. **Scope:** Want me to land all of Phase 1 in the next message, or stage it (1.1 + 1.4 first as smallest blast radius, then 1.2 + 1.3 + 1.5)?
