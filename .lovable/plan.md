
## Goal

When a Journal row that represents a multi-leg group is opened in the right-hand detail panel, the headline metrics currently show only the leader leg (e.g. −$377.52 for one of several TP/SL fills). We'll aggregate the group so the header chip, P&L, % of Account and Lots reflect the full position, add a new "Legs" section that lists each fill, and propagate qualitative edits (playbook, emotion, session, notes, screenshots, review) to every leg so the group stays consistent.

## Scope

In: `TradeDetailPanel`, `TradeProperties`, a new `useTradeGroup` hook, reuse of `aggregateGroup` from `useGroupedTrades.ts`, review/update mutation fan-out. Out: ingest, `group_key` derivation, backfill migrations, Dashboard / Pair Lab / Prop Firm, cumulative Entry/Exit/SL/TP/MFE/MAE (user chose headline-only).

## Changes

1. **Extract shared aggregator** — move the `aggregateGroup(legs) -> Trade` logic out of `src/hooks/useGroupedTrades.ts` into `src/lib/groupAggregate.ts` and import it back. No behavior change for the Journal table.

2. **New hook `useTradeGroup(tradeId)`** (`src/hooks/useTradeGroup.ts`)
   - Loads the base trade via existing `useTrade`.
   - If `trade.group_key` exists, fetches every trade sharing `user_id` + `group_key` from `trades` and orders by `entry_time`.
   - Returns `{ leader, legs, aggregate, isGroup }` where `aggregate` is the `aggregateGroup(legs)` result and `leader` is the earliest leg (matches Journal grouping). Non-grouped trades return `{ leader: trade, legs: [trade], aggregate: trade, isGroup: false }`.

3. **`TradeDetailPanel`**
   - Replace `useTrade(tradeId)` with `useTradeGroup(tradeId)`.
   - Header chip and title use `aggregate.net_pnl` and `leader.symbol` / `leader.entry_time` / `leader.trade_number` (badge already computes from `pnl`, no other change).
   - Pass both `trade={leader}` (for edit fields, playbook, review, screenshots — same as today) and `aggregate={aggregate}` and `legs={legs}` to `TradeProperties`.

4. **`TradeProperties`** — headline-only cumulative
   - Accept optional `aggregate` and `legs` props; default to `trade` when absent.
   - `net_pnl` row and `r_multiple_actual` (% of Account) row read from `aggregate.net_pnl`. Equity base still comes from the leader's account.
   - `Lots` row shows `aggregate.total_lots` with a `(N legs)` suffix when `legs.length > 1`.
   - Entry / Exit / SL / TP stay leader-only (user chose headline-only). When `legs.length > 1`, append a small "leader leg" muted hint next to Entry Price so it's clear these are per-leg.
   - New **Legs** collapsible section (only when `legs.length > 1`) under the existing Trade Details block: compact table with columns `#`, `Exit`, `Lots`, `P&L`, `R` for each leg (win/loss color on P&L, sorted by `exit_time` then `entry_time`). Row click is a no-op for now — this is read-only.

5. **Propagate edits to all legs** — `TradeProperties` currently calls `updateTrade.mutateAsync({ id: trade.id, ... })` for every field. Introduce a helper `updateGroupField(patch)` inside `TradeProperties` that, when `legs.length > 1`, issues one `updateTrade` per leg id for qualitative fields only: `playbook_id`, `actual_playbook_id`, `profile`, `actual_profile`, `actual_regime`, `session`, `emotion`, `account_id`, `entry_timeframe`, custom fields. Numeric/price fields (`sl_initial`, `tp_initial`, `entry_price`, `exit_price`, `total_lots`) stay leader-only. Review upserts (`useUpsertTradeReview`) and screenshots also fan out to every leg id so filters based on `trade_reviews` behave consistently. Comments stay leader-only.

6. **Cache** — `useTrade`'s existing query key stays. `useTradeGroup` uses key `['trade-group', tradeId]` and invalidates on any leg update by mapping every leg id back to its `['trade', id]` key plus `['trades']` (same invalidations `useUpdateTrade` already fires — no new logic needed as long as fan-out reuses the existing mutation).

## Technical notes

- `aggregateGroup` already produces summed `net_pnl`, summed `total_lots`, weighted price averages, cumulative R, earliest entry / latest exit, and `is_open = any leg open`. We reuse it verbatim; nothing new to compute.
- % of Account for a group uses `sum(net_pnl) / equity_at_entry(leader)`. Equity snapshot at entry is captured once per position idea, so the leader's value is the correct denominator.
- The Legs section pulls `net_pnl`, `exit_price`, `total_lots`, `r_multiple_actual`, `exit_time` directly from each leg row — no extra query.
- Fan-out on edit is sequential `Promise.all(legs.map(...))`; typical group size is 2–4 legs, so latency is negligible.

## Verification

- Open trade #468 (the GBPUSD group in the screenshot): header chip and P&L row show the summed P&L across all legs, Lots shows `sum (N legs)`, new Legs section lists each fill with its own exit / P&L / R.
- Open a single-leg trade: panel looks identical to today (no Legs section, no `(N legs)` suffix).
- Change Emotion → NY AM on a grouped trade, reopen a sibling leg's detail directly: the new emotion is present on that leg too.
- Existing `useGroupedTrades` unit tests still pass after the aggregator move.
