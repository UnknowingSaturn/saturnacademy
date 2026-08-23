# Custom fields in the detail panel + a Notion-style Fields panel

Two separate problems: the detail rows print raw field keys, and the Fields settings panel shows a confusing "Hidden / deleted" bucket full of fields that are actually visible somewhere.

## 1. Raw keys instead of names in the sidebar

`TradeProperties` resolves a row's label from the static system registry only, so any custom field falls back to its storage key: `cf_ideal_entry_window_jdl1`, `cf_mae_rpvr`, and so on. The same unresolved key is then handed to the cell as its empty-state placeholder, which is why the row reads the key twice.

Fix: resolve labels from the built registry (system + custom) so the rows read **Ideal Entry Window**, **Ideal Stop-Loss Position**, **Ideal Stop-Loss**, **MFE (RR)**, **MAE**. Tighten the row so the label column truncates with a tooltip and the value column keeps a stable width — no more text running off the panel edge.

Your data for these fields is intact (97 trades carry an Ideal Entry Window value, 71 an Ideal Stop-Loss Position, 70 an Ideal Stop-Loss); once the labels resolve, the values render normally.

## 2. Rebuild the Fields panel around one list

Today there are three places a field can appear — the Table tab, the Detail tab, and a "Hidden / deleted" bucket — and a field hidden in one surface but visible in the other shows up in the bucket with a **Restore** button. That is the duplication you're seeing.

New structure, Notion-style:

```text
Fields                                    [+ New field]
─────────────────────────────────────────────────────
  ⠿  Ideal Entry Window        Select    [Table ●] [Detail ● Setup ▾]  ⋯
  ⠿  Ideal Stop-Loss           Number    [Table ○] [Detail ● Setup ▾]  ⋯
  ⠿  MAE                       Number    [Table ●] [Detail ● Risk  ▾]  ⋯
─────────────────────────────────────────────────────
Deleted fields (2)                              Restore
```

- **One row per field**, listing every system and custom field once. Each row carries the field name (inline-rename), its type, two surface toggles (Table / Detail), and a group picker for its detail placement. Drag to reorder.
- Toggling **Detail** on a field with no group drops it into a sensible default group; the picker moves it between groups. This replaces the separate "Add field" pickers.
- **Deleted fields** becomes its own small section at the bottom, containing only fields actually in `removed`. Restore puts a field back into the main list. Fields merely hidden on one surface never appear there — their state is already visible as an unlit toggle in their row.
- The Sections tab keeps group creation, renaming, reordering and deletion; field-to-group assignment now also works from the main list.

## Technical notes

- `src/components/journal/TradeProperties.tsx`: label resolution via `buildFieldRegistry` map; `PropertyRow` gets truncation and a fixed label column.
- `src/lib/journalFields/registry.ts`: `resolveFieldLabel` gains a registry-aware overload so all surfaces resolve identically.
- `src/components/journal/settings/FieldsPanel.tsx`: replaces the Table/Detail/hidden split with a single ordered list plus a `Deleted fields` section; writes the same `journal_field_layout` shape (`table.order/hidden`, `detail.groups/hidden`, `removed`, `labels`) so nothing needs migrating.
- No database or migration changes.

## Verification

- Add all five custom fields to detail groups; each shows its proper name and its stored value, and edits persist after reload.
- A field hidden only on the table appears once, in the main list, with the Table toggle off — and is absent from Deleted fields.
- Deleting and restoring a system field round-trips.
