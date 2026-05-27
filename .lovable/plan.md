## What's actually happening

The Weekly Performance widget is mathematically reading all 5 accounts — the headline `-$3,391.05` does sum P&L across every account. The misleading part is the per-account chips: 4 of 5 accounts show `+0.0%`, and that drags the "avg" down to `-1.18%` so it looks like only one account contributed.

### Verified against the database (current week)

| Account | Closed trades | Net P&L | `balance_start` | Chip shown |
|---|---|---|---|---|
| 70561 | 5 | **-$1,849.51** | 49,979.18 | -5.9% |
| 70583 | 0 | 0 | **0.00** | +0.0% |
| 76034 | 0 | 0 | **0.00** | +0.0% |
| 76036 | 0 | -$2,467 of balance drift | **0.00** | +0.0% |
| 86021 | 2 | **-$1,503.32** | **0.00** | +0.0% |

Two accounts (86021 and 76036) really did move — 86021 lost $1.5k in trades, 76036 lost ~$2.5k in balance — but their chips are reported as 0%.

## Root cause

`EquityCurve.tsx` (lines 41-65) computes each account's baseline as:

```text
base = pre_period_snapshot?.balance ?? account.balance_start ?? 0
```

Then guards the per-account % with `if (!b0) return 0`. For prop-firm accounts auto-created without an explicit starting balance (every Hola Prime account except 70561 has `balance_start = 0`), the baseline becomes 0, the guard kicks in, and the chip is silently `+0.0%` regardless of what actually happened to the balance. The "average % return across 5 accounts" then divides by 5 even though 4 denominators are bogus.

`Dashboard.tsx` line 41 has the same flaw: `accountStartingBalance` sums `balance_start || 0`, so the fallback path of `periodStartingBalance` (used by single-account mode) also undercounts when some accounts have no recorded start.

## Other affected spots

- `src/pages/Dashboard.tsx:41` — `accountStartingBalance` (drives single-account fallback baseline).
- `src/components/accounts/AccountCard.tsx:118` — renders `$0` for any account where `balance_start` is unset.
- `src/components/shared/MultiAccountPicker.tsx:86` — hides balance entirely when `balance_start` is falsy.
- `StartLiveTradeDialog.tsx` and `ManualTradeForm.tsx` already do the safer `balance_start || equity_current` fallback — keep them as the reference pattern.

## Side observation worth flagging (not in scope of this fix unless you want it)

For account 70561 the snapshot stream this week contains a dip to `47,026.89`, which is the exact current balance of sibling account 70583. That looks like the Master EA writing a different login's balance against 70561 after an MT5 session switch on the same install. It's the same family of cross-attribution problem that `repair-snapshot-closed` already handles for deals, just on the heartbeat path. Worth filing but not what's driving the visible "only 1 account" symptom.

## Plan

### 1. Robust baseline resolution in `EquityCurve.tsx`

Replace the baseline resolver with a 4-step fallback:

```text
baseline = pre_period_snapshot.balance
        ?? account.balance_start (if > 0)
        ?? account.current_balance (if > 0)   // equity_current
        ?? first_in_period_snapshot.balance
```

Track which accounts had to fall back to "first in-period snapshot" so the % is still meaningful (delta vs first observed point in the period). Drop the `if (!b0) return 0` swallow — if we still can't establish a baseline, exclude that account from the average and the chip rather than silently emitting 0%.

### 2. Honest "avg" denominator

Compute the average % only over accounts with a usable baseline. If an account is excluded (no baseline at all), render its chip as a neutral "—" with a tooltip ("No starting balance set") instead of `+0.0%`, and shrink the "across N accounts" subtitle to reflect the count actually included.

### 3. Same fallback in `Dashboard.tsx`

Change `accountStartingBalance` to `sum(balance_start || equity_current || 0)` so the single-account fallback path of `periodStartingBalance` doesn't underreport when some selected accounts have no recorded start.

### 4. Minor: AccountCard / MultiAccountPicker

Use `balance_start || equity_current` for display fallback so the cards don't show `$0` on auto-created accounts. Pure presentational, no logic change.

### Files to touch

- `src/components/dashboard/EquityCurve.tsx` — baseline resolver + chip rendering + avg denominator
- `src/pages/Dashboard.tsx` — `accountStartingBalance` fallback
- `src/components/accounts/AccountCard.tsx` — display fallback
- `src/components/shared/MultiAccountPicker.tsx` — display fallback

### Out of scope

- EA snapshot cross-attribution (70561 ↔ 70583 dip). Happy to do it next if you want, but it's a separate ingest-side fix.
- Backfilling `balance_start` on existing accounts (could be a one-shot data migration if you'd rather fix it at the source).
