I’ll sort this by separating three actions that are currently blurred together: hide, delete from my table, and erase data.

Current problem:
- The app already stores layouts per user in `user_settings`, and custom fields/options per user with backend access rules.
- But non-core system fields are only being removed from the visible/order arrays, so they still appear as “Hidden system fields” and can feel like they never truly delete.
- The trade table currently mostly uses `visible_columns`, not the full per-user `column_order`, so different users can still feel like they are using the same default table structure.
- The table header “Hide column” is wired to a no-op.
- Some planned/actual columns exist in the registry but still need full editable cell renderers in the table.

Plan:

1. Add a per-user deleted-fields registry
   - Add a new setting on `user_settings`, e.g. `deleted_system_fields jsonb default []`.
   - This is not deleting the physical database column globally; it marks the field as deleted for that specific user only.
   - This is the Notion-style approach: everyone uses the same app schema underneath, but each user has their own field registry/layout.
   - Keep RLS/user ownership so one user’s deleted fields never affect another user.

2. Make delete mean “remove from my table/layout” for non-core system fields
   - For non-core system fields, pressing Delete will:
     - remove it from table visible columns
     - remove it from table order
     - remove it from detail sidebar visibility/order
     - add it to `deleted_system_fields`
   - Deleted fields will no longer appear in the active field list or normal hidden list.
   - Add a separate “Deleted fields” restore area so the user can intentionally bring one back.
   - Core fields remain protected: they can be hidden, not deleted.

3. Make destructive data erasure explicit
   - Keep “Erase data” as a separate explicit option.
   - For a non-core system field, users can delete the field from their layout without wiping old trade values.
   - If they choose “also erase data”, only their own trade/review rows are cleared.
   - For custom fields, make permanent delete easier to access instead of hiding it behind the inactive/hidden section.

4. Make the table genuinely per-user
   - Centralize how the journal table determines columns:
     - start from that user’s `column_order`
     - filter by that user’s `visible_columns`
     - exclude that user’s `deleted_system_fields`
     - append only that user’s active custom fields
   - Pass/use this effective column list in `TradeTable` so the rendered table order is not just global defaults.
   - Wire the table header “Hide column” menu to update the current user’s settings instead of doing nothing.
   - Ensure newly added fields only appear for the user who created/restored them.

5. Keep detail sidebar/layout in sync
   - Detail layout will use the same deleted-field registry.
   - Deleted fields will not be auto-appended back by defaults.
   - Restoring a deleted field will restore it to table/detail as appropriate.
   - Detail layout labels will respect renamed field labels consistently.

6. Finish planned/actual table edit coverage
   - Add editable table cells for:
     - `actual_profile`
     - `regime` / planned regime
     - `actual_regime`
   - Keep `model` / `actual_model`, `alignment`, `entry_timeframes`, `profile`, `emotion`, and `place` editable.

7. Verification
   - Verify User A deleting a non-core field does not affect User B.
   - Verify field delete no longer just moves it to normal hidden fields.
   - Verify restore works from the deleted-fields area.
   - Verify table ordering actually follows the user’s own order.
   - Verify header hide works.
   - Verify planned/actual fields are editable from both table and trade detail.

Files expected to change:
- `src/types/settings.ts`
- `src/hooks/useUserSettings.tsx`
- `src/components/journal/TradeTable.tsx`
- `src/components/journal/settings/FieldsPanel.tsx`
- `src/components/journal/settings/DetailLayoutPanel.tsx`
- possibly `src/pages/Journal.tsx` if the table needs the full settings object passed in
- one backend migration to add the per-user deleted-field setting

No per-user physical database tables should be created. That would become hard to maintain and risky. The correct Notion-like model is one shared app schema with per-user field definitions, layout, visibility, ordering, and deleted-field tombstones.