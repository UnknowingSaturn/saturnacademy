## Goal

Today the **Alignment** column and the **Entry** column on the Journal table both render dropdowns from the same `timeframe` property list (`usePropertyOptions('timeframe')`). Editing the list once changes both. We will split them so each field has its own independently editable list of options (and colors).

## Changes

### 1. Add a new property type: `entry_timeframe`
- `src/components/journal/settings/PropertyOptionsPanel.tsx` — extend `PROPERTY_TYPES` with `{ value: 'entry_timeframe', label: 'Entry Timeframe' }` and rename the existing `'timeframe'` entry to `'Alignment Timeframes'` for clarity. No DB schema change needed — `property_options.property_name` is already a free-form string.

### 2. Seed defaults for the new list (so users don't start empty)
- One-time client-side seed in `useUserSettings.tsx`: when `usePropertyOptions('entry_timeframe')` returns an empty array for the first time, copy the user's existing `timeframe` options into `entry_timeframe`. This keeps current behavior for existing users until they customize.

### 3. Wire the table to the new source
- `src/components/journal/TradeTable.tsx`
  - Add `const { data: entryTimeframeOptions = [] } = usePropertyOptions('entry_timeframe', true);`
  - Replace the `entry_timeframes` column's `options={formatOptions(timeframeOptions)…}` with `formatOptions(entryTimeframeOptions)`.
  - Leave the `alignment` column on `timeframeOptions`.

### 4. Mirror the split in `TradeProperties.tsx`
- Add `const { data: entryTimeframeOpts } = usePropertyOptions('entry_timeframe', true);`
- Use it for the entry-timeframe field; keep `timeframeOpts` for alignment.

### 5. FieldsPanel labels
- `src/components/journal/settings/FieldsPanel.tsx` — where it shows the option-source for the `entry_timeframes` field, point it at `'entry_timeframe'` instead of `'timeframe'`.

## Out of scope
- No database migration. `property_options` already keys by `(user_id, property_name)`.
- No changes to the underlying trade columns (`alignment`, `entry_timeframes`) — only the option lists feeding the UI.
- No copier/EA changes.

## Result
Users can customize Alignment timeframes (e.g. Daily/4H/1H with green colors) separately from Entry timeframes (e.g. 5m/1m with neutral colors), and the two dropdowns will no longer look identical.
