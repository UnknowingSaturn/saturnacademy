## Current state

Grouping is working at the data layer:
- 7 groups already tagged in DB (2–3 legs each) via `group_key` + `group_role`.
- `useGroupedTrades` collapses siblings into one leader-shaped row with aggregated fields (lot-weighted VWAP entry/exit, summed net P&L, summed gross P&L, summed commission/swap, weighted R-multiple, latest exit_time, aggregate is_open).
- `Journal.tsx` feeds grouped rows to the table by default.

What's missing (why it doesn't *look* grouped and why totals feel incomplete):
1. `TradeTable` has no awareness of `legs` / `isGrouped` — no badge, no expand chevron, no per-leg breakdown. A 3-leg group renders as a single row that silently *hides* its own legs.
2. There is no cumulative totals row on the Journal page (net P&L, gross, R, wins/losses, commission, avg R) for the filtered set.
3. Aggregation counts a mixed-outcome group (e.g. TP1 win + BE + SL loss) as one row — so win/loss chips undercount actual leg outcomes. The user wants both leg outcomes visible on the group.
4. Pair Lab / Prop Firm / Dashboard still consume raw per-leg rows, so metrics diverge between Journal and the rest of the app.

## Plan

### 1. Make the group row show "both outcomes"
- In `useGroupedTrades.aggregate()` add derived fields on the aggregate row:
  - `leg_count`, `legs_win`, `legs_loss`, `legs_be`, `legs_open`
  - `outcome_mix`: `'all_win' | 'all_loss' | 'mixed' | 'open'`
  - Keep summed `net_pnl` as the single "group result" number (that already sums TP1 + SL etc. correctly — verified against the aggregation logic).

### 2. TradeTable: visible grouping + expand
- Detect `row.isGrouped` and render:
  - A small `"3 legs"` badge next to symbol.
  - A chevron that expands an inline sub-table of legs (`row.legs`), each showing its own entry/exit/lots/net P&L/R.
  - Result column shows a compact mix badge when `outcome_mix === 'mixed'` (e.g. `2W / 1L`) instead of a single win/loss dot.
- P&L column keeps the summed number; hover tooltip lists per-leg P&Ls.
- No schema change. `legs` is already attached by the hook.

### 3. Cumulative totals bar on Journal
- Add a sticky summary strip above `TradeTable` reading from `filteredTrades`:
  - Trades (groups) · Legs (sum of leg_count) · Net P&L · Gross P&L · Commission · Swap · Total R · Avg R · Wins · Losses · Break-even · Open
  - Wins/Losses are computed **at leg granularity** so a mixed group contributes correctly (a TP1 win and an SL loss show up as +1 win, +1 loss). This is the "cumulative of both outcomes" the user asked for.
- Respects all current filters (period, symbol, session, result, model, advanced filters).

### 4. Result filter: interpret at leg level
- Today `resultFilter = 'win'` filters on `net_pnl > 0` of the aggregate, which hides mixed groups. Change to: include a group if **any leg** matches (win/loss/open). Prevents mixed groups from disappearing when the user clicks "Wins".

### 5. Consistency with rest of app (opt-in, no behaviour change yet)
- Export `groupTrades` for reuse. Add a shared `useJournalTrades({ grouped })` wrapper so Pair Lab / Prop Firm / Dashboard can opt in later without duplicating logic.
- **Not** switching those pages in this pass — call it out in the summary so the user can decide when to flip them. Their current per-leg math is still numerically correct; only the row count and per-trade averages differ.

### 6. Verification
- New unit tests in `groupedTrades.test.ts`:
  - Mixed outcome group returns `legs_win=1, legs_loss=1, outcome_mix='mixed'` and summed P&L equals leg sum.
  - All-open group returns aggregate `is_open=true`, `net_pnl=null`.
  - Standalone rows: `leg_count=1`, `outcome_mix` matches the trade's own result.
- Manual: open Journal on `/journal`, confirm the 2-leg + 3-leg groups render as one row with badge + expand, and the totals bar reconciles with `SELECT sum(net_pnl)` on the filtered window.

## Explicit non-goals
- No changes to ingest, `group_key` derivation, or backfill logic — grouping data is already correct.
- No merging or destructive edits to leg rows; each leg remains individually editable.
- No changes to Pair Lab / Prop Firm / Dashboard math in this pass.
- No new columns on `trades`; all new fields are derived client-side.

## Technical notes
- `outcome_mix` is derived per group from `legs.filter(l => l.trade_type === 'executed')`; idea/paper legs are excluded from win/loss counts but still show in the expanded view.
- Break-even threshold reuses the existing per-symbol epsilon from J4 (`|net_pnl| < epsilon` → BE).
- Totals bar uses `useMemo` keyed on `filteredTrades` — O(n) over already-filtered set, safe for thousands of rows.
- Expand state lives in `TradeTable` local state keyed by group row id; no URL persistence to avoid noisy history.