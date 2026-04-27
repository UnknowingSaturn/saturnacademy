## Goal

Make the shared report's **title and date range adapt automatically to the trades you pick**, and make the **trade picker easier to filter by date** (so daily/weekly reports are quick to build).

---

## What changes

### 1. Auto-adapting title & date range

Right now the title and `From`/`To` dates are blind manual inputs. We'll derive them from the actually picked trades:

- **Auto date range** — Whenever the picked-trade set changes, recompute `period_start = min(entry_time)` and `period_end = max(entry_time)` across selected trades and save them automatically.
- **Auto title** — If the user hasn't manually typed a custom title (we track an `auto_title` flag), regenerate the title from the picked-trade date range:
  - 1 day → `"Daily recap — Apr 27, 2026"`
  - same week → `"Week of Apr 21 – Apr 27, 2026"`
  - same month → `"April 2026 recap"`
  - cross-month → `"Apr 21 – May 3, 2026"`
- The `Title` field shows a small **"Auto"** badge when auto-generated. As soon as the user edits it, the badge disappears and we stop overwriting it. A small **↻ Reset to auto** button lets them snap back.
- The `From`/`To` inputs become **read-only display fields** by default (showing the auto-detected range from picks), with an **"Override dates"** toggle for users who want to manually widen the period (e.g., to mention context outside their selected trades).

### 2. Easier trade-picker filtering

Replace the single search box with stacked, compact filters in the Pick Trades panel:

- **Quick chips**: `Today` · `Yesterday` · `This week` · `Last week` · `This month` · `Custom`
- **Custom range**: when `Custom` is selected, two compact date inputs appear (From / To)
- **Symbol/session search**: keep the existing free-text search below the chips
- **Group by day**: results render grouped under sticky day headers (e.g., `Mon, Apr 27 · 8 trades`) so daily/weekly picking is visual
- **"Select all visible"** action at the top of the list — one click adds every trade currently in the filtered view to the report (and the inverse "Clear visible")
- Bump the result cap from 100 to a much higher number when a date filter is active (since filters already narrow it)

### 3. Live-preview header reflects auto values

The right-hand live preview already shows title + date range, so it will automatically update as picks change. No extra work there beyond making sure the formatted range matches the auto-title style (single-day shows just one date, etc.).

---

## Technical notes

**Files to edit**
- `src/pages/SharedReportEditor.tsx` — add auto-title/auto-date logic, derived `pickedTrades` memo, "Auto" badge + reset button, override toggle for dates.
- `src/components/shared-reports/TradePickerPanel.tsx` — add date-range chip filter, custom range inputs, day-group rendering, "Select all visible" action. Accepts an optional `onBulkAdd` / `onBulkRemove` from the editor.
- `src/types/sharedReports.ts` — add `auto_title: boolean` to `SharedReport` interface.
- `supabase/migrations/<timestamp>_shared_reports_auto_title.sql` — add `auto_title boolean not null default true` to `shared_reports`.

**Auto-title formatting helper** lives inline in the editor (small pure function using `date-fns` `isSameDay`, `isSameWeek`, `isSameMonth`, `format`).

**Save behavior** — auto-derived title/dates are debounced through the existing `debouncedSave` mutation, so no extra network chatter.

**Backwards-compatible** — existing reports default to `auto_title = true`; first edit sets it to `false`. New reports start auto.

---

## Out of scope

- Changing the visual layout of the editor's three columns
- Changing the public report renderer
- Multi-account-aware date filtering (the picker already shows trades from the active account filter)
