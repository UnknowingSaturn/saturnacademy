# Option B — Deal-events as the only writer of trade state

## Principle

`trades.is_open`, `exit_time`, and PnL columns are written **only** by explicit broker deal events (`entry`, `exit`, `close`, `partial_close`). `position_snapshot` becomes read-only — it records what each terminal currently sees, surfaces drift in the UI, and never mutates `trades`.

This eliminates the entire bug class where one account's snapshot can close another account's trades on a shared terminal.

---

## 1. New table — `terminal_snapshots`

Stores the latest snapshot per (terminal_id, active_login). Append-only, used for drift detection only.

```
terminal_snapshots
  id              uuid pk
  user_id         uuid
  terminal_id     text
  active_login    text         -- broker login active on the terminal at snapshot time
  account_id      uuid null    -- resolved account, null if not yet provisioned
  open_tickets    bigint[]
  received_at     timestamptz default now()
  ea_version      text null
  raw_payload     jsonb null
```

Indexes: `(terminal_id, active_login, received_at desc)`, `(user_id, received_at desc)`.

RLS: user can SELECT their own; only `service_role` writes.

## 2. New table — `terminal_accounts`

Explicitly models the N-accounts-per-terminal relationship. One row per (terminal_id, account_id), so we always know which accounts share a terminal and which one is "currently active".

```
terminal_accounts
  terminal_id     text
  account_id      uuid
  user_id         uuid
  last_active_at  timestamptz  -- updated on every event/heartbeat from that account
  is_currently_active boolean  -- true on the most-recent active account per terminal
  primary key (terminal_id, account_id)
```

Maintained server-side from `ingest-events`: every event/heartbeat upserts the row and flips `is_currently_active` to true for the matching account, false for siblings on the same terminal.

## 3. Migrate the existing `snapshot_closed` rows

One-time backfill in the migration:

- For every trade with a `snapshot_closed` marker in `partial_closes` AND `net_pnl = 0` AND no `repaired_*` marker present:
  - Set `net_pnl = NULL`, `gross_pnl = NULL`.
  - Leave the marker so `repair-snapshot-closed` can still find them.
- Existing repair button continues to heal them on demand.

## 4. Rewrite `position_snapshot` handler — `supabase/functions/ingest-events/index.ts`

Replace the existing handler (lines 347–405) with:

1. Resolve account from `payload.account_info.login` (no fallback to `anyAccountForKey`).
2. Insert a row into `terminal_snapshots`.
3. Upsert `terminal_accounts` and flip `is_currently_active`.
4. Return 200 with the resolved account + open ticket count.
5. **No writes to `trades`. No stale-trade detection. No PnL touching.**

That's the whole handler — under 30 lines.

## 5. Drift surfacing — new edge function `trades-drift`

Lightweight read-only function called by the Journal page:

- For each terminal currently active for the user, pick the most recent `terminal_snapshots` row.
- Find trades that are `is_open = true` on the snapshot's active account but whose ticket is missing from the snapshot's `open_tickets`.
- Return them as `drift_trades[]` with `last_seen_at` and `terminal_id`.

These are candidates for "broker probably closed this but we missed the deal event" — surfaced as a non-destructive "Needs attention" tray on the Journal, with a "Pull from MT5" button that triggers the existing `repair-snapshot-closed` flow.

Dormant trades (open on accounts whose `is_currently_active = false`) are never flagged — they're explicitly expected to be invisible until that login is reactivated.

## 6. UI changes

### `src/components/journal/TradeTable.tsx`
- Trades with `snapshot_closed` marker AND `net_pnl IS NULL` show "Awaiting repair" pill instead of "BE".
- Already-repaired trades unchanged.

### New `src/components/journal/DriftTray.tsx`
- Banner above the Journal table when `trades-drift` returns rows.
- Lists drift trades with: symbol, ticket, terminal, last_seen_at, "Repair" button (calls existing `repair-snapshot-closed`).
- Dismissible per row (writes a `dismissed_drift_at` marker).

### `src/pages/Accounts.tsx`
- Existing "Repair stuck break-even trades" button stays, scoped to historical rows.
- Add a small "Active on terminal" badge per AccountCard pulled from `terminal_accounts.is_currently_active`, so the user can see at a glance which account the EA is currently watching.

## 7. Files touched

- `supabase/functions/ingest-events/index.ts` — gut the snapshot handler, add terminal_accounts upsert in event/heartbeat paths.
- `supabase/functions/trades-drift/index.ts` — new, read-only.
- `src/components/journal/TradeTable.tsx` — display tweak for null-PnL snapshot rows.
- `src/components/journal/DriftTray.tsx` — new.
- `src/pages/Journal.tsx` — mount DriftTray.
- `src/pages/Accounts.tsx` — "active on terminal" badge.
- One migration: `terminal_snapshots`, `terminal_accounts`, backfill NULL-ing.

## 8. Out of scope

- MQL5 EA stays as is. No version bump required — old and new EAs both work because we no longer trust snapshots to mutate state.
- No changes to entry / exit / modify / close handlers (those are already authoritative).
- No changes to copier, reports, or backtester.
- Risk metrics already exclude NULL-PnL trades; no analytics work needed.

## Verification

1. With accounts A and B on one terminal, open a trade on A, switch MT5 login to B. After next snapshot:
   - `terminal_snapshots` has a new row for active_login=B.
   - `terminal_accounts.is_currently_active` is true for B, false for A.
   - Trade on A is still `is_open = true`, no markers added, no PnL change.
   - DriftTray shows nothing (A is dormant, not drifting).
2. Genuinely miss an exit (close in MT5 while EA offline, then reconnect):
   - Snapshot for the active account omits the ticket.
   - DriftTray surfaces the trade with a Repair button.
   - Clicking Repair pulls the close deal from `events` and writes real PnL.
3. Check edge logs: `position_snapshot` handler never logs "closed N stale trades" anymore.
4. Historical `snapshot_closed` rows: render as "Awaiting repair" until user clicks the repair flow.
