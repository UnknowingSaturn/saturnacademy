I’ll make the journal field/layout editor fully usable instead of partially editable.

What I found:
- The Fields tab already supports rename, hide, reorder, dropdown option edits, and custom fields, but several “planned/actual” fields are bundled together as one combined row (`Model`, `Profile`, `Regime`, `Timeframes`). That prevents users from independently editing/deleting/reordering Planned vs Actual.
- The Trade Detail sidebar renders those bundled fields as fixed dual rows, so you can’t fully control the “actual/planned” pieces like Notion properties.
- `Place` is editable in the table but only read-only in the detail panel.
- Some delete/hide behavior only removes fields from one place or treats hidden/default state inconsistently, which can make fields feel undeletable.

Implementation plan:

1. Split planned/actual fields into independent editable properties
   - Replace bundled layout keys with separate properties:
     - `model` -> `model` / `actual_model`
     - `profile` -> `profile` / `actual_profile`
     - `regime` -> `regime` / `actual_regime`
     - `timeframes` -> `alignment` / `entry_timeframes`
   - Keep backwards compatibility so existing saved layout order/visibility that contains old bundled keys migrates gracefully in the UI.
   - Keep labels user-editable through existing label overrides.

2. Make field deletion/hiding truly Notion-style
   - Non-core system fields can be hidden from table and detail independently, or removed from both via “Delete field”.
   - Planned and Actual fields can be hidden/deleted separately.
   - Existing destructive erase behavior will remain available for erasable fields.
   - Hidden fields will show in the restore list so users can bring them back.

3. Make actual/planned values editable wherever they appear
   - In the trade detail properties sidebar, render each planned/actual field as its own property row with its own dropdown/multi-select.
   - Add detail support for `actual_model`, `actual_profile`, `actual_regime`, `alignment`, and `entry_timeframes` as standalone fields.
   - Make `Place` inline-editable in the detail sidebar, not just in the table.

4. Align the table with the same field model
   - Ensure table columns can include/hide/reorder all standalone planned/actual fields.
   - Add missing actual-field table support where needed, especially `actual_profile` and `actual_regime`.
   - Keep existing `actual_model` support, but ensure it’s part of default/restore/layout registries consistently.

5. Improve layout/settings UX copy and rows
   - Update field descriptions so users understand “Planned model”, “Actual model”, “Planned profile”, etc.
   - Remove misleading “Planned + Actual” bundled descriptions from the Fields/Layout panels.
   - Preserve the current dark card row style shown in your screenshot while making every row actionable.

6. Verify the implementation
   - Check the Fields tab supports rename, reorder, table/detail toggle, dropdown option edit, delete/hide, restore, and erase where applicable.
   - Check the trade detail sidebar reflects layout changes and supports editing planned/actual values separately.
   - Check the table renders and edits the standalone planned/actual fields correctly.

Files expected to change:
- `src/types/settings.ts`
- `src/components/journal/TradeProperties.tsx`
- `src/components/journal/TradeTable.tsx`
- `src/components/journal/settings/FieldsPanel.tsx`
- `src/components/journal/settings/DetailLayoutPanel.tsx`
- Possibly small updates in filtering/settings panels if they rely on the old bundled keys.

No database migration should be required; the needed columns already exist. This is mainly fixing the field model and UI behavior so users have full control.