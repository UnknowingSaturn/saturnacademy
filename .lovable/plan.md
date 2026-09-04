# Fix the feed properly: make MT5 identity install-scoped, not account-scoped

## The bug, and why patching it isn't enough

Verified right now: your EA is sending, and every event is rejected.

```text
12:41:51 INFO  Received event: MT5_138740_HolaPrime-_heartbeat_...
12:41:51 ERROR Account resolution failed: Invalid API key
```

Nothing has been written since **27 Jul 2026** (503 trades, last event `13:55` that day). Login `138740` is a new account you added to the install that already ran the EA (`3cf4b051225143bf`).

Chain of causes:
- All 12 `accounts` rows are `is_active = false` — the Accounts page "Delete" soft-deletes (`useAccounts.tsx:104`).
- `apiKey.ts` resolves the key only against **active** accounts; the setup-token fallback needs an unexpired unused token (newest expired 12 May).
- So `resolveAccount` throws at step 1, before it ever reads the broker login — the auto-create path built for exactly your situation never runs.

The deeper problem is the model: **the EA's identity is borrowed from an account row.** An account row is user-owned, editable, archivable and per-login, but it is being used as a credential for a whole terminal install. Every edge case you can hit — archive the last account, add a new login, reinstall MT5, change broker server, run two terminals from one install — collapses into "Invalid API key". Adding conditionals to the resolver treats each symptom separately and leaves the next one to be discovered in production, silently, weeks later.

Both are worth doing, but only the redesign is durable. So: an unblock now, then a small structural change.

## Step 1 — Unblock today (data only)

Reactivate the Hola Prime rows on install `3cf4b051225143bf` so the key resolves and login `138740` auto-creates. The feed comes back within a heartbeat; then queue `force_resync` with `sync_history_from = 2026-07-27` to backfill the gap from the terminal.

## Step 2 — The redesign: credential belongs to the install, not the account

Introduce a small `mt5_installs` table — one row per MT5 installation:

```text
mt5_installs
  id            uuid
  user_id       uuid
  install_id    text unique per user   -- the EA's stable fingerprint
  api_key       text unique            -- THE credential; never expires, rotatable
  label         text                   -- "Home PC", "VPS-1"
  status        text                   -- active | revoked
  last_seen_at  timestamptz
```

Then the ingest path becomes three unambiguous steps with no fallbacks:

```text
x-api-key ──► mt5_installs (status = active)  ──► user_id        [401 only if key unknown/revoked]
install_id + broker login ──► accounts row     ──► route event   [auto-create if absent]
account archived?                              ──► still ingest, just hidden in the UI
```

Consequences, each of which kills a class of edge case:

- **Archiving an account never breaks ingestion.** Archive is a *display* decision (`is_active`), not an auth decision. Data keeps landing; the account simply doesn't show in pickers until you unarchive.
- **Any new login on a known install is onboarded automatically**, inheriting broker, prop firm, UTC offset, DST profile, copier role and sync settings from its install — no setup token, no re-provisioning.
- **Setup tokens go back to being one job**: bootstrapping a *new install*. On first contact the token mints the `mt5_installs` row and its permanent key, then is consumed.
- **Revoking access is explicit and safe**: revoke or rotate the install key from the UI, which stops one terminal without touching any journal data.
- **Reinstall / new machine** = new install row, adopted against an existing one by broker login if you confirm it.

Migration is mechanical: create the table, backfill one row per distinct `(user_id, mt5_install_id)` from `accounts`, carry over the key currently in use so the EA keeps working with the config it already has, and keep `accounts.api_key` accepted as a legacy fallback (logged as deprecated) for one release.

## Step 3 — It must never go dark silently again

- Ingest distinguishes `unknown key`, `revoked install`, and `no account for login` in the response and logs, instead of one blanket "Invalid API key".
- A `Connection health` strip on Accounts/Journal driven by `mt5_installs.last_seen_at`: green when heartbeating, amber when quiet > 30 min, red with a specific reason and a one-click fix when events are being rejected. A rejected event today produces *no* UI signal at all — that's why this ran for five weeks.
- Accounts page: "Delete" becomes **Archive**, with archived accounts listed and restorable in place.
- New logins detected on an install surface as a "New account detected — 138740" card rather than appearing silently.

## Scope check

Is all of it necessary? Step 1 is required today. Step 2 is one table and roughly a hundred lines across two edge-function files — smaller than the pile of conditionals needed to cover the same edge cases, and it removes the auth ambiguity permanently. Step 3 is the part that turns a five-week silent outage into a five-minute one; I'd not skip it, but it can ship after Step 2 if you want the feed proven first.

## Technical notes
- Touches: new `mt5_installs` migration + backfill, `supabase/functions/_shared/apiKey.ts`, `_shared/accountResolver.ts`, `copier-setup-token`, `sync-account-state`, `src/hooks/useAccounts.tsx`, `src/pages/Accounts.tsx`, plus a health banner component.
- The MQL5 EA needs no change — it already sends `install_id` and `account_info.login`, and keeps using the same key value.
- `mark_dormant_accounts()` only touches `live_state`; it is not involved.
- Adds a roadmap entry: "install-scoped MT5 credentials + connection health".

## Verification
- Two consecutive heartbeats ingest cleanly; `mt5_installs.last_seen_at` is current.
- An active account exists for login `138740` with settings inherited from the install.
- Archiving an account, then trading on it, still ingests — the trades appear when it's unarchived.
- A bogus key returns `unknown key`, a revoked install returns `revoked`, and both raise the red health strip.
- Trades from 27 Jul onward appear after the resync.
