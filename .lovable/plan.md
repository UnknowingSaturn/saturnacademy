## System audit — recent partial-close work

I traced every call site of the new `tradeMath.ts` helpers, the ingest/reprocess R-multiple changes, and surrounding UI. The features work, but there are a handful of small inconsistencies and dead branches worth tightening. No DB schema changes needed.

### Findings

**1. `src/lib/tradeMath.ts` — dead fallback + cast (now unsound)**
- `getAllCloseFills` was written before `original_lots` existed on the `Trade` type. Lines 31–38 still cast via `(trade as { original_lots?: number })` and fall back to `lots: 1` when missing. `Trade.original_lots` is now a real field and `useOpenTrades` populates it; the cast hides the field from TS and the `lots: 1` placeholder corrupts `getWeightedAvgExitPrice` when the field is briefly null on legacy rows.
- Fix: read `trade.original_lots` directly. If null, fall back to `total_lots + Σpartial.lots` (correct on closed trades since `total_lots` is 0, on open trades since partials reduce it). Drop the `1` placeholder; if still indeterminable, omit the final fill from the weighted-average calc instead of fabricating weight.

**2. `useTrades.tsx` — missing numeric coercion**
- `transformTrade` spreads `...row` but does not coerce `original_lots`, `total_lots`, `gross_pnl`, etc. `useOpenTrades` does. Postgres `numeric` returns as string via PostgREST in some cases, which breaks `getWeightedAvgExitPrice` arithmetic.
- Fix: explicitly coerce numeric columns the same way `useOpenTrades` does.

**3. `TradeTable.tsx` (line 566) — duplicates filter logic**
- Re-implements the partial-close filter inline instead of calling `getRealPartialCloses`. Drift risk if the repair-marker shape changes.
- Fix: `getRealPartialCloses(trade).length` and use that for the `N×` badge.

**4. `TradeProperties.tsx` — recomputes fills 3× per render**
- Calls `getAllCloseFills(trade)` at lines 373, 429, 433 plus `hasMultipleCloses` (which calls it again). Cheap individually, but called for every open trade in side panels.
- Fix: `const fills = useMemo(() => getAllCloseFills(trade), [trade.partial_closes, trade.exit_price, trade.exit_time, trade.original_lots, trade.gross_pnl])` once; derive `hasMultiple` and `avg` from it.

**5. Lots row label is misleading on closed multi-fill trades**
- Line 455 shows `"15.5 opened"` for a closed trade because `total_lots` is 0. User has no idea it's fully closed vs. partially.
- Fix: when `!is_open`, show `"15.5 (closed in N fills)"`. When open and partially closed, show `"3.0 / 15.5"`.

**6. `ingest-events` — `partial_closes` repair marker leaks into client filters**
- The repair marker `{ type: 'repaired_from_snapshot', ... }` lives in the same JSON array as real fills. Every client/edge consumer must remember to filter it. We already centralized this in `getRealPartialCloses` for the UI but `useTrades` mappers and a couple of report queries iterate raw `partial_closes` without filtering.
- Fix: add a tiny `isRealFill(p)` guard exported from `tradeMath.ts` and reuse it in `useTrades` and `useOpenTrades` (replace inline `Array.isArray` checks). No DB change.

**7. `reprocess-trades` `computeRMultiple` — duplicate of `ingest-events` version**
- Both edge functions carry an identical 60-line `computeRMultiple`. Drift risk (just bit us with the partial-close R bug). Edge functions can't share a TS module from `src/`, but Supabase functions can share via `supabase/functions/_shared/`.
- Fix: extract to `supabase/functions/_shared/rMultiple.ts` and import from both. Keeps future fixes one-shot.

### Plan

```text
1. src/lib/tradeMath.ts
   - Remove `(trade as { original_lots?: number })` cast; use trade.original_lots directly.
   - Replace `lots: 1` placeholder with proper fallback: original_lots ?? (total_lots + Σpartials).
   - Export `isRealFill(p)` and rewrite `getRealPartialCloses` to use it.

2. src/hooks/useTrades.tsx
   - In transformTrade, Number()-coerce: total_lots, original_lots, entry_price, exit_price,
     gross_pnl, net_pnl, commission, swap, r_multiple_actual, r_multiple_planned,
     balance_at_entry, equity_at_entry, sl_initial/final, tp_initial/final.
   - Filter partial_closes through isRealFill on read (keep marker, but tag it).

3. src/components/journal/TradeTable.tsx
   - Replace inline partial-close filter at line 566 with getRealPartialCloses(trade).length.

4. src/components/journal/TradeProperties.tsx
   - Memoize fills once; derive hasMultiple, avg, count from it.
   - Update Lots row label:
       open + partials  -> "{remaining} / {original}"
       closed + partials -> "{original} (closed in {n} fills)"
       otherwise        -> existing single value

5. supabase/functions/_shared/rMultiple.ts (new)
   - Move computeRMultiple + getPipSize/getPipValue helpers.
   - Update ingest-events/index.ts and reprocess-trades/index.ts to import from it.
   - No behavioral change; pure extraction. Both functions redeploy automatically.

6. (Optional) Add brief unit-style sanity log in reprocess-trades for any trade where
   |new R - old R| > 0.5, so future drift surfaces in logs without backfill noise.
```

### Out of scope (noted but not changed)
- `generate-report` (1,439 lines) is monolithic but stable; refactoring is high-risk for no user-visible win.
- `useUserSettings` (538 lines) bundles many hooks but each is small and cohesive.
- Copier desktop code is unaffected.

### Risk
Low. Changes are read-side normalization, label tweaks, and one shared-module extraction. No migrations, no data backfill required (the previous reprocess already corrected stored R).
