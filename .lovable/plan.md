

## Fix: Stale Live Trades When MT5 Closes and Reopens

### Root Cause Analysis

The core problem is a **gap detection blind spot** in the EA:

1. **`OnTradeTransaction` only fires for live events** — if MT5 is closed when a trade closes, the event is never captured
2. **`SyncOpenPositions()` only sends entry events** for currently open positions — it never checks if previously-open trades have closed
3. **`SyncHistoricalDeals()` runs every 24h** and scans 90 days of deals, but it doesn't specifically target the gap period when the EA was offline
4. **No reconciliation loop** — there's no periodic check comparing MT5's actual open positions against what the database thinks is open

Result: trades that closed while MT5 was offline remain stuck as `is_open: true` in the database forever.

---

### Solution: Position Reconciliation (EA + Backend)

#### Part 1: New EA Function — `ReconcileClosedPositions()`

Add a function that runs **on startup** (after `SyncOpenPositions`) that:

1. Scans deal history for the gap period (since last EA run, tracked via a file)
2. Finds all **exit deals** that occurred while the EA was offline
3. Sends these as normal `exit` events to `ingest-events`
4. This naturally closes the stale trades in the database

```text
OnInit flow:
  1. SyncOpenPositions()     — ensures open trades exist in DB
  2. ReconcileClosedPositions() — NEW: finds exits that happened while offline
  3. Normal operation begins
```

Key implementation:
- Store `last_active_time` in a file (updated every OnTimer tick)
- On startup, scan history from `last_active_time` to now
- Send any exit deals found as regular `exit` events (idempotency handles duplicates)

#### Part 2: New EA Function — Periodic Position Snapshot via `OnTimer`

Add to the existing `OnTimer()` handler:

1. Every 60 seconds, update a `last_active_time` file
2. Every 5 minutes, do a lightweight reconciliation: compare `PositionsTotal()` against a cached list of known open position tickets
3. If a position disappears from MT5's open list, scan its deal history and send the exit event

```text
OnTimer flow (every 30s):
  1. Update last_active_time file
  2. ProcessQueue() (existing)
  3. Every 5th tick: compare open positions vs cached list
     → If position missing: find exit deal, send exit event
```

#### Part 3: New Backend Event — `position_snapshot` (Optional Enhancement)

Add a lightweight endpoint where the EA sends the list of currently open position IDs. The backend:

1. Compares against `trades` where `is_open = true` and `account_id` matches
2. Any trade in DB that's NOT in the EA's open list gets marked for investigation
3. Runs a best-effort close using the most recent exit event data

This is a safety net for edge cases where exit deals can't be found in MT5 history.

#### Part 4: Frontend — Already Handled

The `useOpenTrades` hook already has Supabase Realtime subscription on the `trades` table. Once the backend updates `is_open: false`, the frontend will automatically remove the trade from the live view. No frontend changes needed.

---

### Implementation Files

| File | Action | Changes |
|------|--------|---------|
| `mt5-bridge/TradeJournalBridge.mq5` | **Modify** | Add `ReconcileClosedPositions()`, periodic position tracking in `OnTimer()`, `last_active_time` file management |
| `public/TradeJournalBridge.mq5` | **Modify** | Mirror changes from mt5-bridge |
| `supabase/functions/ingest-events/index.ts` | **Modify** | Add `position_snapshot` event type handler that reconciles open trades |

---

### Detailed EA Changes

**New global variables:**
```mql5
string g_lastActiveFile = "";      // Tracks when EA was last running
ulong  g_knownOpenPositions[];     // Cached list of open position tickets  
int    g_reconcileCounter = 0;     // Timer counter for periodic reconciliation
```

**New function: `ReconcileClosedPositions()`**
- Reads `last_active_time` from file
- Calls `HistorySelect(lastActiveTime, TimeCurrent())`
- Iterates all deals, finds `DEAL_ENTRY_OUT` deals
- For each exit deal, builds and sends a normal exit event payload
- Idempotency keys prevent duplicates if the deal was already processed

**New function: `UpdateLastActiveTime()`**
- Writes current `TimeCurrent()` to file every timer tick
- Used on next startup to determine the offline gap

**Modified `OnTimer()`:**
- Calls `UpdateLastActiveTime()` every tick
- Every 10th tick (~5 min): calls `CheckForClosedPositions()` which compares current open positions against `g_knownOpenPositions[]`

**New function: `CheckForClosedPositions()`**
- Gets current open position tickets from MT5
- Compares against `g_knownOpenPositions[]`
- For any missing positions, finds exit deal and sends exit event
- Updates `g_knownOpenPositions[]`

**New function: `SendPositionSnapshot()`**
- Builds JSON array of currently open position IDs
- Sends to `ingest-events` with `event_type: "position_snapshot"`
- Backend uses this as ground truth to close orphaned trades

---

### Edge Cases Handled

| Scenario | How It's Fixed |
|----------|---------------|
| Trade closes while MT5 is fully closed | `ReconcileClosedPositions()` on startup scans the gap period |
| Trade closes while EA is removed but MT5 is open | Same — gap detection finds the exit deal on next EA attach |
| MT5 crashes mid-trade | `CheckForClosedPositions()` periodic check catches it within 5 min |
| Trade closed on mobile/web terminal | Exit deal appears in MT5 history — reconciliation finds it |
| Multiple trades close while offline | All exit deals are scanned and sent individually |
| Internet was down when trade closed | Queue retry handles failed sends; reconciliation re-sends on reconnect |

