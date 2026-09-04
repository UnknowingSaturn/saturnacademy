# Journal isn't picking up new trades — new logins on an existing EA install get 401'd

## What's actually happening (verified)

Your EA is alive and sending right now. Ingest log from a minute ago:

```text
12:41:51 INFO  Received event: MT5_138740_HolaPrime-_heartbeat_...
12:41:51 ERROR Account resolution failed: Invalid API key
```

Nothing has been written since **27 Jul 2026** (last trade `13:15`, last event `13:55`, 503 trades total). Terminal `MT5_138740_HolaPrime-` is a **new login** on the install that already ran the EA (`3cf4b051225143bf`) — exactly what you described.

Two things combine to break it:

1. **All 12 account rows have `is_active = false`.** They were soft-deleted (the Accounts page "Delete" sets `is_active = false`, `useAccounts.tsx:104`).
2. **Key resolution requires an active account.** `apiKey.ts` matches `accounts.api_key` only `where is_active = true`, and the setup-token fallback only accepts unexpired, unused tokens — the newest token expired 12 May. With neither match, `resolveAccount` throws `Invalid API key` at step 1, *before* it ever looks at the broker login. So the auto-create path that was meant to handle a new login on a known install never runs.

Net effect: adding a new account to an already-provisioned terminal is only supported while at least one active account still carries that key. Deactivate them all — or point the EA at a login whose sibling rows were removed — and the whole install goes dark with a misleading "Invalid API key".

## The fix

### 1. Restore the feed now (data)
Reactivate the Hola Prime rows bound to the EA's key on install `3cf4b051225143bf`, so the key resolves again and login `138740` can auto-create its own account row. Heartbeats should stop erroring within a minute.

### 2. Make onboarding a new login on an existing install first-class (code)
- `apiKey.ts`: resolve **key → user** without the `is_active` filter. A soft-deleted account still identifies its owner; whether it is the routing target is a separate decision. Return an `inactive` flag with it.
- `accountResolver.ts`: keep `is_active` on the *routing* lookups (by login, and install-sibling), but allow the **install sibling to be inactive when used purely as a template** for auto-create (broker, prop firm, UTC offset, DST profile, copier role, sync settings). A new login on a known install then gets a fresh, active account row inheriting the right settings — no re-provisioning, no new setup token.
- Auto-create currently requires `anyAccountForKey || unused setup token`; widen it to "the key belongs to a real user of this install", so a deactivated fleet doesn't block it.

### 3. Stop it going dark silently
- Ingest returns a distinguishable error/log for "key belongs to a deactivated account" vs a genuinely unknown key.
- Accounts page: rename "Delete" to **Archive**, and warn when the account being archived is the last active one bound to an EA key / MT5 install — that action stops ingestion for the whole terminal.
- Accounts + Journal: a banner when an EA install has heartbeated recently but no active account exists for it, with a one-click **Reactivate** action. Same banner logic covers "no heartbeat in 30+ minutes" (dead feed).
- Accounts page: show accounts discovered on your installs that are archived, so re-enabling one is obvious rather than requiring a fresh setup token.

### 4. Backfill the 27 Jul → today gap
Once the key resolves, trigger a history resync for the affected accounts (`force_resync` / `sync_history_from`) so trades placed while the feed was rejected are pulled from the terminal rather than lost.

## Technical notes
- Files: `supabase/functions/_shared/apiKey.ts`, `supabase/functions/_shared/accountResolver.ts`, `src/hooks/useAccounts.tsx`, `src/pages/Accounts.tsx`, plus a small data update flipping `is_active` back on for the live install's accounts.
- No schema changes.
- `mark_dormant_accounts()` only touches `live_state`, never `is_active` — not the culprit.
- Roadmap: this adds a task "robust multi-account onboarding on an existing EA install" to `roadmap.md` at build time.

## Verification
- Two consecutive heartbeats ingest with no `Invalid API key` in the logs.
- An account row exists for login `138740`, `is_active = true`, inheriting broker/DST settings from its install sibling.
- `last_heartbeat_at` is within the last minute; the Journal shows a newly opened MT5 trade without a manual refresh.
- Archiving the last active account for an install shows the warning; the recovery banner appears and reactivation restores ingestion.
- Trades between 27 Jul and today appear after the resync.
