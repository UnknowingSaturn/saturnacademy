# Two-part fix: dashboard math + EA history backfill

## Background

Two independent problems were conflated:

- **Dashboard chip = 0%** for accounts whose week-to-date P&L is already baked into `equity_current` (because the baseline resolver falls back to `equity_current`, which is the end of the period, not the start).
- **76034 / 86021 missing trades** — those trades were placed under an older EA build (< v4.00) that didn't emit `DEAL_ENTRY_IN/OUT`, so the backend has no record. No dashboard math can fix this; the events need to be replayed from MT5 history.

The infrastructure for replay already exists: `TradeJournalBridge.mq5` v4 runs `RunCatchupCycle()` every ~5 min, asking `sync-account-state` for `(last_event_time, last_deal_id, open_tickets)` and sending anything newer from `HistorySelect()`. It just won't reach back far enough on its own — when there's no watermark it falls back to `TimeCurrent() − 90 days`, and when there *is* a watermark it starts from there, ignoring the user's configured `accounts.sync_history_from`.

## Plan

### Part A — Dashboard baseline formula (frontend only)

**File: `src/components/dashboard/EquityCurve.tsx`**

Replace the `current_equity` fallback with a **reconstruction**: when no pre-period snapshot exists and `balance_start` is 0, compute baseline as `equity_current − period_pnl_for_account`. This is the only honest answer — current equity minus what changed in the period equals what it was at the start.

Cascade becomes:

```text
baseline = pre_period_snapshot.balance
        ?? balance_start                       (if > 0)
        ?? equity_current − period_pnl         (reconstructed)
        ?? first_in_period_snapshot.balance
        ?? exclude from average
```

Drop the `if (!b0) return 0` swallow. Render excluded accounts as a neutral "—" chip; shrink the "across N accounts" subtitle to the included count.

**File: `src/pages/Dashboard.tsx`**

Compute `periodPnlByAccount: Record<string, number>` from `filteredTrades` and pass it into `EquityCurve` via `multiAccount`. Also fix `accountStartingBalance` to `sum(balance_start || equity_current || 0)` so the single-account fallback path stops underreporting.

**Files: `AccountCard.tsx`, `MultiAccountPicker.tsx`** — display fallback `balance_start || equity_current` (presentational only).

### Part B — EA history backfill on next connect

Goal: when a user upgrades to v4 EA on an account that has gaps, the catchup cycle replays trades all the way back to `sync_history_from` (per-account setting), not just the last 90 days.

**Step 1 — `supabase/functions/sync-account-state/index.ts`**

- Add `sync_history_from` to the account `SELECT` and to the response JSON.
- When `force_resync=true` (or `live_state='dormant'`), already returns `last_event_time=null` — keep that, and additionally return `replay_from = sync_history_from` so the EA has a concrete floor instead of guessing 90 days.

**Step 2 — `mt5-bridge/TradeJournalBridge.mq5` `RunCatchupCycle()` (line 605–670)**

- Parse `replay_from` from the response.
- Change the fromTime fallback (line 639):
  ```text
  fromTime = lastTime > 0 ? lastTime − 3600
           : replay_from > 0 ? replay_from
           : TimeCurrent() − 90 * 86400
  ```
- Bump `EA_VERSION` to `4.01` and include it in the heartbeat payload so the dashboard can show which version each terminal is on (helps the user spot stale installs in the future).

**Step 3 — UI: per-account "Resync history" action**

In `src/components/accounts/EditAccountDialog.tsx` (or `AccountCard` dropdown), add a "Resync history from MT5" button that:
- Sets `accounts.force_resync = true`
- Optionally lets the user override `sync_history_from` for this resync (defaults to existing value)
- Shows a toast "EA will replay history on next connect (~5 min)"

`sync-account-state` already clears `force_resync` after handling the resync, so this is one-shot.

### Part C — Cleanup of the two specific accounts now

After Part B ships, click "Resync history" on 70583, 76034, 76036, 86021. The EA will replay every closed deal since each account's `sync_history_from`. Idempotency key `{terminal_id}:{deal_id}:{event_type}` prevents duplicates with the 2 existing 86021 events.

### Out of scope (file as separate work)

- **Snapshot cross-attribution** (70561 ↔ 70583 heartbeat misrouting after MT5 login switch). Requires patching the heartbeat writer to use `active_login → account_id` instead of trusting `terminal_id` alone. Separate ingest-side fix.
- **Backfilling `balance_start`** on the 4 Hola accounts. The reconstruction baseline in Part A makes this unnecessary for the dashboard, but it'd still be a nice-to-have for the per-account cards.

## Files changed

- `src/components/dashboard/EquityCurve.tsx` — baseline cascade + chip rendering
- `src/pages/Dashboard.tsx` — `periodPnlByAccount` plumbing + `accountStartingBalance` fix
- `src/components/accounts/AccountCard.tsx` — display fallback
- `src/components/accounts/EditAccountDialog.tsx` — "Resync history" action
- `src/components/shared/MultiAccountPicker.tsx` — display fallback
- `supabase/functions/sync-account-state/index.ts` — return `replay_from`
- `mt5-bridge/TradeJournalBridge.mq5` — honor `replay_from`, bump to v4.01
- `public/TradeJournalBridge.mq5` — same (this is the downloaded copy)
