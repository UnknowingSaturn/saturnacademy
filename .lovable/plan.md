## Consolidate into one rich custom field

Drop the new dedicated columns and unify all setup-landscape tracking into the existing custom field `cf_ideal_entry_window_jdl1` with an expanded 7-option vocabulary.

### New vocabulary

Stored as the custom field's option `value`:

| value          | label            | meaning                                         |
| -------------- | ---------------- | ----------------------------------------------- |
| `none`         | None             | no qualifying setup printed this hour           |
| `first_worked` | 1st half ✓       | first-half setup worked                         |
| `second_worked`| 2nd half ✓       | second-half setup worked                        |
| `both_worked`  | Both ✓           | both halves worked                              |
| `first_failed` | 1st half ✗       | first-half setup printed but failed             |
| `second_failed`| 2nd half ✗       | second-half setup printed but failed            |
| `mixed`        | Mixed (1✓ / 2✗ etc.) | one half worked, the other printed-but-failed |

Colors keep the worked/failed split (emerald for ✓ states, red for ✗ states, amber for mixed, muted for none).

### Step 1 — Schema migration

Drop the two dedicated columns (and their CHECK constraints) added in the last migration:

```sql
ALTER TABLE public.trades DROP CONSTRAINT IF EXISTS trades_ideal_entry_window_check;
ALTER TABLE public.trades DROP CONSTRAINT IF EXISTS trades_failed_setup_half_check;
ALTER TABLE public.trades DROP COLUMN IF EXISTS ideal_entry_window;
ALTER TABLE public.trades DROP COLUMN IF EXISTS failed_setup_half;
```

### Step 2 — Data backfill (supabase--insert)

Rewrite the custom field definition options + remap the 67 existing legacy values:

```sql
UPDATE public.custom_field_definitions
   SET label = 'Ideal Entry Window',
       options = '[
         {"value":"none","label":"None","color":"#64748B"},
         {"value":"first_worked","label":"1st half ✓","color":"#10B981"},
         {"value":"second_worked","label":"2nd half ✓","color":"#059669"},
         {"value":"both_worked","label":"Both ✓","color":"#047857"},
         {"value":"first_failed","label":"1st half ✗","color":"#EF4444"},
         {"value":"second_failed","label":"2nd half ✗","color":"#DC2626"},
         {"value":"mixed","label":"Mixed","color":"#F59E0B"}
       ]'::jsonb
 WHERE key = 'cf_ideal_entry_window_jdl1';

UPDATE public.trades
   SET custom_fields = jsonb_set(
         custom_fields,
         '{cf_ideal_entry_window_jdl1}',
         to_jsonb(CASE custom_fields->>'cf_ideal_entry_window_jdl1'
                    WHEN 'first_30min' THEN 'first_worked'
                    WHEN 'last_30min'  THEN 'second_worked'
                  END)
       )
 WHERE custom_fields->>'cf_ideal_entry_window_jdl1' IN ('first_30min','last_30min');
```

### Step 3 — Code purge

Files touched in the previous round get reverted/updated:

- `src/types/trading.ts` — remove `HourLandscape` import and the two optional fields from `Trade`.
- `src/types/settings.ts` — remove `ideal_entry_window` + `failed_setup_half` from `DETAIL_FIELD_CATALOG`, `DEFAULT_COLUMNS`, and `SYSTEM_FIELD_SOURCES`. The existing custom-field plumbing already handles the field.
- `src/hooks/useTrades.tsx` — drop both keys from the scalar allow-list.
- `src/components/journal/TradeProperties.tsx` — delete the two PropertyRow cases. The field already appears via the custom-fields renderer.
- `src/components/journal/TradeTable.tsx` — delete the two column branches and the `handleHourLandscapeChange` handler. Custom-field columns already render through the existing custom-field path.
- `src/components/journal/JournalCalendarView.tsx` — replace the column reads with `custom_fields.cf_ideal_entry_window_jdl1`, mapping the 7 values to W/F/Mixed corner badges.
- `src/components/pair-lab/IntraHourTiming.tsx` — read from `custom_fields.cf_ideal_entry_window_jdl1`; derive `firstWorked / secondWorked / firstFailed / secondFailed` booleans from the 7-state value for the hit-rate and co-occurrence math.
- `src/lib/hourSetup.ts` — rewrite around the new 7-state vocabulary: export `IDEAL_WINDOW_VALUES`, a `decode(value)` helper returning `{ firstWorked, secondWorked, firstFailed, secondFailed }`, and color/label maps. No more separate `WORKED_WINDOW_*` / `FAILED_WINDOW_*` palettes.
- `src/lib/pairLabMath.ts` + `supabase/functions/_shared/quant/pairLabMath.ts` — drop the now-orphan `idealEntryWindow` alias entry and field (already unused).

### Step 4 — Verify

- Build passes.
- Open `/journal` and confirm the Ideal Entry Window column shows the new 7 options as colored badges and edits inline.
- Open Pair Lab → Intra-Hour Timing and confirm hit-rate math still derives both worked and failed signals from the single field.

### Out of scope

- Other `cf_*` fields.
- Migrating Pair Lab to a different storage model.
