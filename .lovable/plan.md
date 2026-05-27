## Audit results

The Phase D work is mostly consistent. Three real gaps remain — none are user-visible bugs, but they should be closed so nothing rots:

### 1. `supabase/config.toml` references 3 deleted edge functions
The function code is gone but the config blocks remain:
- `[functions.trades-overlay]`
- `[functions.backfill-trades]`
- `[functions.mark-dormant-accounts]` (replaced by pg_cron in Phase B.4)

These should be removed from `supabase/config.toml`.

### 2. `trade_modifications` table has no writer
Phase D added the typed `trade_modifications` table for SL/TP change history, but the MODIFY branch in `ingest-events/index.ts` (lines 805–823) only updates `trades.sl_final` / `trades.tp_final` — it never inserts into the new table. So modification history is being silently dropped.

Fix: in that branch, when SL or TP actually changes vs the existing trade, insert one row per changed field:
```ts
// pseudo
if (event.sl && event.sl !== existingTrade.sl_final) {
  insert trade_modifications { field: 'sl', old_value: existingTrade.sl_final, new_value: event.sl, occurred_at: event.event_timestamp }
}
// same for tp
```

### 3. Stale comment in `ingest-events/index.ts` line 320
Comment says "The cron worker (mark-dormant-accounts) flips it to 'dormant'…" — that worker no longer exists; it's now the `mark_dormant_accounts` pg_cron job. Update the comment to point at pg_cron.

## Non-issues (verified, no action needed)

- **Orphan-close trade insert** (line 932): correctly does NOT write to `trade_partial_fills` — the close itself is the only fill, not a partial.
- **Snapshot repair markers** in `partial_closes` JSONB: correctly NOT mirrored to `trade_partial_fills` — they're metadata, not real fills.
- **`trade_repair_events` table** has no writer yet — acceptable; it only needs writes once we start advisory-closing in the new architecture (Phase D step 4+).
- **`useTrades` / `useOpenTrades`** still read from `trades` — intentional. Cutover to `trade_view` waits until dual-write data has accumulated.
- **types.ts** has all new tables, view, and columns properly typed.

## Out of scope for this pass

- Switching reads to `trade_view`
- Deleting the legacy repair edge functions (`repair-snapshot-closed`, `reprocess-orphan-exits`, `restore-trade-times`, `trades-drift`) — those come in Phase D step 4–6 after dual-write proves stable.
