

# TradeJournalBridge EA — Comprehensive Audit

## 1. Redundant / Over-Engineered Areas

### 1a. Duplicate payload builders (HIGH)
`BuildEventPayload()`, `BuildHistorySyncPayload()`, and `BuildOpenPositionPayload()` are ~90% identical — each builds the same JSON structure with minor variations. This is ~300 lines of near-copy-paste code. A single `BuildPayload()` with flags would cut this by 200+ lines and eliminate drift bugs (e.g. a field added to one but forgotten in another).

### 1b. Duplicate filter logic (MEDIUM)
Symbol/magic filtering is copy-pasted in `OnTradeTransaction`, `ReconcileClosedPositions`, `SyncHistoricalDeals`, `SendPositionSnapshot`, and `SyncOpenPositions` — 5 places. Should be a single `PassesFilter(symbol, magic)` function.

### 1c. Duplicate account-type detection (LOW)
The `live/demo/prop` detection block (checking server name for "demo", "ftmo", etc.) is repeated in 4 payload builders. Should be one `DetectAccountType()` function.

### 1d. `OnTick()` as backup queue processor (MEDIUM)
`OnTick()` duplicates `OnTimer()` queue processing. Since `EventSetTimer(30)` is already reliable, the `OnTick()` backup adds unnecessary CPU load on every tick across all symbols. The timer alone is sufficient.

### 1e. `g_processedDeals` in-memory dedup vs server-side idempotency (LOW)
The EA maintains a 1000-entry in-memory array AND the server already handles idempotency via `idempotency_key`. The client-side array is a useful optimisation to avoid network calls, but the linear O(n) scan on every deal is inefficient. A hash set or sorted array with binary search would be better, or simply rely on server 409s.

---

## 2. Bugs and Gaps

### 2a. `equity_at_entry` is wrong for history sync (HIGH)
`BuildOpenPositionPayload()` sends the CURRENT equity as `equity_at_entry`, not the equity at the time the trade was opened. This means R% calculations for synced trades use today's equity, not the equity when the trade was taken. For historical sync, this field should be omitted (let backend calculate from balance history or skip R%).

### 2b. Broker UTC offset is static — fails during DST (HIGH)
`InpBrokerUTCOffset` is a fixed integer input. Most brokers shift between UTC+2 and UTC+3 for daylight savings. This causes all timestamps to be off by 1 hour for ~6 months of the year. Should use `TimeGMTOffset()` which returns the actual current offset, or compute `TimeCurrent() - TimeGMT()` dynamically.

### 2c. No SL/TP modification tracking (MEDIUM)
When a user moves their SL or TP on an open trade, no event is sent. The database keeps the original SL/TP from entry. This means R-multiple calculations can be wrong if the user tightens their stop. `OnTradeTransaction` should handle `TRADE_TRANSACTION_POSITION` events for SL/TP changes and send a `modify` event.

### 2d. Partial close creates orphaned records (MEDIUM)
When a position is partially closed, `DEAL_ENTRY_OUT` fires with a partial lot size, but the remaining position keeps the same ticket. The EA sends this as a plain `exit`, but the backend may fully close the trade. Need to send lot_size context so the backend can handle partial vs full close correctly. (The backend may already handle this via lot comparison — needs verification.)

### 2e. `SyncOpenPositions` sends `deal_id: 0` and `order_id: 0` (MEDIUM)
Open position sync uses position ticket as the only ID and hard-codes `deal_id` and `order_id` to 0. The entry deal IS available via `HistorySelectByPosition()` — the EA should look it up and send the real deal ID for proper idempotency matching.

### 2f. No commission tracking for open positions (LOW)
`BuildOpenPositionPayload` sends `commission: 0`. The actual commission from the entry deal is available via history lookup.

### 2g. Queue file corruption risk (LOW)
The queue file uses `|` as delimiter with `{{PIPE}}` escaping, and `FILE_SHARE_WRITE` allows concurrent writes. If MT5 crashes mid-write, the file can be corrupted. No integrity check exists on read.

### 2h. Log file grows unbounded (LOW)
`TradeJournal.log` is opened with `FILE_READ|FILE_WRITE` and appended to forever. No rotation or size limit.

---

## 3. Missing Industry-Standard Features

