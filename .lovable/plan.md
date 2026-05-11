## Root cause
The previous fix updated `formatOptions` in `TradeTable.tsx` for system property options, but **custom field cells** still go through `CustomFieldCell.tsx`, which uses a lossy `hexToColorKey` mapping with only 8 hardcoded hexes. Any color outside that small whitelist falls back to `"muted"`, so the table badge does not match the picker.

The example in the screenshot ("Ideal Entry Window" — a custom select field) is rendered by `CustomFieldCell`, which is why the issue persists despite the system-field fix.

## Change (single file: `src/components/journal/CustomFieldCell.tsx`)

1. Delete the `hexToColorKey` helper (lines 16–30).
2. In the `select` / `multi_select` branch (lines 48–53), map options to:
   ```ts
   { value: o.value, label: o.label, customColor: o.color || undefined }
   ```
   `BadgeSelect` already prefers `customColor` (hex with computed bg/border alpha) over the named `color` key, so the rendered badge will match the color picker exactly — same approach now used for system property options.

## Out of scope
- No changes to `BadgeSelect` styling.
- No changes to system option mapping (already correct).
- No DB / schema changes.
