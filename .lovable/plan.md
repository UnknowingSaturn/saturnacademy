## Why it's still showing

The "TP Reached" column in the Journal isn't hardcoded — it's a **user-defined custom field** stored in `custom_field_definitions` (one row: `key = cf_tp_reached_qqwi`, `label = TP Reached`, `type = multi_select`). Last turn's cleanup stopped the simulator/math from reading it, but the row itself still exists, so the Journal continues to render the column and the trade form still offers it.

## Plan: delete the custom field definition

1. Run a one-shot migration to hard-delete the `TP Reached` row from `custom_field_definitions` for the current user:
   ```sql
   DELETE FROM public.custom_field_definitions
   WHERE key = 'cf_tp_reached_qqwi';
   ```
   This removes the column from the Journal table, the field from the trade edit form, and any filter chips that reference it.

2. Existing values inside each trade's `custom_fields` JSONB are left untouched (harmless — nothing reads them anymore). If you'd rather wipe them too, I can add a second statement:
   ```sql
   UPDATE public.trades
   SET custom_fields = custom_fields - 'cf_tp_reached_qqwi'
   WHERE custom_fields ? 'cf_tp_reached_qqwi';
   ```

3. No frontend code changes needed — the Journal is fully data-driven off `custom_field_definitions`.

## Question before I run it

Do you want me to **also wipe the stored values** from every trade's `custom_fields` JSONB (step 2), or just remove the field definition and leave the historical values dormant in the rows?