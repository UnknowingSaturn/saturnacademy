## Diagnosis

Trade #379 (NASUSD, ticket 5681494, 3.93 lots) had two real closes:

- 14:25 — 2.0 lots @ 29196.80 → **+$346.40** (deal 5161419)
- 14:45 — 1.93 lots @ 29055.10 → **+$60.80** (deal 5164091)

Expected total ≈ **+$407.20**. The journal shows only **+$60.80** and `r_multiple_actual = 0.17` (computed from the last fill only). The `trade_partial_fills` table is empty for this trade.

Why this happened (from the `events` table):

1. The EA emitted **two events for the partial fill** at 14:25 — one with `event_type=partial_close` and one with `event_type=close`, both same deal_id 5161419, same lots/profit. The ingest idempotency key let them both through.
2. The exit branch in `tradeEventProcessor.ts` ran twice on those two events. The first reduced `total_lots` 3.93 → 1.93. The second saw `remainingLots = 1.93 - 2.0 < 0.001`, took the **full-close path**, queried `trade_partial_fills` (still empty due to race / upsert dedup), wrote `net_pnl = 346.40`, and set `total_lots = 0` / `is_open = false`.
3. The real final close at 14:45 then re-entered the exit branch on an already-closed trade, hit the full-close path again, queried `trade_partial_fills` (empty), and **overwrote `net_pnl` with 60.80**, losing the 346.40 forever.

So two real bugs:

- **A.** Partial-fill deal events can be duplicated (`partial_close` + `close` for the same `deal_id`), and dedup is per `idempotency_key` not per `(ticket, deal_id, lot_size, price)`.
- **B.** The full-close branch in the processor is destructive: it overwrites `net_pnl` from `event.profit + trade_partial_fills` without consulting the `events` table, and it has no guard against running again on an already-closed trade.

## Plan

### 1. Backfill this trade (one-off SQL via migration)

Aggregate from the `events` table for ticket 5681494 (sum of `profit` across the two distinct close deals: 5161419 once + 5164091 once). Update the trade row's `gross_pnl`, `net_pnl`, and recompute `r_multiple_actual` with the centralized `computeRMultiple` inputs. Also insert the missing `trade_partial_fills` row for deal 5161419 so the lab/analytics see the real fill history.

### 2. Dedup partial fills at the deal level (`supabase/functions/ingest-events/index.ts`)

In addition to the existing `idempotency_key` check, when `event_type ∈ {close, partial_close, exit}` and `raw_payload.deal_id` is present and non-zero, also reject duplicates where an event already exists with the same `(ticket, raw_payload->>deal_id)`. This makes EA-side double-emission harmless.

### 3. Make the full-close path non-destructive (`supabase/functions/_shared/tradeEventProcessor.ts`)

Inside the `// Full close` branch (around lines 376-449):

- Before writing, build `totalGrossPnl` by summing **all distinct close/partial_close `events` rows** for this ticket (deduped by `raw_payload->>deal_id`, falling back to `(price, lot_size, event_timestamp)` when deal_id is missing), instead of just `event.profit + trade_partial_fills`. This is the authoritative source and recovers from any past misclassification.
- Add an early guard: if `existingTrade.is_open === false` **and** the trade is not `isRepair` (snapshot-closed), still re-run the aggregation rather than skipping, so a late-arriving final close repairs the prior overwrite instead of replacing it. Only persist if the recomputed `net_pnl` differs.
- Use the same aggregated fills array as input to `computeRMultiple` so R is correct for the full realised PnL across the original lot size.

### 4. Backfill audit (best-effort, scoped) — optional but recommended

Add a small admin-only edge function `repair-partial-closes` that, for the calling user, finds closed trades where `sum(distinct close events.profit) ≠ net_pnl` and re-runs the aggregation step from (3). Out of scope to auto-run; user invokes from a hidden button if they suspect more affected trades. Skip if not wanted.

## Technical details

- Files touched:
  - `supabase/functions/ingest-events/index.ts` — extra dedup query on `(ticket, raw_payload->>deal_id)` for close-type events.
  - `supabase/functions/_shared/tradeEventProcessor.ts` — replace ad-hoc `event.profit + trade_partial_fills` aggregation with `events`-table aggregation; add re-close repair guard.
  - New migration `supabase/migrations/<ts>_fix_trade_379_partial.sql` — backfill trade 379 row and insert missing `trade_partial_fills` row for deal 5161419.
- No schema changes; no UI changes (R% / P&L will simply read correctly after backfill + re-ingest).
- No changes to `computeRMultiple` or `computeNetPnl`; only the inputs they receive.

## Out of scope

- EA-side investigation of why both `partial_close` and `close` are emitted for the same deal — server-side dedup makes the EA behaviour irrelevant.
- Recomputing equity_current from the delta correction (the prior `apply_equity_delta` call used $60.80; we would need to add the missing $346.40). Will include in the backfill migration so account equity matches.
