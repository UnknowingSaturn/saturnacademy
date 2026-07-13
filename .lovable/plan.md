# Journal audit + multi-TP grouping — implementation log

## Shipped this pass

### Schema (2 migrations, approved & applied)
- `trades.group_key text` + `trades.group_role text` (`'leader' | 'leg' | NULL`)
- Partial index `trades_group_key_idx (user_id, group_key) WHERE group_key IS NOT NULL`
- Backfill: 7 existing sibling groups (2 triples + 5 pairs = 16 rows) tagged; 456 standalone trades left untouched.

### Ingest (`supabase/functions/_shared/tradeEventProcessor.ts`)
- **J1** — `existingTrade` lookup switched from `.single()` to `.maybeSingle()` (also on accountData lookup).
- **Multi-TP grouping** — on ENTRY, look up siblings in the last 30 s on same `(user, account, symbol, direction)` at price ± 5 bps. Promote earliest to `'leader'`, tag new row as `'leg'`, share `group_key`. Non-destructive; per-leg TP/SL/PnL stay intact.
- **J2** — orphan-exit no longer synthesises `entry_price = exit_price`. If no `raw_payload.entry_price` present: entry_price stays NULL, R-multiple stays NULL, `repair_state = 'needs_entry'`.
- **J10** — modify branch treats `sl === 0` and `tp === 0` as "removed" (writes NULL), distinguishes from "field absent from payload" via `!== undefined`, logs `REMOVED` for clarity.

### Frontend audit fixes
- **J3** — `Journal.tsx` `setCurrentDate` formats via UTC parts, no more tz drift.
- **J6** — `useOpenTrades` poll cut from 30 s foreground+background to 5 min foreground-only; realtime already handles all writes.
- **J9** — `tradeTransform.ts` dropped dead `row.accounts` fallback.

### New grouping selector
- `src/hooks/useGroupedTrades.ts` — pure `groupTrades()` + hook wrapper. Aggregates lots (VWAP), entry/exit price (lot-weighted), PnL (summed), R-multiple (lot-weighted), latest exit_time, is_open (any-leg-open). Standalone trades pass through.
- Wired into `src/pages/Journal.tsx` behind localStorage flag `journal:group_multi_tp` (default ON). Journal filtering + display now operates on grouped rows.
- `src/lib/__tests__/groupedTrades.test.ts` — 4 tests: standalone passthrough, closed-triple VWAP + weighted-R, mixed open-leg group, sort order.

### Types
- Extended `Trade.repair_state` to include `'needs_entry'`.
- Added `Trade.group_key` and `Trade.group_role`.

## Verification
- `bunx tsgo --noEmit` — clean.
- `bunx vitest run` — 96/96 passing (92 existing + 4 new grouping tests).

## Deliberately deferred (staged next pass)
- **Pair Lab / Prop Firm / Dashboard grouping** — these read via `useTrades` and their stats (Kelly, OOS, walk-forward, MC breach) would silently change if grouping were applied without re-validating parity tests. Left per-leg for now; opt-in wiring behind the same setting is the next PR.
- **Setting UI toggle** — grouping is on by default; the localStorage flag `journal:group_multi_tp` exists but isn't yet surfaced in JournalSettingsDialog. Add checkbox in the next UI pass.
- **Journal expand-legs UI** — the aggregated row shows correct totals, but there's no explicit "3 legs" badge / expand-to-see-legs affordance yet. `.legs` is populated on every group so the panel can consume it.
- **J4** — per-symbol epsilon for partial-vs-full close threshold. Current `0.001` is fine at your current lot sizes; will revisit when we add per-symbol contract specs.
- **J5** — R-multiple recompute at close correctly uses `sl_initial` (planned R); documented via existing comments — no code change required.

## Files changed
- created supabase migration (group_key/group_role columns + backfill)
- created supabase migration (backfill correction)
- created src/hooks/useGroupedTrades.ts
- created src/lib/__tests__/groupedTrades.test.ts
- edited src/types/trading.ts
- edited src/lib/tradeTransform.ts
- edited src/hooks/useOpenTrades.tsx
- edited src/pages/Journal.tsx
- edited supabase/functions/_shared/tradeEventProcessor.ts
- edited .lovable/plan.md (this file)
