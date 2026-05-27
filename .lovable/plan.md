# Reconciliation Pipeline Redesign — One-Writer Model

## The bug behind the design

Right now there are **two writers** mutating closed-trade PnL on the `trades` table:

1. **`ingest-events`** — the legitimate writer. Sees real DEAL_ENTRY_OUT events and computes `gross_pnl / commission / swap / net_pnl / exit_price / exit_time`.
2. **`sync-account-state`** — the "stale trade reaper." When a ticket is no longer in the EA's open list, it sets `is_open=false, exit_price=entry_price` (i.e. **PnL = 0**) without inserting any repair-event marker.

The repair function (`repair-snapshot-closed`) is designed to heal trades that carry a `snapshot_closed` action in `trade_repair_events` — but **nobody writes that action** today (`rg` confirms zero writers). So:

- `sync-account-state` silently zeros out PnL on any trade whose close event was attributed to a sibling login.
- `repair-snapshot-closed` looks for trades it can never find.
- `repair-snapshot-closed` and `trades-drift` both filter on `snapshot_closed`, so they are effectively dead code on real data.

The fix is the **One-Writer** rule: only `ingest-events` may write PnL/exit fields. Everyone else uses tombstones.

## Target design

```text
                       ┌──────────────────┐
   EA file queue  ───► │  ingest-events   │ ─► sole writer of pnl/exit_*
                       └──────────────────┘
                                 │
                                 │ inserts events + flips is_open
                                 ▼
                            trades table
                                 ▲
                                 │ tombstones only (awaiting_exit, repair markers)
                                 │
   EA heartbeat  ───► sync-account-state    ─► marks awaiting_exit, NEVER writes PnL
                                 │
                                 │
   user clicks "Repair"   ───►   repair-snapshot-closed ─► one unified sweep
```

### Field semantics

- `trades.is_open` — flips false only when we have a real exit (ingest-events) **or** the trade is tombstoned awaiting repair (sync-account-state).
- `trades.awaiting_exit BOOLEAN DEFAULT false` — **new column**. True = "ticket disappeared from MT5 open list but we have no exit event yet." UI shows a pill, PnL stays `NULL`, the trade is excluded from win-rate stats.
- `gross_pnl / net_pnl / exit_price / exit_time` — nullable; only ingest-events writes them.
- `trade_repair_events.action = 'snapshot_closed'` — written by `sync-account-state` when it tombstones, so the repair sweep can find them.

## Changes

### 1. Schema migration

```sql
ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS awaiting_exit BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_trades_awaiting_exit
  ON public.trades (account_id) WHERE awaiting_exit = true;
```

### 2. `sync-account-state` — stop writing PnL

Replace the auto-close block (lines ~196-212) with **tombstoning**:

```ts
for (const t of stale) {
  await supabase.from("trades")
    .update({
      is_open: false,
      awaiting_exit: true,
      raw_payload: { ...(t.raw_payload || {}), tombstoned_at: new Date().toISOString() },
    })
    .eq("id", t.id);

  await supabase.from("trade_repair_events").insert({
    user_id: account.user_id,
    trade_id: t.id,
    action: "snapshot_closed",
    source: "sync_account_state_reaper",
    metadata: { ticket: t.ticket, reason: "ticket_not_in_open_list" },
    applied_at: new Date().toISOString(),
  });
}
```

No more `exit_price = entry_price`. No more `exit_time = now()`. PnL stays null.

### 3. `repair-snapshot-closed` — unchanged logic, now actually fires

Already looks for `snapshot_closed` markers and applies real PnL from sibling-account events. With step 2 in place, this becomes the **one repair sweep** that finalizes tombstoned trades. Add `awaiting_exit: false` to its update payload.

### 4. `ingest-events` — also clear the tombstone

When a real exit event lands for a trade currently `awaiting_exit = true`, set `awaiting_exit: false` alongside the real PnL write. The existing repair branches already do most of this; just append `awaiting_exit: false` to those `.update(...)` payloads.

### 5. Frontend

- `TradeTable.tsx`: show an "Awaiting exit" pill when `trade.awaiting_exit === true` (replaces the current confusing "$0.00 closed" row). Already has a `hasSnapshotClosed` branch — extend it to read the new column directly.
- `useOpenTrades.tsx` / journal stats: exclude `awaiting_exit = true` trades from win-rate, expectancy, P&L sums. They're neither open nor truly closed.

### 6. Hold on `reclassify-sessions` → `reprocess-trades` merge

That was Section 3 of the audit, not Section 5. Leave it for a separate turn so this PR stays focused on the PnL writer split.

## Why this is safe

- **No data loss** — we're removing a write that zeroed real PnL. Historical trades already zeroed by the old reaper will need a one-off backfill (mark them `awaiting_exit = true` if `gross_pnl IS NULL OR (gross_pnl = 0 AND net_pnl = 0 AND exit_price = entry_price)`), but that backfill is part of the migration.
- **Idempotent** — `trade_repair_events` already has unique constraints on `(trade_id, action)` semantics in the codebase; re-running sync on the same stale ticket is a no-op.
- **Reversible** — if anything misbehaves, drop the column and revert the two functions.

## Out of scope

- Splitting `ingest-events` (1151 LOC). Big, separate refactor.
- Cron scheduling for `repair-snapshot-closed`. Stays manual/UI-triggered for now.
- Playbooks.tsx god-file split (separate turn, deferred earlier).
