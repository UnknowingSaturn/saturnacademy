## Goal

The two `first_half_setup` / `second_half_setup` fields exist on the trade and in the side panel, but the Journal itself doesn't let you scan, filter, or quickly mark them across many trades. This plan makes them first-class in the Journal table — because these fields are *retrospective* (you know if the second-half setup worked only after the hour closes), the table grid is where they belong, not the new-trade form.

## What changes for the user

**1. Two new columns in the Journal table**

- `1st-half (≤ :30)` and `2nd-half (> :30)` — sortable, filterable, inline-editable like `Session` or `Profile` today.
- Each cell is a compact pill: `—` (unset), `None`, **Worked** (green), **Failed** (red). Click to change, no modal.
- Hidden by default. User enables them from **Settings → Fields** so existing layouts aren't disturbed.

**2. Filter support**

- New options in the FilterBar's column dropdown for both fields with `equals` / `not_equals` / `is_empty` / `is_not_empty` operators.
- This is what makes the field actually useful: "show me all GBP trades where 1st-half = Worked" answers the rule-rewrite question directly.

**3. Bulk-edit from the table**

- When 2+ rows are selected, the existing BulkActionBar gains a `Set 1st-half / 2nd-half` action. Lets you back-fill a week of trades in under a minute when starting to use these fields.

**4. Calendar view tag (small)**

- The day-cell on the Calendar view shows a tiny `1▲ 2▼` badge if any trade on that day has a worked-1st or worked-2nd setup logged. Read-only — clicking the day opens the trade detail as today.

**5. Not in the new-trade form**

- Deliberately excluded. At entry time the 2nd-half setup hasn't formed yet; forcing the user to guess pollutes the dataset. They get marked from the Journal table after the hour closes.

## Why this is the right shape

- **Retrospective fields belong in the grid, not the entry form.** Inline-editable cells match how the user already grades planned vs actual profile / regime — same muscle memory, same component (`BadgeSelect`).
- **Filtering is the primary unlock.** Once you can isolate `GBPUSD AND 1st-half = Worked` in one click, the Pair Lab Timing tab's per-pair numbers become directly auditable: you can see the individual trades behind each hit-rate.
- **Bulk-edit removes the back-fill tax.** Without it, building the first 20–30 logged hours feels like a chore; with it, a Sunday review session populates a week of trades quickly.
- **Hidden by default.** Users who don't want this analysis don't see extra columns. Opt-in mirrors how every other editable property in this app works.

## Technical details

**Touched files:**
- `src/types/settings.ts` — append two entries to `DEFAULT_COLUMNS` (type `select`, category `editable`, default-hidden). Reuse the same `HOUR_SETUP_OPTIONS` enum defined in `TradeProperties` — extract to a shared `src/lib/hourSetup.ts` so both the sidebar and the table read one source of truth (label, color, value).
- `src/components/journal/TradeTable.tsx` — add render + inline-edit handlers for the two new keys; wire to `useUpdateTrade` for the same optimistic-update pattern used by `session` / `profile`.
- `src/components/journal/FilterBar.tsx` — register the two columns in the filterable-column list. No new operator needed; reuse the existing `select` filter machinery.
- `src/components/journal/BulkActionBar.tsx` — add two menu items under a new `Set hour setup` submenu; each opens a small popover with None / Worked / Failed and writes via a bulk `update().in('id', ids)` call (same pattern as the existing bulk-archive).
- `src/components/journal/JournalCalendarView.tsx` — small badge on day cells; cheap derived value, no new query.
- `src/components/journal/settings/` (the Fields settings dialog, if present) — the two new columns appear automatically because `DEFAULT_COLUMNS` is the source of truth; verify the toggles render.
- `.lovable/plan.md` — append note.

**No schema changes.** Columns already exist on `trades`; `useUpdateTrade` already allow-lists them.

**Performance:** Two text cells with three possible values — no cost. No new queries; filter happens client-side over the already-loaded trades query.

## Out of scope

- A separate "review the hour" workflow (modal that prompts for both halves after the hour closes). Useful, but adds workflow surface — revisit if back-filling from the table feels too manual after a week of use.
- Logging hours you did NOT trade. Still the bigger selection-bias fix, still out of scope until the in-table flow proves the analysis is worth the effort.
- Hindsight grading split (planned vs actual outcome) — these fields are pure observation, no planned/actual duality needed.
