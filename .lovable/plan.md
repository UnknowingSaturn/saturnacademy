# Fix: duplicate Pair / Date / RR rows in Settings → Fields

## Cause
Three system fields are registered under two different keys — one in `DETAIL_FIELD_CATALOG`, one in `DEFAULT_COLUMNS` — so the unified Fields list renders them twice:

| Concept | Detail key   | Table key            |
|---------|--------------|----------------------|
| Pair    | `pair`       | `symbol`             |
| Date    | `date`       | `entry_time`         |
| RR / R% | `r_pct`      | `r_multiple_actual`  |

This is the same bug class fixed previously for `emotion` → `emotional_state_before`. (Direction, P&L, Status, Closes only exist in the detail catalog, so they're not duplicated.)

## Change

### 1. Make the table column key the canonical key
In `src/types/settings.ts`, rename the detail catalog entries:
- `pair` → `symbol`
- `date` → `entry_time`
- `r_pct` → `r_multiple_actual`

The catalog entries stay readonly with the same labels ("Pair", "Date (ET)", "R%"). Only the `key` changes.

### 2. Rename matching switch cases
In `src/components/journal/TradeProperties.tsx`, update the three `case` labels and the `labelFor(...)` first arg + `<PropertyRow key=...>` so the renderer still matches.

### 3. Migrate saved user settings transparently
- Extend `LEGACY_DETAIL_KEY_MIGRATION` in `src/types/settings.ts` with `pair → [symbol]`, `date → [entry_time]`, `r_pct → [r_multiple_actual]`.
- Extend `LEGACY_KEY_MAP` in `src/hooks/useUserSettings.tsx` with the same three pairs so `field_label_overrides`, `column_overrides`, `visible_columns`, `column_order`, `deleted_system_fields` all rewrite the legacy keys to the canonical ones on load.

### 4. Audit
Quick search for any other place that hard-codes the legacy keys (`'pair'`, `'date'`, `'r_pct'`) outside of these catalog entries — if any UI/sort/handler still references them, swap to the canonical key.

## Out of scope
No DB schema changes, no data writes, no changes to copier/EA, no changes to detail-panel rendering apart from the case-label rename. Behavior is identical, just one row per field.

## Risk
Visual + state only. Existing users with the legacy keys saved in their settings JSON have them transparently migrated on load (mirrors the Emotion fix). No data loss.
