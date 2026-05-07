## Diagnosis

For your EURUSD trade (ticket 3104747):

| Field | Value | Source |
|---|---|---|
| `original_lots` | 15.5 | open event |
| `partial_closes[0]` | 12.5 lots @ 1.17768, +$1,200 | partial_close event |
| `exit_price` | 1.17706 | **final close only** |
| `exit_time` | 13:01:06 | **final close only** |
| `gross_pnl` | $1,302 (= 1200 + 102) | aggregated ✓ |
| `net_pnl` | $1,311 | aggregated ✓ |

**The data is correct.** The aggregation in `ingest-events` already sums all partial-close PnL into `gross_pnl` / `net_pnl`. The problem is purely in how the trade is **displayed** — every UI surface shows only the single `exit_price` / `exit_time`, so it looks like only the 3-lot close registered. Partial closes live in a JSONB column nothing reads.

The best fix is to surface the full close timeline and a weighted-average exit price, so a multi-fill exit is visible everywhere.

## Plan

### 1. Compute helpers in `src/lib/tradeMath.ts` (new file)
```ts
export interface CloseFill { time: string; lots: number; price: number; pnl: number; }
export function getAllCloseFills(trade: Trade): CloseFill[]
   // partial_closes[] (skip repair markers) + final close (exit_price/exit_time/last lots)
export function getClosedLots(trade: Trade): number
export function getWeightedAvgExitPrice(trade: Trade): number | null
   // Σ(lots * price) / Σ(lots) across all fills
```
Filter out the `repaired_from_snapshot` marker rows already in `partial_closes`.

### 2. New detail field `closes` (Close Timeline)
- Add to `DETAIL_FIELD_CATALOG` in `src/types/settings.ts` with `key: 'closes'`, label "Closes".
- Render in `TradeProperties.tsx`: a compact list, one row per fill:
  `12.5 lots @ 1.17768 → +$1,200  (12:50:22)`
  ` 3.0 lots @ 1.17706 → +$102    (13:01:06)`
- Hidden by default for trades with only a single fill.
- Add to `DEFAULT_DETAIL_VISIBLE_FIELDS` so it shows automatically when partials exist.

### 3. Show "Avg Exit" alongside `exit_price`
- In `TradeProperties.tsx` exit-price row: if `partial_closes.length > 0` (excluding markers), show both
  `Final: 1.17706` and `Avg: 1.17756` with a small "(2 closes)" badge.
- Same treatment in any TradeTable column that renders `exit_price`.

### 4. Show partial-close indicator in `TradeTable`
- Add a small badge / icon next to `original_lots` (or in the Result column) when `partial_closes` has real fills, so the journal list makes multi-fill trades obvious.

### 5. Use weighted avg for derived stats that currently use `exit_price`
Audit and update any place that consumes `exit_price` for analytics:
- `r_multiple_actual` is already computed from aggregated PnL, not exit price → no change.
- TradingView chart marker: continue using final `exit_price` (it's the close that flattened the position) but additionally plot markers for each partial close fill on the chart.
- Reports / equity curve already use `net_pnl` → no change.

### 6. Fix one schema gap (optional, recommended)
`partial_closes` rows should always include `commission` and `swap`. Currently only the final close's commission is captured (we lose commission on each partial). Update `ingest-events`:
- Push `commission: event.commission, swap: event.swap` into the partial_closes array.
- In the full-close branch, sum these too instead of only `existingTrade.commission`.
This keeps `gross_pnl` and `net_pnl` accurate when the broker charges per-fill commission.

### 7. Backfill nothing
Existing trades' totals are already correct (verified for ticket 3104747). The new UI just renders existing JSONB data — no migration or reprocess needed.

## Files

- New: `src/lib/tradeMath.ts`
- `src/types/settings.ts` (add `closes` field def + default visibility)
- `src/components/journal/TradeProperties.tsx` (Closes row, dual exit price)
- `src/components/journal/TradeTable.tsx` (multi-fill indicator, optional dual exit in column)
- `src/components/chart/TradingViewChart.tsx` (extra markers per partial fill)
- `supabase/functions/ingest-events/index.ts` (capture commission/swap per partial)

## Out of scope
- Editing partial closes manually (not a current need; keep MT5 as source of truth).
- Reconstructing partial_closes for old trades that arrived as a single orphan exit — those are aggregated by the broker and not recoverable.
