
## Goal

Ensure every "% of Account" / balance-derived display uses the **balance of the account that the trade belongs to** — never a mixed/global balance or another account's number.

## Findings

1. **`accounts` table has no `balance_current` column** — only `balance_start` and `equity_current`. The current fallback in `TradeProperties.tsx` references `tradeAccount.balance_current`, which is always `undefined`. Silent dead code.
2. **`TradeProperties` "% of Account"** primary path already uses the trade's own `equity_at_entry` → `balance_at_entry` (per-trade, per-account, correct). Only the fallback chain is wrong.
3. **Dashboard `periodStartingBalance`** (`src/pages/Dashboard.tsx` lines 70–96) picks the earliest trade's `balance_at_entry` across **all selected accounts** and sums P&L from all of them. When >1 account is selected, the `EquityCurve` switches to its multi-account % mode and ignores this value, so it's fine. When exactly 1 account is selected, the chosen trade is by definition from that account — also fine. No change needed here, but worth a comment.
4. **`useTrades` / `tradeTransform`** already expose `balance_at_entry` and `equity_at_entry` on `Trade`. The `(trade as any)` casts in `TradeProperties.tsx` are unnecessary.

## Changes

### `src/components/journal/TradeProperties.tsx` (lines 229–256, `case 'r_multiple_actual'`)

Replace the equity-base fallback chain so it strictly resolves to the trade's own account:

```
equityBase =
  trade.equity_at_entry
  ?? trade.balance_at_entry
  ?? tradeAccount?.equity_current       // current equity of THIS trade's account
  ?? tradeAccount?.balance_start        // static starting balance of THIS trade's account
  ?? null
```

- Drop the broken `balance_current` reference.
- Drop the `(trade as any)` casts (typed fields exist).
- Keep the rest of the row (label "% of Account", colors, formatting) unchanged.
- If `equityBase` is still null OR `<= 0`, render `—` (already the case).

### No other files change

- `EquityCurve` multi-account mode is already per-account (uses `baselines[a.id]`, `periodPnlByAccount[a.id]`).
- `Dashboard` single-account path is correct by construction.
- No schema, edge function, or data backfill changes — all 387 trades already have `balance_at_entry` populated.

## Out of scope

- Adding a "planned risk %" display.
- Backfilling `equity_at_entry` for the 51 older trades missing it (they already fall back to `balance_at_entry`).
- Changing labels elsewhere (Journal table, calendar).
