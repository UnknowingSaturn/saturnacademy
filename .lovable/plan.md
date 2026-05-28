# Schema Collapse: property_options + field_overrides → custom_field_definitions

## Why
Today there are three tables doing one job:

- `custom_field_definitions` — one row per user-defined field, `options` stored as `jsonb` array of `{value,label,color}`.
- `property_options` — one row **per option** for built-in select properties (mistake, tag, etc.), keyed by `property_name`.
- `field_overrides` — one row per built-in field a user re-typed or re-optioned, keyed by `field_key`.

Result: three sets of hooks, three RLS surfaces, three default-seeders, and three places to query when rendering one dropdown. The audit flagged this as the largest source of "five places to store one thing".

## Target shape

Single table `custom_field_definitions` with a `scope`:

| column | meaning |
|---|---|
| `key` | `field_key` for system fields, `key` for user fields (already unique per user via composite index) |
| `scope` | `'system_override'` for what `field_overrides` held; `'system_options'` for what `property_options` held (one row per `property_name`); `'user'` for existing custom fields |
| `type` | unchanged |
| `options` | jsonb array of `{value,label,color,is_active,sort_order}` — absorbs all per-option columns |
| `default_value` | unchanged |
| `label`, `sort_order`, `is_active` | unchanged (used by `'user'` scope; ignored by override scopes) |

Unique index `(user_id, scope, key)` replaces the old per-table uniques.

## Migration plan (single file)

1. `ALTER TABLE custom_field_definitions ADD COLUMN scope text NOT NULL DEFAULT 'user'`.
2. Backfill `field_overrides` → one row each, `scope='system_override'`, `key = field_overrides.field_key`, copying `type/options/default_value`.
3. Backfill `property_options` grouped by `(user_id, property_name)` → one row each, `scope='system_options'`, `key = property_name`, `type='select'`, `options = jsonb_agg({value,label,color,is_active,sort_order} order by sort_order)`.
4. Add `CREATE UNIQUE INDEX … ON custom_field_definitions (user_id, scope, key)`.
5. Drop `property_options` and `field_overrides`.
6. RLS already exists on `custom_field_definitions`; no policy change needed.

## Code changes

**Delete**
- `src/hooks/useFieldOverrides.tsx` (92 LOC, 3 hooks).
- The 6 property-option hooks at the bottom of `useUserSettings.tsx` (~200 LOC: `usePropertyOptions`, `useCreate/Update/Delete/ReorderPropertyOption`, the property-options half of `useInitializeDefaults`).

**Add to `useCustomFields.tsx`**
- `useSystemFieldOverride(fieldKey)` / `useUpsertSystemFieldOverride()` / `useResetSystemFieldOverride()` — same surface as today's `useFieldOverrides` but writes to `custom_field_definitions` with `scope='system_override'`.
- `useSystemOptions(propertyName, { activeOnly })` returning the `options` jsonb of the matching `scope='system_options'` row, with the existing auto-seed-from-defaults effect ported over.
- `useUpsertSystemOption()` / `useDeleteSystemOption()` / `useReorderSystemOptions()` that read-modify-write the `options` jsonb (single row write per change instead of N row writes — also fixes the N+1 reorder loop the audit called out).

**Rewrite callers** (mechanical, types stay the same shape):
- `PropertyOptionsPanel.tsx`, `SystemFieldConfigDialog.tsx`, `CustomFieldDialog.tsx`, `ReportView.tsx`, and any select renderer in `TradeProperties.tsx` that currently calls `usePropertyOptions(...)`.
- `supabase/functions/generate-report/index.ts` — switch its two reads (`property_options`, `field_overrides`) to a single `custom_field_definitions` query filtered by `scope in ('system_options','system_override')`.

**Regen** `src/integrations/supabase/types.ts` is auto-managed; nothing to touch.

## Rollout safety

- One migration, fully reversible until the `DROP TABLE` runs. I'll run the backfill + create the index + verify counts via `read_query` before the drop in the same migration (single transaction, so a count mismatch aborts everything).
- No data loss path: every option / override becomes a row or a jsonb element in `custom_field_definitions` first.
- The seed-on-empty effect is preserved so brand-new users still get `DEFAULT_PROPERTY_OPTIONS`.
- Removes the audit's N+1 reorder bug as a side effect (options live in one jsonb, one UPDATE per reorder).

## Out of scope (explicitly deferred)
- `user_settings.column_overrides` and `user_settings.field_label_overrides` — also flagged by the audit but they live on `user_settings` (one row per user), so collapsing them is a separate, smaller pass.
- RLS policy rewrites to use `has_trade_access` — already deferred by Phase 4.
- Any UI redesign of the settings panels; this PR keeps every screen identical.

## Order I'll ship
1. Write + submit the migration (you approve).
2. Add the new hooks in `useCustomFields.tsx`.
3. Swap call sites + `generate-report`.
4. Delete the dead hooks/file.
5. Smoke-check on `/journal` and the settings panels.
