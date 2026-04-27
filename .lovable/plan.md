You’re right. The current journal has two systems fighting each other:

- Table columns are partly configurable via custom fields.
- The trade detail/sidebar is still largely hardcoded.
- “Properties” only edits option values for a fixed set of property types, not the actual properties themselves.
- The add/delete flow for property options is easy to misunderstand because it only adds/removes dropdown choices, not journal fields.

I’ll redesign this so the journal behaves more like Notion: fields can be added, hidden, renamed, reordered, edited, and removed from settings, and those choices drive both the journal table and the trade detail view.

## Plan

### 1. Consolidate settings into one “Fields” system
Replace the confusing split of “Properties” and “Columns” with a clearer settings structure:

- Fields: manage every journal field in one place
- Sessions: only for time-window/session classification
- Filters: saved filter presets

The new Fields panel will show:

- Core fields: Date, Pair, Direction, P&L, R, Result, Account, etc.
- Editable system fields: Session, Model, Actual Model, Profile, Actual Profile, Regime, Actual Regime, Timeframes, Emotion, Place
- Custom fields: user-created Notion-style fields stored in `custom_fields`
- Review blocks: Screenshots, Psychology Notes, Mistakes, What I Did Well, To Improve, Actionable Steps, Checklist

Each field/block will support the appropriate controls:

- Rename label
- Show/hide in table
- Show/hide in trade detail panel
- Reorder
- Edit dropdown options where applicable
- Add new custom field
- Soft delete / restore
- Erase values when safe and explicitly confirmed

### 2. Fix property option management immediately
Update the current property option editor so it is reliable and obvious:

- Add option saves using a stable generated value.
- Deleting an option will remove that dropdown choice from settings.
- The UI will clearly say “Dropdown options” instead of implying it deletes the entire property.
- Add missing direct management for Actual Profile / Actual Regime if shown separately.
- Keep custom hex colors working instead of mapping them down to a few theme names.

Important behavior: deleting an option should not silently rewrite historical trades. If a past trade used that deleted option, it will display the raw old value until changed, preserving historical accuracy.

### 3. Make the trade detail sidebar schema-driven
Refactor `TradeProperties.tsx` so it no longer hardcodes every visible property row.

It will render from a registry/config that understands:

- which fields are core/read-only
- which fields are editable
- which fields have dropdown options
- which fields are planned/actual pairs
- which fields are hidden by user settings
- user-renamed labels
- custom fields

This means if you hide Profile, Regime, Emotion, Place, or Timeframes in settings, they disappear from the trade detail sidebar too.

### 4. Add custom fields to the trade detail panel, not just the table
Right now custom fields exist mainly in the table. I’ll add them to the trade detail view so user-added fields are fully editable inside each journal entry.

Supported field types:

- Text
- Number
- Select
- Multi-select
- Date
- Checkbox
- URL

These will use the existing `trades.custom_fields` storage, so no new table is needed for normal custom fields.

### 5. Make journal review sections configurable
Add a user setting for journal detail layout so the larger sections can be shown/hidden and reordered:

- Screenshots
- Playbook checklist
- Psychology Notes
- Mistakes
- What I Did Well
- To Improve
- Actionable Steps

This handles “the whole journal should be editable,” not only table columns.

I’ll keep the underlying review data safe. Hiding a section will hide it from the UI only. If you choose to erase a section’s data later, that will require an explicit confirmation.

### 6. Clean up terminology and remove redundant/confusing tabs
Update labels so the system is easier to understand:

- “Fields” = journal fields/properties/columns
- “Dropdown options” = values inside select fields
- “Sessions” = session time windows only
- “Model” remains playbook-driven, because playbooks are the source of truth for model stats
- Regime/Profile can be hidden, renamed, or removed from your layout if you decide they overlap

### 7. Preserve playbook/stat accuracy
Keep the planned vs actual model logic intact:

- Planned Model = the model you intended to take
- Actual Model = hindsight classification
- Playbook stats continue to attribute by actual model where present, otherwise planned model
- Read Quality continues comparing planned vs actual

This avoids mixing mismatched model data into the wrong playbook while still letting you evaluate your read quality.

## Technical approach

- Extend `user_settings` with detail layout settings, likely JSON fields such as `detail_field_order`, `detail_visible_fields`, and `detail_section_order`.
- Reuse the existing `custom_field_definitions` and `trades.custom_fields` architecture for Notion-style user fields.
- Keep core trade fields in their existing database columns for reporting/import accuracy.
- Build a shared field registry used by both `TradeTable` and `TradeProperties`.
- Refactor settings UI around this shared registry so table/detail visibility and ordering stay in sync.
- Do not edit generated backend client/types files manually.

## Expected result

After this change, you’ll be able to go into Journal Settings and manage the journal like a Notion database:

- Add new journal fields
- Remove/hide fields you don’t want
- Rename fields
- Reorder fields
- Edit dropdown options
- Control what appears in the table and what appears inside each trade journal
- Keep existing trade data safe unless you explicitly choose to erase it