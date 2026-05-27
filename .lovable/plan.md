## Goal

Make balance and equity-curve display correct and meaningful when a user has multiple MT5 accounts (across one or more terminals).

## Model (what gets recorded)

**Per-account balance time series — authoritative from EA heartbeat.**

1. New table `account_balance_snapshots`:
   - `account_id`, `user_id`
   - `balance`, `equity`, `margin`, `free_margin`
   - `recorded_at` (timestamptz), indexed `(account_id, recorded_at desc)`
   - Insert one row per heartbeat (already arriving every 5–10 min via `ingest-events` and `sync-account-state`). Dedup by rounding to nearest minute to avoid bloat.
2. Keep `accounts.balance_start` (existing) as the per-account anchor for "% return" math, and continue updating `accounts.equity_current` / `last_heartbeat_at` on every heartbeat for fast display.
3. `terminal_snapshots` stays as-is (it's terminal-level, not per-account financial history).

This means deposits, withdrawals, prop-firm payouts, and trading P&L are all reflected automatically because we snapshot what MT5 reports.

## Display rules

**Header cards (Total P&L, Win Rate, Profit Factor, Avg R, Trades, Days):**
Always aggregate across selected accounts (sum for $ and counts, weighted average for ratios). Current behavior — no change.

**Performance chart (`EquityCurve`):**
- **1 account selected →** $ balance curve from `account_balance_snapshots` for the period (real broker balance, includes cash movements). Falls back to computed `starting + Σ net_pnl` if no snapshots yet.
- **>1 account selected →** switch Y-axis to **% return**. For each account, compute `(balance_t − balance_period_start) / balance_period_start * 100`, then plot the **equal-weighted average** as the main line. Add small per-account contribution chips below the headline P&L number showing each account's $ delta.
- Headline number stays in $ (sum of P&L deltas) — traders want to see money. Subtitle shows aggregate % return.
- "Last period" comparison uses the same metric (% vs %, $ vs $).

## Files to change

1. **Migration** — create `account_balance_snapshots` table with RLS (user owns via account_id → accounts.user_id) and dedup index.
2. **`supabase/functions/ingest-events/index.ts`** — when a heartbeat/snapshot with `account_info.balance` arrives, insert a snapshot row (rounded to minute, ON CONFLICT DO NOTHING).
3. **`supabase/functions/sync-account-state/index.ts`** — same insert on connect/heartbeat path.
4. **`src/hooks/useBalanceHistory.tsx`** (new) — fetch snapshots for selected accounts + period, return either single-account series or normalized multi-account series.
5. **`src/components/dashboard/EquityCurve.tsx`** — accept `mode: 'dollar' | 'percent'`, accounts list, and snapshot data; render accordingly. Add per-account contribution chips.
6. **`src/pages/Dashboard.tsx`** — wire selected accounts from `AccountFilterContext` into the new hook, pass mode based on selection count.

## Edge cases

- New account with no snapshots yet → fall back to computed curve from trades.
- Account with snapshots but no trades in period → flat line, still contributes 0% to average.
- Mixed currencies across accounts → out of scope for now; assume USD (add a TODO note; flag in UI if `accounts.broker` currency differs).

## Out of scope

- Deposit/withdrawal explicit tagging (we infer from balance jumps that don't match trade P&L — can add a "cash movement" overlay later).
- Per-account small-multiples chart (can add as a toggle later).
- Currency conversion across accounts.
