# Journal isn't picking up new trades — the EA is being rejected at the door

## What's actually happening (verified)

Your MT5 EA **is** sending data right now. The ingest function log from a minute ago:

```text
12:41:51 INFO  Received event: MT5_138740_HolaPrime-_heartbeat_... 
12:41:51 ERROR Account resolution failed: Invalid API key
```

So the pipeline is alive, but every event is rejected with 401. Nothing has been written since **27 Jul 2026** — last trade `2026-07-27 13:15`, last event ingested `2026-07-27 13:55`, 503 trades total.

The reason: **all 12 account rows have `is_active = false`.** The API-key lookup (`supabase/functions/_shared/apiKey.ts`) only matches accounts where `is_active = true`, and the setup-token fallback only accepts unexpired, unused tokens — the newest token expired 12 May. With no match, the resolver throws `Invalid API key` before it can even look at the broker login, so the auto-create path for the new login (`138740`) never runs either.

Accounts get `is_active = false` from exactly one place: "Delete account" in the Accounts page, which soft-deletes (`useAccounts.tsx:104`). At some point every account was removed that way, and that quietly killed ingestion for the whole install.

## The fix

### 1. Restore ingestion now (data)
Reactivate the account rows that the EA's key is bound to (the Hola Prime rows on install `3cf4b051225143bf`), so the key resolves again. This alone unblocks the live feed; trades from the running terminal will start landing within a heartbeat.

### 2. Make key resolution survive a soft delete (code)
In `apiKey.ts`, drop the `is_active = true` condition when resolving **key → user**. A soft-deleted account should still identify the owner; whether it is the routing target is a separate question. In `accountResolver.ts`, keep `is_active` on the *routing* lookups but let the auto-create path fire, so a new broker login (like `138740`) gets its own fresh, active account row instead of a 401.

### 3. Stop it happening silently again
- Ingest returns a distinguishable error for "key belongs to a deleted account" instead of a blanket `Invalid API key`.
- Accounts page: renaming "Delete" to "Archive/Deactivate", with a warning that it stops MT5 sync for any EA using that key.
- Journal/Accounts: a visible banner when the newest heartbeat across all accounts is older than ~30 minutes while an EA install is known — so a dead feed is obvious instead of just "no new trades".

### 4. Backfill the gap
Once the key resolves, run a history resync for the affected accounts (`force_resync` / `sync_history_from`) so trades placed between 27 Jul and today are pulled in from the terminal rather than lost.

## Technical notes
- Files: `supabase/functions/_shared/apiKey.ts`, `supabase/functions/_shared/accountResolver.ts`, `src/hooks/useAccounts.tsx`, `src/pages/Accounts.tsx`, plus a small data migration to flip `is_active` back on for the live install's accounts.
- No schema changes needed.
- `mark_dormant_accounts()` only touches `live_state`, not `is_active` — it is not the culprit.

## Verification
- Ingest logs show `Received event ...` with no `Invalid API key` for at least two heartbeats.
- `accounts.last_heartbeat_at` is within the last minute for the live login.
- A new trade opened in MT5 appears in the Journal without a manual refresh.
- Trades between 27 Jul and today appear after the resync.