### 3a. Auto-detect broker timezone (HIGH priority)
Replace manual `InpBrokerUTCOffset` with automatic detection using `TimeGMT()` and `TimeCurrent()`. This eliminates user configuration errors and handles DST automatically.

### 3b. SL/TP modification events (HIGH)
Track `TRADE_TRANSACTION_POSITION` in `OnTradeTransaction` to detect SL/TP changes on open positions. Send a `modify` event to keep the database in sync. Critical for accurate R-multiple tracking.

### 3c. Heartbeat / health check event (MEDIUM)
Send a periodic lightweight `heartbeat` event (every 5-10 min) containing: account balance, equity, number of open positions, EA version. This enables the frontend to show "last seen" status and detect disconnected terminals.

### 3d. Spread capture at entry (MEDIUM)
Capture `SymbolInfoInteger(symbol, SYMBOL_SPREAD)` at trade time and include in the payload. Useful for analytics (e.g., "was the spread unusually wide?").

### 3e. Account leverage and margin info (LOW)
Send `ACCOUNT_LEVERAGE`, `ACCOUNT_MARGIN_FREE`, and `ACCOUNT_MARGIN_LEVEL` in account_info. Useful for risk analysis and prop firm compliance monitoring.

### 3f. EA self-update version check (LOW)
On startup, call a version-check endpoint. If a newer EA version exists, print a prominent message to the Experts tab. Prevents users from running stale EA versions.

### 3g. Graceful shutdown — flush queue (LOW)
In `OnDeinit`, attempt to flush any pending queue items before shutting down (with a short timeout). Currently queued items just wait for next startup.

---

## 4. Recommended Refactors (No New Features)

| Refactor | Impact | Effort |
|----------|--------|--------|
| Consolidate 3 payload builders into 1 | Eliminates 200+ LOC, prevents field drift | Medium |
| Extract `PassesFilter()` helper | DRY, fewer bugs when filters change | Low |
| Extract `DetectAccountType()` helper | DRY | Low |
| Extract `GetAccountPayload()` helper | DRY (account_info JSON block repeated 4x) | Low |
| Remove `OnTick()` backup queue processing | Reduces CPU, timer is sufficient | Low |
| Replace linear `IsDealProcessed` scan with sorted array + binary search | O(log n) instead of O(n) | Low |
| Add log file rotation (max 1MB, keep 2 files) | Prevents disk fill | Low |

---

## 5. Summary Priority Matrix

```text
Priority  | Issue                              | Type
----------|------------------------------------|----------
CRITICAL  | DST-broken timestamps              | Bug fix
CRITICAL  | Wrong equity_at_entry on sync       | Bug fix
HIGH      | Consolidate payload builders       | Refactor
HIGH      | SL/TP modification tracking        | New feature
HIGH      | Auto-detect broker timezone        | New feature
MEDIUM    | Heartbeat events                   | New feature
MEDIUM    | Spread capture                     | New feature
MEDIUM    | Partial close handling              | Bug fix
MEDIUM    | Real deal_id for open pos sync     | Bug fix
MEDIUM    | Remove OnTick backup               | Cleanup
LOW       | Log rotation                       | Cleanup
LOW       | Queue file integrity               | Robustness
LOW       | Leverage/margin in payload         | Enhancement
LOW       | EA version check                   | Enhancement
```

---

## 6. Proposed Implementation Plan

If approved, I would implement changes in this order:

**Phase 1 — Bug fixes + Refactors (EA only)**
- Auto-detect broker timezone (replace `InpBrokerUTCOffset` with dynamic calculation, keep input as optional override)
- Fix `equity_at_entry` for history/open-position sync (omit or mark as estimated)
- Consolidate payload builders into single function
- Extract shared helpers (`PassesFilter`, `DetectAccountType`, `GetAccountPayload`)
- Remove `OnTick()` backup
- Look up real deal_id for open position sync

**Phase 2 — New features (EA + Backend)**
- SL/TP modification tracking (`modify` event type)
- Heartbeat event with account health data
- Spread capture at trade time
- Add leverage/margin to account_info

**Phase 3 — Robustness**
- Log rotation
- Queue file integrity checks
- Graceful shutdown queue flush

Each phase produces a compilable, backward-compatible EA. The backend (`ingest-events`) would need minor additions to handle `modify` and `heartbeat` event types.

