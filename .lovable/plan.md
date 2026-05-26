## Change

In the journal trade table, the column header labels for the alignment and entry_timeframes columns are swapped relative to their intended meaning. Swap just the labels/placeholders — keep data bindings, field keys, ordering, and the detail panel labels untouched.

## Files

**`src/types/settings.ts`** — column registry labels (lines 275–276):
- `alignment` label: `'Alignment'` → `'Entry'`
- `entry_timeframes` label: `'Entry'` → `'Alignment'`

**`src/components/journal/TradeTable.tsx`** — inline placeholders (lines 573, 594):
- alignment BadgeSelect placeholder: `"Align"` → `"Entry TF"`
- entry_timeframes BadgeSelect placeholder: `"Entry TF"` → `"Align"`

## Out of scope

- `TradeProperties.tsx` detail panel labels ("HTF Timeframes" / "Entry Timeframes") stay as-is — only the table header is wrong.
- No DB changes, no field renames, no data migration.
- Column order unchanged.
