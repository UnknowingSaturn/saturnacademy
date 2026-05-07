## Diagnosis: R-multiple wrong on partially-closed trades

EURUSD ticket 3104747 stored R = **0.74**, should be ~**1.84**.

The bug: `computeRMultiple` derives `$/point/lot` from `grossPnl / (priceMove × lots)` where `priceMove = exitPrice - entryPrice`. On a multi-fill exit it uses **only the final exit price** but `grossPnl` includes **all fills**.

For this trade:
- entry 1.17672, SL 1.17626 → stop = 0.00046 (4.6 pips)
- partial: 12.5 lots @ 1.17768 → +96 pts × 12.5 = 1,200 pt-lots, +$1,200
- final: 3.0 lots @ 1.17706 → +34 pts × 3 = 102 pt-lots, +$102
- True $/pt/lot = 1302 / 1302 = **$1.00** → risk = 0.00046 × 15.5 × ($1/0.00001) = **$713** → R = 1311/713 ≈ **1.84**
- Buggy: priceMove uses final only (34 pts × 15.5 = 527 pt-lots) → $/pt/lot = 1302/527 ≈ $2.47 → risk inflated → R deflated to 0.74

## Fix

Change `computeRMultiple` to sum `priceMove × lots` over **all fills** (partial closes + final exit). Apply identical fix in both edge functions.

### `supabase/functions/ingest-events/index.ts`
1. Add optional `fills?: Array<{price, lots}>` param to `computeRMultiple`.
2. Build allFills = `partial_closes` (skip repair markers) + final `{exit_price, remaining_lots}`. Sum `Σ(price - entry) × dirSign × lots` to get total point-lots. Derive `$/pt/lot = grossPnl / totalPointLots`.
3. At the full-close call site (around line 848), pass `fills: existingTrade.partial_closes`.
4. Orphan-exit branch (line 745) keeps current behaviour (single fill).

### `supabase/functions/reprocess-trades/index.ts`
- Same change to its `computeRMultiple` (line 98).
- Pass `fills: trade.partial_closes` at the call site (line 237).

### Backfill
After deploy, invoke `reprocess-trades` for each account to recompute stored `r_multiple_actual` on existing trades with partials.

## Files
- `supabase/functions/ingest-events/index.ts`
- `supabase/functions/reprocess-trades/index.ts`

No DB schema or UI changes needed.
