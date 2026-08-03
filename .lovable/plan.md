## What I checked

- `src/lib/journalFields/registry.ts` — today every field marked `core` is undeletable and every `system` field is `erasable: true`, with no relationship to what analytics actually consume.
- Pair Lab usage (`src/components/pair-lab/*`, `pairLabMath.ts`, `pairLabSimulator.ts`, `usePairLab.tsx`): the fields it reads are `symbol`, `entry_time`, `r_multiple_actual`, `net_pnl`, `session`, `profile` (+ `actual_profile`), `regime`, `account_id`, and `place` (one spot). It does **not** read `alignment`, `entry_timeframes`, `emotional_state_before`, `duration_seconds`, `trade_type`, `read_quality`, `closes`.
- `src/pages/Journal.tsx` still feeds `TradeTable` from legacy `settings.visible_columns` / `column_order`, not the new `journal_field_layout` — so table hide/reorder done in the new panel and done from a column header currently write to two different places.

## Part 1 — Three field tiers

Replace the binary core/erasable flag with an explicit `tier` on each registry entry.

**Locked (hide only, never removable)** — identity and P&L; nothing works without them:
`trade_number`, `entry_time`, `day`, `symbol`, `account`, `direction`, `net_pnl`, `r_multiple_actual`, `account_pct`, `result`, `status`.

**Analytics-critical (removable, but with an explicit warning)** — Pair Lab / reports read these; removing them silently empties those views:
`session`, `profile`, `actual_profile`, `regime`, `actual_regime`, `model`, `actual_model`, `place`.
Delete dialog names the affected surfaces ("Pair Lab session/profile breakdowns, weekly reports") and requires confirmation; data erase stays a separate opt-in checkbox.

**Free (removable, no warning)** — journaling extras nothing computes on:
`alignment`, `entry_timeframes`, `emotional_state_before`, `duration_seconds`, `trade_type`, `read_quality`, `closes`, and all custom fields.

So: yes, most fields *should* be deletable — the current lock list is too wide (it blocks `duration_seconds`, `trade_type`, `read_quality`, `closes`) and too permissive in the other direction (it lets `session`/`profile`/`regime` go with no warning even though Pair Lab depends on them).

## Part 2 — Notion-style inline field editing

Keep the settings dialog as the "manage everything" surface, but make the common actions reachable from the page.

**Table column header menu** (`ColumnHeaderMenu.tsx`, currently sort/filter/hide/edit-options):
- Rename inline (editable header text, writes `layout.labels[key]`)
- Hide, Move left / Move right, Duplicate-free "Remove field…" (tier-aware; locked fields show Hide only)
- Edit options inline for select/multi-select fields
- Insert column left / right → popover listing hidden + removed fields, plus "New field…" which creates a custom field on the spot
- A `+` stub column at the right end of the header row opening the same picker

**Detail panel** (`TradeProperties.tsx`):
- Hover a property row → `⋮⋮` menu with Rename, Hide, Move to group ▸, Remove field
- Per-group footer "+ Add property" and a group header menu (rename, delete group)
- Bottom "+ New group"

All of these call the same layout mutations the settings panel already uses, so the two surfaces stay in sync.

## Part 3 — Fix the split source of truth

`Journal.tsx` and `TradeTable.tsx` switch to `journal_field_layout` (order, hidden, labels, widths) as the only source; the legacy `visible_columns` / `column_order` writes are dropped. Without this, inline header actions and the settings dialog keep disagreeing.

## Technical notes

- `registry.ts`: add `tier: 'locked' | 'analytics' | 'free'` and `dependents?: string[]`; drop `erasable` in favour of `tier !== 'locked'`.
- New `src/components/journal/FieldHeaderMenu.tsx` (table) and `FieldRowMenu.tsx` (detail) sharing one `useFieldLayoutActions()` hook wrapping the layout mutations in `useUserSettings`.
- `DeleteFieldDialog.tsx`: add the analytics-warning variant driven by `dependents`.
- `FieldsPanel.tsx`: read the same tier flags so the settings list and inline menus offer identical actions.
- Vitest: assert every key Pair Lab reads is tiered `locked` or `analytics` (guards against future drift), and that layout mutations from either surface produce the same result.

## Risk

Dropping the legacy `visible_columns`/`column_order` reads is the one behavioural break — the existing `migrateLegacyLayout` back-fill already covers it, but I'd keep the legacy columns written-but-unread for one release as a rollback path.
