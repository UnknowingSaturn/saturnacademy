The current implementation made layout configurable, but it still splits field management across separate places and does not fully support Notion-style editing of every non-core field. I’ll tighten the architecture so settings can add options, rename fields, soft-delete fields, restore them, and hard-delete custom fields where safe.

## Plan

### 1. Make “Fields” the main customization panel
Replace the current confusing split where:

- Fields = dropdown options only
- Layout = detail sidebar visibility/order
- Columns = table visibility/order/custom fields

with a clearer Fields workflow:

- Field name editing
- Table visibility
- Trade-detail visibility
- Reordering
- Dropdown option editing for select fields
- Add custom field
- Delete / restore / hard delete where allowed

The existing Columns and Layout logic can remain internally, but the user-facing settings should feel like one schema editor instead of three disconnected panels.

### 2. Define field deletion rules explicitly
Implement three field categories:

```text
Core fields
- Cannot be hard deleted
- Can be hidden/soft deleted from views where safe
- Examples: date, pair, direction, P&L, prices, lots, trade number

Editable system fields
- Cannot be hard deleted as database columns
- Can be renamed, hidden/soft deleted, restored
- Can optionally erase field values where safe
- Examples: session, profile, regime, emotion, place, timeframes, planned/actual model

Custom fields
- Can be renamed, edited, soft deleted/restored
- Can have options added/renamed/deleted for select/multi-select fields
- Can be hard deleted from the field definition
- Can optionally erase values from all trades before/with hard delete
```

### 3. Add real field label overrides for the detail sidebar
Right now system column renames apply mainly to the table. I’ll extend the settings model so renamed labels are used consistently in:

- Journal table headers
- Trade detail sidebar property labels
- Layout/fields settings rows

This means renaming “Profile” to something else will update the journal wherever that field appears, not only in the table.

### 4. Fix dropdown option management
Update option handling so system dropdowns and custom dropdowns both support:

- Add option
- Rename option
- Change color
- Reorder option
- Soft delete option / hide from dropdown
- Restore hidden option
- Hard delete option from the option list

Historical trades will stay safe: if an old trade still uses a deleted option value, the stored value will not be silently rewritten.

### 5. Upgrade custom field editing
Improve custom fields so they behave like Notion properties:

- Add custom field from Fields settings
- Rename custom field
- Edit select/multi-select options after creation
- Soft delete custom field by setting it inactive
- Show hidden custom fields in a restore/manage section
- Hard delete the custom field definition
- Offer an explicit “erase values from all trades” action before or alongside hard delete

### 6. Sync table and trade-detail layout settings
When a field is soft deleted or restored, update both table and detail settings where applicable:

- Soft delete removes it from table visibility/order and detail visibility/order
- Restore adds it back to both views
- Reordering can remain separate per view, but the settings UI will make both controls accessible from the same field row

Review sections like Screenshots, Checklist, Psychology Notes, Mistakes, etc. will remain configurable as layout blocks and not be treated like database fields.

### 7. Technical implementation

- Add/extend typed settings helpers in `src/types/settings.ts` for field categories, core protection, and label overrides.
- Extend `user_settings` with a detail/system label override JSON field if needed, instead of hardcoding labels in `DETAIL_FIELD_CATALOG`.
- Refactor `DetailLayoutPanel`, `ColumnConfigPanel`, and `PropertyOptionsPanel` into a unified field-management experience, reusing existing hooks where possible.
- Update `TradeProperties.tsx` to resolve field labels from user overrides instead of hardcoded labels.
- Update dropdown option hooks to support active/inactive option visibility and hard delete semantics.
- Keep generated backend client/type files untouched.

## Expected result

After this pass, you should be able to open Journal Settings and fully manage the journal schema:

- Add fields
- Rename fields
- Add dropdown options
- Rename/delete/restore dropdown options
- Hide or soft-delete non-core fields
- Restore hidden fields
- Hard-delete custom fields
- Keep core trade record fields protected from destructive deletion
- See changes reflected in both the table and each trade’s detail journal