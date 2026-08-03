# Journal Fields — Registry Redesign

## What's actually broken (verified in code + DB)

**Dead menu entries.** `DEFAULT_COLUMNS` advertises columns the table cannot draw. `TradeTable` has hard-coded `if (key === …)` branches for ~20 keys; anything else falls through to `String(trade[key])`. So:
- `account_pct` ("Acct %") — no such column on `trades`, no renderer → always "—". It *is* computed correctly in the detail panel.
- `regime` (Planned Regime) — lives on `trade_reviews`, not `trades` → always "—" in the table.
- `actual_profile` / `actual_regime` — raw enum strings, no badge, no editing.
- `duration_seconds` — the table *can* render it, but it's not in the catalog, so it can never be switched on.

**Surfaces are two separate hard-coded lists.** A field appears in the table only if it's in `DEFAULT_COLUMNS`, and in the detail panel only if it's in `DETAIL_FIELD_CATALOG`. `FieldsPanel` reads `isInTable`/`isInDetail` from those lists and hides the toggle when absent — that's why Acct %, Result and Type have no Detail switch and Emotion/Place can't be reasoned about consistently. There is no mechanism to put a field on a surface it wasn't statically born into.

**Swapped and drifting labels.** `alignment` is "Entry" in the table but "HTF Timeframes" in detail; `entry_timeframes` is "Alignment" in the table but "Entry Timeframes" in detail — the two are literally crossed. `r_multiple_actual` is "RR" in the table and "% of Account" in detail while actually rendering account percentage. Option sources disagree too: `entry_timeframes` pulls the `timeframe` list in detail and `entry_timeframe` in the fields panel.

**A feature that saves nothing.** `SystemFieldConfigDialog` writes `custom_field_definitions` rows with `scope='system_override'`, but no renderer ever reads them — `overrideByKey` is passed into the dialog and otherwise unused. "Configure type & options…" appears to work and changes nothing.

**Two competing removal concepts.** `deleted_system_fields` tombstones and "not in `column_order`" both produce "hidden fields", listed together with different restore semantics.

## Redesign

### 1. One field registry (`src/lib/journalFields/`)
Replace `DEFAULT_COLUMNS` + `DETAIL_FIELD_CATALOG` + `SYSTEM_FIELD_SOURCES` + `SYSTEM_OPTION_PROPERTY` with a single descriptor per field:

```text
{ key, label, group, valueType, source, editor, optionsProperty,
  surfaces: ['table','detail'], core, erasable, width }
```
`source` is explicit: `trades.<col>` | `trade_reviews.<col>` | `computed` | `custom`. `valueType` (`text | number | money | percent | date | badge | select | multi_select | playbook | account | duration`) drives generic read/write, so every field works on both surfaces by default.

### 2. Generic renderers, custom only as opt-in
`TradeTable` and `TradeProperties` both render through `<FieldCell field surface trade />`, which dispatches on `valueType`. The handful of genuinely special cells (Result badge with the W/L/BE mix, Symbol with the leg-group chip, Status, Closes) stay as registered per-key overrides. Net effect: enabling any field on any surface produces a real, editable cell — no more blank columns, and the Detail toggle exists for every field.

### 3. Fix the real fields, drop the fake ones
- `account_pct` → `computed` percent, reusing the detail-panel formula (per-trade equity base: `equity_at_entry` → `balance_at_entry` → account equity → starting balance).
- `regime` → sourced from `trade_reviews.regime`, editable badge on both surfaces.
- `actual_profile` / `actual_regime` → proper badge selects with their option lists.
- `duration_seconds` → registered so it can be enabled.
- `r_multiple_actual` split cleanly: RR (the R multiple) vs Acct % (percent of account) — one label per concept everywhere.
- `alignment` / `entry_timeframes` labels un-crossed, each bound to one option list (`timeframe` and `entry_timeframe`).

### 4. Per-surface layout + groups
New `user_settings.journal_field_layout jsonb`:
```text
{ table:  { order: [...], hidden: [...] },
  detail: { order: [...], hidden: [...], groups: [{id,label,fields:[...]}] },
  removed: [...],
  labels:  { key: "Custom name" } }
```
One migration adds the column and back-fills it from `visible_columns` / `column_order` / `detail_*` / `field_label_overrides` / `deleted_system_fields`, applying the existing legacy-key migration. Old columns stay in place, unread, for one release as a rollback path.

Detail groups are user-owned: create, rename, reorder, delete, drag fields between them. Ungrouped fields land in a default "Properties" group.

### 5. Settings dialog rewrite
`FieldsPanel` gets a **Table / Detail** switch:
- **Table view** — drag to reorder columns, per-row visibility, width.
- **Detail view** — grouped list; drag within and across groups; group header actions.
- Shared per-field row: rename (+ reset), edit options inline, delete/hide, "also show on the other surface" toggle.
- One removal concept: **Hide** (off this surface, still listed) vs **Remove** (moves to a "Removed" drawer, restorable, offers erase-data when the field has a real source).
- Core fields can be hidden and renamed, never removed — unchanged.

### 6. System field overrides
Wire them in: an override row supplies the option list/type used by the renderer for that system key, so "Configure type & options…" actually changes what you see. If a key's editor can't honour an override (playbook, account, computed), the dialog hides that action instead of pretending.

## Technical notes
- New: `src/lib/journalFields/registry.ts`, `resolve.ts` (read/write a field's value for a trade), `FieldCell.tsx`.
- Rewritten: `FieldsPanel.tsx` (+ `fields/` children), `TradeProperties.tsx`, the column-render section of `TradeTable.tsx`.
- `src/types/settings.ts` keeps `buildColumnRegistry` etc. as thin adapters over the registry so `FilterBar`, `ColumnHeaderMenu`, `JournalCalendarView`, exports and Pair Lab keep working without a rewrite.
- One migration (adds `journal_field_layout`); a client-side back-fill runs on first load for users whose column is empty.
- Vitest coverage: every registry entry resolves a value for a synthetic trade on both surfaces (the guard that would have caught `account_pct`), and layout back-fill from legacy settings is snapshot-tested.

## Risks
- Rewriting the detail panel touches every editable field; the group fan-out for multi-leg trades must be preserved exactly.
- Users with heavily customised layouts depend on the back-fill being right — hence keeping the old columns readable for a release.
