## Problem
The Journal page shows a "N accounts awaiting next login" banner listing dormant accounts. This duplicates the **Dormant** badge already rendered per account on the Accounts page (`AccountCard` → `LiveStateBadge`), and it's not actionable from the Journal context.

## Changes

### 1. `src/components/journal/DriftTray.tsx`
- Remove the entire `dormant.length > 0` Alert block (lines ~194–250).
- Stop fetching/tracking dormant accounts state in the component (drop `dormant` state, related `setDormant` calls, and the `repairAccount` handler if it becomes unused).
- Keep the two trade-level alerts (`login_switched`, `likely_broker_closed`) — those belong on Journal because they're about trades.
- Update the early-return: `if (drift.length === 0) return null;`

### 2. `src/components/accounts/AccountCard.tsx`
- When an account is `dormant` AND has `pending_repairs > 0`, show a small inline "N awaiting repair" pill next to the LiveStateBadge with a "Repair" button that calls the existing `trade-repair` edge function (`action: "repair", account_id`). This preserves the only actionable piece of the removed banner, in the right place.
- Reuse the existing repair-invocation pattern from DriftTray (toast + invalidate accounts query).

### 3. `src/components/accounts/LiveStateBadge.tsx`
- No change needed — the "Dormant" tooltip already says "log into {account} in MT5 to reconnect", which matches the messaging we're removing from Journal.

## Out of scope
- No changes to the `trade-repair` edge function or DB schema.
- No changes to the Dashboard route.
