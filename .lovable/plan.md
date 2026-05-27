
# Auto-create accounts on connect — no trade required

## Problem

Today, switching MT5 logins doesn't surface the new account until either a deal is sent or a heartbeat with `account_info` arrives. `sync-account-state` (the function the EA hits on connect and on its polling timer) detects the new login but returns `account_id: null` and waits for `ingest-events` to create the row. Result: you switched accounts and see nothing in the UI.

## Fix

Make `sync-account-state` itself create the account row the first time it sees a new login, using the install's sibling account as a template — same approach `ingest-events` already uses. The EA's connect payload already includes `login`, `install_id`, and (in current EA builds) basic account context like broker name, so this is enough to materialise a real row immediately.

## Behaviour after the fix

1. EA connects → calls `sync-account-state` with `login=B`, `install_id=X`.
2. Cascade resolves:
   - No row matches `(user_id, account_number=B)`.
   - A sibling row exists for `(user_id, mt5_install_id=X)` → use it as template.
3. Insert new row: `account_number=B`, `mt5_install_id=X`, `name="${sibling.broker} - B"`, `live_state='live'`, `last_heartbeat_at=now()`, copying `api_key`, `copier_role`, `master_account_id`, `sync_history_enabled`, `account_type`, `prop_firm`, `broker`, `broker_utc_offset`, `broker_dst_profile`, `ea_type` from the sibling. Handle `23505` race by re-selecting.
4. Return `account_id` of the new row with `last_deal_id: null`, `last_event_time: null` so the EA does a fresh history sync.
5. Account appears in the UI immediately — no trade required. First deals/heartbeats then flow into it normally via `ingest-events` (whose existing auto-create branch becomes a safety net).

Switch back to A → resolves by `account_number=A` (branch 1), no duplicate, no overwrite. A's prior open trades stay tagged for repair until A's next dormant→live cycle or a manual Resync.

If there's no sibling (brand-new install with brand-new login) and the API key isn't bound to anything, behaviour is unchanged: return `account_id: null` and wait for `ingest-events` to create from a payload carrying `account_info`. This edge case requires EA-level info we don't have on connect alone.

## Technical changes

**`supabase/functions/sync-account-state/index.ts`** — only this file changes.

- In cascade step 2, when a sibling exists and `brokerLogin` is new:
  - Build template insert from sibling row (select the template columns above).
  - `insert(...).select().single()` with `23505` handler that re-selects on `(user_id, account_number, is_active=true)`.
  - Set `account` to the newly created row and continue.
- Remove the current "siblingExists → return null" short-circuit; replace with the create-from-template path.
- Keep dormant/force_resync repair logic intact (it's a no-op for a brand new row since it has no `is_open=true` trades).
- Keep all existing response shape and EA contract.

No schema changes. No EA changes. No frontend changes. `ingest-events` keeps its existing auto-create branch as a safety net for legacy EA payloads.

## Validation

- Log into A → row A appears Live (already works).
- Switch to B in MT5 → within one EA poll cycle (seconds), row B appears Live in the All Accounts list, before any trade.
- A flips to Dormant after 10 min idle (cron, unchanged).
- Switch back to A → A flips Live, B stays its own row, no duplicates, account numbers unchanged.
- Brand-new install, brand-new login, no API-key-bound account → still waits for first event (documented edge case).
