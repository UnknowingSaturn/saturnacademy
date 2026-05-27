## Root cause

Two real problems compound:

1. **`g_terminalId = "MT5_<login>_<server>"`** — derived from the *active login*, so every login gets a different terminal id. The ingest function and `terminal_snapshots` / `terminal_accounts` were designed assuming one stable terminal id per MT5 install with logins flipping inside it. Today the "active login on terminal X" logic can never actually fire across logins, and drift detection is per-login-id (so it can't tell "this login is just dormant" from "this trade was closed at the broker").
2. **No authoritative gap-fill.** When you switch from account A → B in the same install, account A is frozen. Anything the broker does to A's positions (SL/TP hit, manual close, weekend rollover liquidations) is invisible until you log back in — and even then, the EA only reconciles a fixed history window. There's no "server tells EA what it last saw, EA sends everything newer" loop.

## Fix — architecture

```text
                       ┌──────────────────────────┐
                       │  MT5 install (terminal)  │
                       │  install_id = hash(path) │   ← stable across login switches
                       │                          │
   active login ──►    │  login A  login B  ...   │
                       └──────────┬───────────────┘
                                  │ every event carries:
                                  │   install_id        (stable)
                                  │   active_login      (current)
                                  │   account_info.login
                                  ▼
                       ┌──────────────────────────┐
                       │  ingest-events           │
                       │  routes by (user, login) │
                       └──────────┬───────────────┘
                                  │
                       ┌──────────▼───────────────┐
                       │  per-account watermark:  │
                       │   last_deal_id,          │
                       │   last_deal_time,        │
                       │   last_seen_at           │
                       └──────────┬───────────────┘
                                  │
                       ┌──────────▼───────────────┐
                       │  sync-account-state edge │  ← EA polls on connect
                       │  returns watermark       │     & every N min for the
                       │  + known-open tickets    │     CURRENTLY active login
                       └──────────────────────────┘
```

### EA changes (`mt5-bridge/TradeJournalBridge.mq5`, bump to v4.0)

1. **Stable install id.** Add `g_installId = SHA1(TerminalInfoString(TERMINAL_DATA_PATH))` (first 16 chars). Send both fields in every payload: `install_id` (stable) and `terminal_id` (kept = `install_id + "_" + login` for backward compat). All state files keyed by `<install_id>_<login>` so each login keeps its own queue / dedup / last-active even after switching back.
2. **Authoritative gap-fill on every connect.** On `OnInit`, instead of fixed 90-day `SyncHistoricalDeals`:
   - Call new `sync-account-state` edge function with `{install_id, login}`.
   - Receive `{ last_deal_time, last_deal_id, expected_open_tickets[] }`.
   - Run `HistorySelect(last_deal_time - 1h, now + 1h)`, send every deal newer than `last_deal_id` as `history_sync` (idempotency dedupes).
   - Compare `expected_open_tickets` against live `PositionsTotal()`: anything server thinks is open but isn't in MT5 → emit a synthesised `exit` event from `HistorySelectByPosition` (this is the missing piece for closes that happened while the EA/login was dormant).
3. **Periodic catch-up,** not just at startup. Add a timer-driven `RunCatchupCycle()` every ~5 min that re-runs the gap-fill above for the active login. Cheap because of idempotency.
4. **Snapshot includes `install_id` and `active_login`** so the server can scope drift per-install, not per-login-id.

### Backend changes

1. **New edge function `sync-account-state`** (`verify_jwt = false`, x-api-key auth like ingest-events):
   - Input: `{ install_id, login }`.
   - Output: latest `events.event_timestamp` + `deal_id` for that account, plus the set of `trades.ticket` where `is_open = true`.
2. **`ingest-events`:** persist `install_id` in `terminal_snapshots` + a new column on `accounts` (`mt5_install_id`). Switch the "active login on terminal" tracking in `terminal_accounts` to key off `install_id` instead of the login-flavoured `terminal_id`. Bump `accounts.last_sync_at` on every event so the UI can show per-account freshness.
3. **`trades-drift`:** scope drift detection by `install_id` and only flag accounts whose `active_login` matches the latest snapshot — dormant logins get a separate "awaiting next login" state instead of false-positive drift.

### UI changes (small, additive)

- Account card: badge for `last_sync_at` ("synced 2 min ago" / "dormant — last seen 3h ago, will sync when you log back in").
- `DriftTray`: split into two sections — "Needs repair" (active login, real drift) and "Awaiting next login" (dormant accounts the server is waiting on).

## Migration

- Add `mt5_install_id TEXT` to `accounts`, `last_sync_at TIMESTAMPTZ` to `accounts`, `install_id TEXT` to `terminal_snapshots`. Backfill `mt5_install_id` from existing `terminal_id` (strip login suffix where present); accounts that don't match get filled the first time the new EA connects.
- No destructive changes; old EA payloads (no `install_id`) keep working via the existing terminal_id path.

## Out of scope

- Copier EA changes (separate file, separate concern).
- Reworking the `events` table schema.
- Auth/permissions changes.

## Rollout

1. Migration + `sync-account-state` function + `ingest-events` updates + `trades-drift` update + UI badge.
2. New EA v4.0 in `mt5-bridge/TradeJournalBridge.mq5` and `public/TradeJournalBridge.mq5`. Old EA keeps working during transition.
3. After confirming on one account, you replace the EA in each MT5 install once — the new EA will self-heal both terminals on first connect.
