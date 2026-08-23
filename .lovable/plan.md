# Custom journal fields: make them editable and reachable in the detail panel

Your custom fields (Ideal Entry Window, Ideal Stop-Loss, Ideal Stop-Loss Position, MFE (RR), MAE) exist and are active, and they sit in your table column order — but they are missing from every detail group in your saved layout, and there is currently no way to add them to one. On the table they also render the wrong control. Four concrete defects, confirmed by reading the code and your stored layout.

## What's actually broken

1. **Custom fields never render their own cell.** `FieldCell` routes by value type only: a custom `select` falls into the shared `SelectCell`, which reads options from the global property store (so it shows every system option, not your two) and writes to `trades.<column>` — a column that doesn't exist, so the edit silently does nothing. Custom `number` fields (Ideal Stop-Loss, MFE, MAE) fall through to the read-only branch and can't be edited at all. A correct `CustomFieldCell` already exists but is only wired into legacy call sites.
2. **No way to put a field into a detail group.** The Detail tab only lists fields already inside a group. The "Hidden / deleted" restore list explicitly skips any field present in `table.order` — which is exactly where all five custom fields live — so they are unreachable from the settings UI.
3. **`removed` and `detail.hidden` are ignored when rendering.** Your layout has `removed: [profile, actual_profile, regime, place]` and `detail.hidden: [account_pct]`, yet the properties sidebar renders every field listed in a group regardless. Deleting or hiding a field from the detail view doesn't stick.
4. **Empty arrays can't be saved.** `normalizeLayout` falls back to the legacy-migrated layout whenever a stored array is empty (`.length ?`), so "unhide everything" or "clear all hidden" silently reverts to old values on the next load.

## The fix

**Custom field cells**
- Route `field.source.kind === "custom"` in `FieldCell` to `CustomFieldCell` (via the existing wrapper), passing the resolved label and `legIds`.
- Extend `CustomFieldCell` with optional `legIds` and `label`: fan writes out to every leg of a grouped trade, and use the renamed label as the placeholder.

**Reachability in settings**
- Add an "Add field" picker to each detail group in `FieldsPanel`, listing every detail-capable field not already in a group and not removed. Selecting one drops it from `detail.hidden`, removes it from any other group, and appends it to the chosen group.
- Stop the hidden/restore list from skipping fields that are only present in `table.order`, so nothing can become unreachable again.

**Honour hidden and removed**
- `TradeProperties`: filter group fields through `detail.hidden` and `removed`.
- `TradeTable`: add `removed` to the hidden set used for column resolution.

**Layout persistence**
- `normalizeLayout`: switch the `.length ?` fallbacks to presence checks (`!== undefined`) so an intentionally empty array persists.
- `saveLayout`: keep `detail.order` in sync with the flattened group order instead of leaving it stale.

## Verification

- Open a trade, add MFE/MAE/Ideal Stop-Loss to a detail group, set values, reload — values persist and appear in both the sidebar and the table.
- Ideal Stop-Loss Position shows only its own two options, in both surfaces.
- On a grouped trade, a custom field edit writes to every leg (checked in the database).
- Hide a detail field and delete a system field — both disappear from the sidebar and stay gone after reload.
