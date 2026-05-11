# Journal Fields settings — fix + simplify

## Root causes I found

1. **Emotion "Table" toggle does nothing** — `Emotion` is registered under two different keys: the detail catalog uses `emotion`, but the actual table column key is `emotional_state_before`. The settings toggle writes `visible_columns` keyed by `emotion`, while the table reads `emotional_state_before`, so toggling has no effect on the table. (Other one-key-per-field rows like `session`, `model`, `place` work fine.)

2. **Settings list order ≠ table order** — `FieldsPanel` builds its row list from `detail_field_order` first, then appends table-only columns. The table itself renders by `column_order`. Initial order can differ, so dragging in Settings doesn't visually correspond to the table you're trying to fix.

3. **Two redundant "restore" buckets + four delete dialogs** — "Hidden system fields", "Deleted fields", and "Hidden custom fields" are three sections with effectively the same purpose. The delete flow has 4 dialog variants for what users perceive as one action.

## Changes

### 1. One canonical key per field (fixes the Emotion bug)
- In `src/types/settings.ts`, rename the detail catalog entry `emotion` → `emotional_state_before` so the detail panel and the table agree on the key. Audit and align any other split keys (`pair`/`symbol`, `pnl`/`net_pnl`, `r_pct`/`r_multiple_actual`) — pick the table-column key as canonical.
- In `src/hooks/useUserSettings.tsx`, add a transparent migration when loading user settings: rewrite legacy keys (`emotion` → `emotional_state_before`, etc.) in `detail_visible_fields`, `detail_field_order`, `field_label_overrides`, and `column_overrides`. Mirrors the existing `migrateDetailKeys` pattern. No DB migration needed.
- Drop the `SYSTEM_OPTION_PROPERTY` alias for emotion in `FieldsPanel.tsx` — the catalog's `propertyName` is enough once keys agree.

### 2. Settings rows follow the table order
- In `FieldsPanel.tsx`, rebuild `rows` from `column_order` first (the table's truth), then append detail-only fields and custom-only fields not yet seen. Drag still writes both `column_order` and `detail_field_order`, so the two stay in sync going forward.

### 3. Collapse three buckets into one "Hidden fields" section
- Render a single list combining: tombstoned system fields, system fields missing from `column_order`, and inactive custom fields. One Restore button per row. Remove the separate "Hidden custom fields" and "Deleted fields" sections.

### 4. Simplify the delete flow
- Replace the four-variant `AlertDialog` with one dialog that adapts:
  - Always shows an "Also erase saved data" checkbox, disabled when the field has no erasable storage (computed columns / core fields).
  - For custom fields, adds a second checkbox "Permanently delete the field definition" — unchecked = soft hide (current default), checked = hard delete.
- Removes the per-row dropdown in the inactive list; everything happens in the unified dialog.

### 5. Defensive toggle
- Keep `isInTable` falling back through `sys.field` so any future legacy key still resolves to a real column. Once #1 lands, `toggleTable` writes the canonical key and the table reads it directly — the Emotion bug is fixed.

## Out of scope
- No DB schema changes, no edits to copier/EA, no changes to trade data, sorting, or filtering behavior.
- Detail-panel rendering logic stays the same; only the key rename + migration affect it.

## Risk
- Existing users with `emotion` saved in their settings: handled by the load-time migration. No data loss; first load auto-rewrites to the canonical key.
