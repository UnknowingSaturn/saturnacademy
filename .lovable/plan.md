# Decouple the Pair Lab simulator from accounts

## Problem

Today `usePairLab` reads `balance_start` and `prop_firm` from the currently selected account (`useAccount(selectedAccountId)`), and aggregates `balance_start` across `useAccounts()` in all-accounts mode. When you delete a failed challenge:

- The trades stay (good — your R-based stats are still valid).
- The account row is gone, so the simulator loses balance + prop-firm context.
- Aggregate balance silently shrinks, which distorts $ replay and Kelly sizing.
- Prop-firm verdict disables because no firm is attached to the (now-missing) account.

Tying simulation to a mutable, deletable row is the wrong coupling. R is a property of the trade; balance and risk caps are a property of *how you want to evaluate going forward*, not of historical accounts.

## Approach: a user-level "Simulator Profile"

Introduce a single per-user simulator config that the Pair Lab (and any future simulator) reads from. It is independent of `accounts` and survives any account deletion.

Stored on `user_settings` (already exists, no new table needed):

- `sim_balance` — notional balance used to convert R → $ (e.g. 100,000)
- `sim_prop_firm` — optional firm key (FK to `prop_firms.id`), nullable
- `sim_risk_per_trade_pct` — default 1
- `sim_hard_cap_pct` — default 2
- `sim_source` — `'manual' | 'active_account'` (default `'manual'`)

When `sim_source = 'active_account'`, the simulator falls back to the currently selected account's balance + firm (today's behavior) — so users who want the old wiring keep it. When `'manual'` (default for new users with no live account), it uses the explicit values above and is fully independent of `accounts`.

## UI

Small "Simulator settings" popover on the Pair Lab Simulator tab header:

- Balance input (numeric, with $)
- Prop-firm select (None / pick from `prop_firms`)
- Risk per trade % + hard cap %
- Source toggle: "Use active account" / "Manual"
- "Save as default" button

State persists to `user_settings` so it survives reloads and is the same across sessions.

The existing all-accounts aggregate balance and the "No account balances found" empty state both go away — replaced by the manual balance, which always has a sensible default (100,000) for new users.

## Cleanup

- Remove `accountsQuery` aggregation and `isAllAccounts ? aggregateBalance : ...` branching from `usePairLab`.
- Remove the "Prop-firm verdict disabled in all-accounts mode" warning and the "No account balances found" empty card from `PairLab.tsx`.
- Keep `useAccount` only as the optional source when `sim_source = 'active_account'`.
- Update `PageIntroBanner` body: no longer reference "the active account's daily drawdown budget" — say "your simulator profile."

## Technical details

1. **Migration** — `user_settings` add columns:
   - `sim_balance numeric not null default 100000`
   - `sim_prop_firm text` (nullable, references `prop_firms.id` loosely — no FK to keep it soft)
   - `sim_risk_per_trade_pct numeric not null default 1`
   - `sim_hard_cap_pct numeric not null default 2`
   - `sim_source text not null default 'manual' check (sim_source in ('manual','active_account'))`
   No new RLS — existing `user_settings` policies cover it. No GRANTs needed (table already granted).

2. **Hook refactor** — `usePairLab`:
   - Read `user_settings` for the five sim_* fields.
   - Build `propFirm` from `sim_prop_firm` + `prop_firm_rules` when set, regardless of accounts.
   - Drop `aggregateBalance`. `accountBalance` becomes `simBalance` (rename in `PairLabData`).
   - `isAllAccounts` stays for trade-scoping (it still controls which trades feed the buckets) but no longer gates prop-firm verdict.

3. **New component** — `SimulatorProfileSettings.tsx` (popover trigger on the Simulator tab) with the five inputs and a Save button that updates `user_settings`.

4. **Component prop renames** — `StrategyRanker` / `StrategyCompare` `balance` prop already takes a number; just feeds from the new source.

## Files touched

- `supabase/migrations/<ts>_sim_profile.sql` — new
- `src/hooks/usePairLab.tsx` — refactor balance + propFirm sourcing
- `src/pages/PairLab.tsx` — remove aggregate/empty-state branches, mount new settings popover
- `src/components/pair-lab/SimulatorProfileSettings.tsx` — new
- `src/types/...` if `UserSettings` type is locally mirrored (otherwise the auto-gen types pick it up)

## Out of scope

- Per-trade balance reconstruction from historical `equity_current` snapshots (possible later, but unnecessary for an R-based simulator).
- Backfilling `sim_balance` from existing accounts (default 100k is fine; user adjusts once).
