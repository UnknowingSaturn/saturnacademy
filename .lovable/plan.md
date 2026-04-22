

# Fix the broken Planned-vs-Actual changes

The migration applied cleanly and most code is wired up, but **three regressions** prevent the new feature from actually working. No data was lost; the columns exist with correct types in the database.

## The bugs

### 1. Actual Model/Profile/Regime never save (silent failure) — primary bug

`src/hooks/useTrades.tsx` → `useUpdateTrade` filters updates through a hardcoded `scalarFields` allowlist (line 176). The list was not updated when the new columns were added, so any call like `updateTrade({ id, actual_playbook_id: ... })` silently strips the field, runs an empty UPDATE, and shows a misleading "Trade updated successfully" toast. Nothing persists.

**Fix**: add `'actual_playbook_id'`, `'actual_profile'`, `'actual_regime'` to the `scalarFields` array.

### 2. `Trade` TypeScript interface missing the new fields

`src/types/trading.ts` has the comment block but the actual interface fields need verification. Components currently use `(trade as any).actual_playbook_id` casts in `TradeProperties.tsx` and `TradeTable.tsx`, which bypasses type safety and is a sign the proper field declarations weren't added. 

**Fix**: ensure `actual_playbook_id: string | null`, `actual_profile: TradeProfile | null`, `actual_regime: RegimeType | null` are properly declared on the `Trade` interface, then remove the `as any` casts in both components.

### 3. Default fallback column list out of sync

`src/components/journal/TradeTable.tsx` line 76-78 hardcodes a fallback `activeColumns` list that includes `'model'` but doesn't reflect the new `actual_model` / `read_quality` columns now defined in `DEFAULT_COLUMNS`. Cosmetic — the user's saved column preferences override it — but inconsistent.

**Fix**: leave `model` in the default-on list; do nothing else (keeping `actual_model`/`read_quality` opt-in matches the original plan).

## What's already correct (verified, no changes needed)

- Database columns `actual_playbook_id`, `actual_profile`, `actual_regime` exist with correct types and FK to `playbooks`.
- `src/integrations/supabase/types.ts` has the columns in Row/Insert/Update types and the FK relationship.
- `useOpenTrades.tsx` `transformTrade` maps the three fields from DB rows.
- `useTrades.tsx` `transformTrade` uses `...row` spread, so the fields flow through.
- `TradeProperties.tsx` renders Planned/Actual rows and a Read-Quality badge.
- `TradeTable.tsx` renders `actual_model` cell and `read_quality` badge.
- `supabase/functions/generate-report/index.ts` selects the new columns and builds the `read_quality` summary block for the LLM.
- RLS policies on `trades` are unchanged and correct.
- All 153 trades + 71 archived are intact in the database — nothing was dropped.

## Files to change

| File | Change |
|---|---|
| `src/hooks/useTrades.tsx` | Add `'actual_playbook_id'`, `'actual_profile'`, `'actual_regime'` to the `scalarFields` array in `useUpdateTrade` so the new fields actually reach the database |
| `src/types/trading.ts` | Confirm/add `actual_playbook_id`, `actual_profile`, `actual_regime` as typed fields on the `Trade` interface |
| `src/components/journal/TradeProperties.tsx` | Remove the `(trade as any)` casts now that the type includes the fields |
| `src/components/journal/TradeTable.tsx` | Remove the `(trade as any)` casts in the cell renderers and `computeReadQuality` |

## Validation

1. Open a trade → set "Actual Model" to a different playbook than Planned → reload the page → Actual Model still set (currently it disappears).
2. Same for Actual Profile and Actual Regime.
3. Read Quality badge appears in the Properties panel and updates Match → Mismatch as expected.
4. Enable "Actual Model" + "Read Quality" columns from column settings — values render in the table after saving.
5. No TypeScript errors; no `as any` casts left for these three fields.
6. Existing 153 trades remain visible (already verified — nothing was lost; the original "missing trades" issue is the unrelated account-filter UX issue from the previous turn).

