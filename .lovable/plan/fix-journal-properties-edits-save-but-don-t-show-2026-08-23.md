# Fix: journal Properties edits save but don't show

## What's actually happening

Your edits **are** saving. I checked trade #460 in the database: `profile = reversal`, `actual_regime = rotational`, last written at 14:30 UTC today. The toast is telling the truth — the panel just never re-reads the row afterwards, so it keeps showing the old (empty) state until a full page reload.

Cause: the trade detail view loads the trade's legs through a separate cached query (`trade-group`). The cache-refresh helper that runs after every trade edit refreshes the list, open, archived and single-trade caches — but never the group cache. Trade #460 has a `group_key`, so the panel renders from the stale group copy.

A second, smaller bug in the same path: when an edit clears the HTF/Entry timeframe multi-selects, the update builder skips the field unless it is truthy, so clearing those two fields silently does nothing.

## The fix

1. `src/hooks/_shared/tradeQueries.ts`
   - Add a `group` key to `tradeKeys`.
   - In `invalidateAllTradeCaches`, invalidate the whole `["trade", *]` namespace and the `["trade-group", *]` namespace, so a leg edit refreshes the leader, every sibling leg, and the aggregate.

2. `src/hooks/useTrades.tsx` (`useUpdateTrade`)
   - Change the `alignment` / `entry_timeframes` guards from truthiness to `!== undefined`, so clearing a multi-select persists.

3. Verification
   - Edit Profile / Regime / Timeframes on a grouped trade in the preview and confirm the badge updates immediately without a reload, and that clearing a timeframe sticks.

No schema changes, no changes to how edits fan out to group legs — that logic is already correct.
