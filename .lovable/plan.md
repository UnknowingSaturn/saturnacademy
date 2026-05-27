# Multi-account on one terminal — server-authoritative live state

Make the journal correct even when one MT5 terminal switches between multiple logins. No trade ever gets silently stuck; the worst case is a clearly-labelled "pending broker verification" chip until you log back in.

## What changes for the user

- Each account gets a live state badge: **Live**, **Dormant**, **Verifying**, **Stale**.
- Open trades on a dormant account stay in the journal with a chip: *"⏸ Pending broker verification — log into [Account Name] in MT5 to confirm"*.
- When you log back into a dormant login, the EA's first catchup either confirms the position (chip clears) or auto-closes it (synthesised exit at last known price, flagged `auto_close_on_reconnect`).
- One-time cleanup: HolaPrime `account_number` corrected `70581 → 70561`, the two stuck NAS tickets (`4576110`, `4560989`) closed with `auto_close_on_resync`.

## Architecture

```text
EA (one terminal, one active login at a time)
   │  heartbeat + events (login_id, install_id, api_key)
   ▼
ingest-events / sync-account-state
   │  resolves account via:  api_key → (user_id, account_number=login) → (user_id, install_id) → fallback
   │  updates terminal_accounts (which login is currently active on this install)
   ▼
live_state worker (cron, every 2 min)
   │  flips accounts to dormant when no heartbeat for that login >10 min
   │  flips back to live on first fresh heartbeat
   ▼
trades.live_state derived from accounts.live_state
   UI shows chip + repair-on-reconnect
```

## Implementation

### 1. Schema

- `accounts.live_state` enum: `live | dormant | verifying | stale` (default `live`).
- `accounts.last_heartbeat_at timestamptz` (per-account, not per-install).
- `accounts.force_resync boolean default false` (used by Resync button + on-reconnect repair).
- No change to `trades`; we derive `pending_verification` in the client from the trade's `account.live_state` + `is_open`.

### 2. Edge functions

- **`sync-account-state`** — replace strict `(user_id, account_number=login)` lookup with the cascade above. Backfill `account_number` and `mt5_install_id` on the matched row. Update `accounts.last_heartbeat_at = now()` and `live_state = 'live'` for the resolved account. Return `expected_open_tickets[]` so EA can reconcile.
- **`ingest-events`** — same resolution cascade (already mostly there); also bumps `last_heartbeat_at` + `live_state = 'live'`.
- **On-reconnect repair** — when `sync-account-state` finds `accounts.live_state` was `dormant` or `force_resync = true`, after receiving the EA's catchup snapshot, any trade still `is_open = true` whose ticket isn't in `expected_open_tickets[]` gets auto-closed: `is_open = false`, `exit_time = now()`, `exit_price = entry_price`, `net_pnl` left as-is, `raw_payload.repair_reason = 'auto_close_on_reconnect'`.
- **`mark-dormant-accounts`** (new, cron every 2 min via pg_cron + pg_net) — sets `live_state = 'dormant'` for any account where `last_heartbeat_at < now() - interval '10 minutes'` and `live_state = 'live'`.

### 3. UI

- `AccountCard` — show `live_state` badge with tooltip explaining each state.
- `TradeRow` / `DriftTray` — when `trade.is_open && account.live_state === 'dormant'`, render the "Pending broker verification" chip with the account name and a small "Resync now" button (calls `sync-account-state` with `force=true` for that account's install).
- Keep the existing manual break-even repair tool as the escape hatch.

### 4. One-time data fix (separate insert/update, not a migration)

- `UPDATE accounts SET account_number = '70561', name = 'Hola Prime Ltd - 70561' WHERE id = '88a046bd-04ae-4d82-b092-f2fdec88cbfb'`.
- Close tickets `4576110` and `4560989`: `is_open = false`, `exit_time = now()`, `exit_price = entry_price`, `raw_payload` merged with `{repair_reason: 'auto_close_on_resync'}`.

## Out of scope

- EA changes — current v4 already sends heartbeat + catchup; no MQL5 edit needed.
- Renaming `terminal_id` to drop stale login suffix.
- Multi-install discovery / running >1 terminal per machine.

## Validation

1. After deploy, `sync-account-state` with login `70561` returns `account_id` for the HolaPrime row and an `expected_open_tickets` array.
2. HolaPrime `live_state` flips to `live` on first heartbeat; the two stuck NAS trades close automatically.
3. Log into a different account on the same terminal → previous account flips to `dormant` within ~10 min; any open trades on it show the pending-verification chip but remain in the journal.
4. Log back into the dormant account → chip clears (or trade auto-closes if MT5 no longer has the position).
