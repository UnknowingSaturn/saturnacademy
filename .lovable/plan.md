# Phase D Final Audit — All Clean

I re-audited the codebase against the prior fix list. **No new gaps found.**

## Verified Clean

- **No stale function references**: `rg` for `trades-overlay`, `backfill-trades`, `mark-dormant-accounts` across the entire repo returns zero hits. Both `supabase/config.toml` and `supabase/functions/` are clean.
- **Deployed edge functions** match the codebase (22 functions, all present in `supabase/functions/`).
- **Dual-writes wired in `ingest-events`**:
  - `trade_partial_fills` ← partial-close branch (idempotent upsert on `trade_id, deal_id`)
  - `trade_modifications` ← MODIFY branch when SL or TP actually changes
- **Stale `mark-dormant-accounts` comment** in `ingest-events/index.ts` was already updated to reference the pg_cron job.
- **Legacy `partial_closes` JSONB** is still read by `trades-drift`, `reprocess-orphan-exits`, `reprocess-trades`, `repair-snapshot-closed`, `useTrades`, `tradeTransform` — this is **intentional** for the dual-write window. Cutover to `trade_view` is a later Phase D step once typed tables accumulate data.
- **`trade_repair_events`** has no writer yet — intentional; only wired once the new advisory-close path lands.

## Not in Scope This Pass (deferred Phase D steps)

1. Switch reads from `trades` → `trade_view`
2. Retire `partial_closes` JSONB column
3. Delete legacy repair functions (`repair-snapshot-closed`, `reprocess-orphan-exits`, `restore-trade-times`, `trades-drift`) once the new advisory-close pipeline writes to `trade_repair_events`

## Recommendation

**No changes to make right now.** The Phase D dual-write foundation is in place and clean. Next concrete step (when you're ready) is to start consuming `trade_view` in one read path (e.g. `useOpenTrades`) behind a feature check, then progressively cut over.

Approve to proceed to the read-path cutover, or close this out and resume later.
