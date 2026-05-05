## Goal

Give every journal field — system AND custom — a full Notion-style configuration panel where the user can change its type (text / number / select / multi-select / date / checkbox / url / playbook), edit options, set defaults, rename, and control visibility — without losing data.

Right now:
- System fields have a fixed type baked into the catalog. You can edit dropdown options but not change "select" → "multi-select", or convert a text field into a select.
- Custom fields lock the type after creation (`disabled={!!initial}` in `CustomFieldDialog`).
- There is no single "Edit field" panel — config is split between the dialog, the inline options collapsible, and the row menu.

## What you'll be able to do after this

For ANY field (custom or non-core system):
1. Change its **type** (text, number, select, multi_select, date, checkbox, url, playbook-select).
2. Edit **options** (label, color, sort, hide, delete) inline.
3. Set a **default value**.
4. **Rename** label.
5. Toggle **table** + **detail** visibility.
6. **Reorder** via drag.
7. **Delete** (soft) or **erase data** (hard) per the existing tombstone system.

Core fields (P&L, entry_time, direction, etc.) keep their type locked but get the same rename / visibility / reorder controls.

## Technical Plan

### 1. Data model

**New table: `field_overrides`** (per-user overrides for system fields)
```
id uuid pk
user_id uuid references auth.users on delete cascade
field_key text                  -- e.g. 'profile', 'regime', 'place'
type text                       -- 'text'|'number'|'select'|'multi_select'|'date'|'checkbox'|'url'|'playbook'
options jsonb default '[]'      -- when type is select/multi_select; mirrors property_options shape
default_value jsonb
created_at, updated_at timestamps
unique(user_id, field_key)
```
RLS: standard `auth.uid() = user_id` for select/insert/update/delete.

This lets the user "convert" a system field's storage interpretation without touching the underlying `trades` column. When the override type differs from the catalog type, we render the override UI and write the value into either the existing column (when compatible) or into `trades.custom_fields` under the same key as a fallback.

**Custom fields**: drop the "type is locked after creation" rule. Allow type change with a confirmation dialog explaining data conversion rules (see §3).

### 2. Unified Field Config panel

Replace the current `CustomFieldDialog` + inline options collapsible with a single **`FieldConfigSheet`** (right-side drawer) opened from the row menu's "Configure" item.

Sections in the drawer:
- **Name** — label input + "reset to default" for system fields.
- **Type** — Select with all 8 types. Disabled only for core fields.
- **Options** — visible when type is `select` / `multi_select`. Full editor (drag, color, rename, hide, delete) reusing today's `OptionRow` / `CustomOptionsEditor`.
- **Default value** — type-aware input (checkbox toggle, number input, option dropdown, etc.).
- **Visibility** — Table toggle + Detail toggle.
- **Danger zone** — Delete field, Erase data (with counts), Reset to defaults (system only).

Used for both system + custom fields. The data source on submit:
- Custom field → updates `custom_field_definitions` row.
- System field → upserts into `field_overrides`.

### 3. Type-change semantics (data migration rules)

When the user changes a field's type, show a confirm dialog summarising what will happen to existing values:

| From → To | Behaviour |
|---|---|
| text → number | parse, null on failure (preview count of failures) |
| select → multi_select | wrap value in array |
| multi_select → select | keep first element |
| any → text | stringify |
| any → checkbox | truthy → true, empty → false |
| any → date | attempt parse, null on failure |
| any → url | keep as text, validate display only |

The "preview count of failures" comes from a quick `select` over the user's trades. Conversion runs in a single mutation (`useConvertFieldType`) that updates definition + rewrites values.

### 4. Renderer routing

`TradeProperties.tsx` and `CustomFieldCell.tsx` already render by `type`. Update both to:
- For system field keys, check `field_overrides` first, fall back to `DETAIL_FIELD_CATALOG`.
- For all keys, the renderer purely switches on `effectiveType` — no hard-coded per-key logic.

Add a small helper `useEffectiveFieldDef(key)` that returns `{ type, options, label, default_value, source: 'core'|'system'|'override'|'custom' }`.

### 5. Row menu cleanup

`FieldRowCard` dropdown becomes:
- Configure… (opens drawer)
- Show/Hide in table
- Show/Hide in detail
- Delete (non-core only)

Remove the inline "Edit dropdown options" collapsible — it lives in the drawer now.

### 6. Files

- `supabase/migrations/<ts>_field_overrides.sql` — new table + RLS.
- `src/types/settings.ts` — add `FieldOverride` type, `EffectiveFieldDef`, helper `getEffectiveFieldDef`.
- `src/hooks/useFieldOverrides.tsx` — new (CRUD + cache).
- `src/hooks/useCustomFields.tsx` — add `useConvertFieldType` for custom fields.
- `src/components/journal/settings/FieldConfigSheet.tsx` — new unified drawer.
- `src/components/journal/settings/FieldsPanel.tsx` — wire the drawer, drop the inline options collapsible.
- `src/components/journal/settings/CustomFieldDialog.tsx` — keep for "Add new" only; remove the locked-type behaviour by routing edits to the drawer.
- `src/components/journal/TradeProperties.tsx` + `CustomFieldCell.tsx` — route through `useEffectiveFieldDef`.

### 7. Verification

- Convert `profile` (system, select) → multi_select; existing values become single-element arrays; UI now multi-picks.
- Convert a custom text field → select; existing text values become options automatically (top 20 distinct).
- Change a select option's color in the drawer; reflected in table badges immediately.
- Delete a non-core system field after type-change; restoring it brings back the override.
- Core field "Configure" shows type as locked but still allows rename + visibility.

No per-user physical schema; everything stays on the shared app schema with per-user definition + override rows.