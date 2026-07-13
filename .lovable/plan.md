## Goal
Make each grouped (multi-TP) row in the Journal fully self-contained and cumulative, and remove the sticky totals bar above the table.

## Changes

### 1. Remove the sticky totals bar
- Delete `JournalTotalsBar` import and render in `src/pages/Journal.tsx`.
- Delete the file `src/components/journal/JournalTotalsBar.tsx`.

### 2. Cumulative R on grouped rows (`useGroupedTrades.ts`)
- Replace the lot-weighted R calculation with a **sum of leg R-multiples** for grouped rows:
  - Example: TP1 +1R, TP2 +2R, SL −1R → row shows `+2.00R`.
- Single-leg rows: unchanged (still their own R).
- Open groups: still `null` (no R until legs close).
- Update unit tests in `groupedTrades.test.ts`:
  - Change the 3-leg aggregation expectation from weighted mean to `1 + 2 + 3 = 6R`.
  - Add a mixed-outcome test asserting summed R across win + loss legs.

### 3. Result cell: W/L split + net $ (`TradeTable.tsx`)
- In `getResultBadge`, for `outcome_mix === "mixed"`:
  - Label becomes `"{W}W / {L}L · {±$net}"`, e.g. `"1W / 1L · +$60.00"`.
  - Include BE count only when present: `"1W / 1L / 1BE · −$12.34"`.
  - Tone still driven by net P&L sign (profit / loss / breakeven).
- Non-mixed grouped rows keep the existing Win / Loss / BE label but continue to render summed P&L (already correct via `useGroupedTrades`).

### 4. Fix the "N legs" badge overlap (`TradeTable.tsx`)
- In the Pair cell for grouped rows, the `"N legs"` chip currently renders on top of the BUY/SELL badge (visible in the screenshot as `BUYegs` / `SELLegs`).
- Restructure to a horizontal flex row: `[SYMBOL] [BUY/SELL] [N legs]` with `gap-1.5` and `whitespace-nowrap` on the chip so nothing overlaps.

### 5. Journal result filter (`Journal.tsx`)
- No behavior change needed — the existing "Win"/"Loss" filter already uses `legs_win`/`legs_loss`, so mixed groups keep appearing under both.

## Out of scope
- No changes to ingest, grouping keys, or the backfill migration.
- Pair Lab / Prop Firm / Dashboard continue to consume per-leg rows (unchanged).
- No new columns or DB writes.

## Verification
- `bunx vitest run src/lib/__tests__/groupedTrades.test.ts` — updated + new mixed-R test passes.
- Manual on `/journal`: confirm (a) totals bar gone, (b) grouped rows show `"2 legs"` next to BUY/SELL without overlap, (c) mixed groups show `"1W / 1L · +$X"`, (d) RR column on a 2-leg TP1+SL group equals the arithmetic sum of the two leg Rs.
