# Multi-account on one MT5 — one accounts row per broker login

## What changes for the user
- When you log into a new broker login on an MT5 terminal already known to the journal, a **new account row is auto-created** (named `${broker} - ${login}`, inheriting prop-firm / api-key / install-id / copier role from the sibling). It appears in **All Accounts** immediately, badge **Live**.
- The previously-active login on that terminal flips to **Dormant** within ~10 min; its open trades keep the *"⏸ Pending broker verification"* chip until you log back in.
- Every login owns its own history, balance, equity curve, prop-firm rules, and live state.

## The bug being fixed
The current sibling-fallback in `ingest-events` and `sync-account-state` resolves an unknown login by **overwriting `account_number`** on whichever row matches `mt5_install_id`. Switching logins keeps mutating the same row instead of producing one row per login — which is why the selector only shows one HolaPrime account.

## Fix

### 1. Schema guardrail
Partial unique index so concurrent events for a freshly-switched login can't create duplicate rows:
```
UNIQUE (user_id, mt5_install_id, account_number)
  WHERE mt5_install_id IS NOT NULL AND account_number IS NOT NULL
```
Auto-create uses `ON CONFLICT DO NOTHING` then re-selects.

### 2. `ingest-events` resolution cascade
1. `(user_id, account_number = login)` → use it.
2. Else if `(user_id, mt5_install_id = installId)` matches a sibling:
   - If `brokerLogin` present → treat sibling as a **template** and fall through to auto-create. Never overwrite `account_number` on the sibling.
   - If `brokerLogin` is null (legacy EA) → adopt sibling as-is.
3. Else if `accForKey` exists AND no login → use api-key-bound row.
4. Else if `payload.account_info` present → **auto-create new accounts row** copying `user_id`, `api_key`, `mt5_install_id`, `copier_role`, `master_account_id`, `sync_history_enabled`, `sync_history_from`, `account_type`, `prop_firm`, `broker`, `broker_utc_offset`, `broker_dst_profile`, `ea_type` from the sibling template (or from `account_info` + setup_token when no sibling). Set `account_number = login`, `name = "${broker} - ${login}"`, `live_state = 'live'`, `last_heartbeat_at = now()`.
5. Else: reject.

`mt5_install_id` is still backfilled on the matched row. `account_number` is **never** overwritten to a different login.

### 3. `sync-account-state` resolution cascade
Same first three steps. When the sibling exists but `brokerLogin` is new, **return `account_id: null` with `last_deal_id: null`** so the EA does a fresh history sync; the first event then hits ingest-events branch 4 and creates the row.

### 4. Repair logic (unchanged)
- `mark-dormant-accounts` cron flips accounts to `dormant` after 10 min without heartbeat.
- On reconnect (`live_state was dormant` or `force_resync=true`), `sync-account-state` auto-closes any `is_open` trade whose ticket isn't in EA's `expected_open_tickets[]`.

## Files touched
- New migration: partial unique index on `accounts (user_id, mt5_install_id, account_number)`.
- `supabase/functions/ingest-events/index.ts` — replace sibling-backfill branch; auto-create from sibling template.
- `supabase/functions/sync-account-state/index.ts` — sibling branch returns null when `brokerLogin` is new.

## Out of scope
- No EA changes (it already sends `api_key`, `install_id`, `login`, `account_info`).
- No new `terminals` table — `mt5_install_id` is enough.
- `balance_start` on auto-created rows comes from `account_info.balance`; user can edit later.

## Validation
1. Log into login A on terminal → row A appears, badge **Live**.
2. Switch to login B on the same terminal → row B auto-created on first event; A flips to **Dormant** within ~10 min; both visible in the dropdown; A's open trades show the pending-verification chip.
3. Switch back to A → A flips to **Live**, no duplicate row, A's `account_number` unchanged, B stays its own row.
4. Concurrent events for a new login → unique index ensures exactly one row, no Postgres error surfaces to the EA.
