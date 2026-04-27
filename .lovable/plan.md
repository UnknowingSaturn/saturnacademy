## Overview

Three areas to upgrade:

1. **Shared Reports (public + editor)** — add screenshot lightbox, full editability of every field per trade, and a "Daily" preset alongside the existing weekly creator.
2. **Sensei Reports** — add a Delete button on each report and stop the Sensei from guessing.
3. **Schema suggestions** — only suggest fields that don't already exist in the user's journal (live trade questions OR custom fields OR system columns like `mistakes`).

---

## 1. Shared Reports — Screenshot lightbox + per-trade editing + Daily preset

### A. Clickable screenshots with lightbox (public page + editor preview)

**File:** `src/components/shared-reports/EducationalTradeCard.tsx`
- Wrap each `<img>` in a button that opens a full-screen Dialog showing the image at native resolution with the timeframe badge and description caption.
- Add prev/next navigation when a card has multiple screenshots and keyboard support (Esc / ← / →).
- Use the existing `Dialog` primitive from `@/components/ui/dialog` so it works on both the editor preview and the public `/r/:slug` page (no separate component duplication).

### B. Full editability per trade in the editor

**File:** `src/pages/SharedReportEditor.tsx` + `src/components/shared-reports/EducationalTradeCard.tsx`

Currently only the three captions (well/wrong/improve) are editable. Add inline editing for everything that ends up on the public card:

- **Header overrides** stored in `shared_report_trades` as new optional columns (or inside an existing JSON column to avoid migration if present): `symbol_override`, `direction_override`, `entry_time_override`, `session_override`, `playbook_name_override`. When `null`, the public payload falls back to the live trade values (today's behavior).
- **Per-screenshot overrides** — extend the existing `screenshot_overrides` JSON to support `{ id, description?, timeframe?, hidden? }`. The editor surfaces a small "edit" pencil on each screenshot thumbnail (timeframe, caption, hide toggle).
- **Reorder screenshots** within a card via drag handles (persist order in `screenshot_overrides` as `sort_index`).
- The render order of the cards themselves is already controlled by `sort_order` — add up/down arrows on each card so the user can reorder without re-adding.

**Migration (additive, non-breaking):** add nullable columns to `shared_report_trades` for the override fields above, OR widen the existing `screenshot_overrides` jsonb shape — preferring widening to minimize migration surface. Bump `useUpdateReportTrade` to accept the new patch shape.

**Public payload:** update `supabase/functions/get-shared-report/index.ts` to apply overrides on top of the live trade record before returning, so the public page reflects edits.

### C. Daily report preset

**File:** `src/pages/SharedReports.tsx`
- Replace the single "New report" button with a small dropdown (split button) offering: **Daily**, **Weekly**, **Custom range**.
  - Daily → title `"<Weekday>, MMM d, yyyy"`, period_start = period_end = today.
  - Weekly → existing behavior.
  - Custom → opens a small dialog with two date pickers and a title field.
- The editor already exposes free `period_start` / `period_end` date inputs, so existing reports remain fully editable; we're only changing the creation defaults.

---

## 2. Sensei Reports — Delete + smarter, less guessing AI

### A. Delete a report

**Files:** `src/components/reports/ReportSidebar.tsx`, `src/pages/Reports.tsx`
- Add a small trash icon on hover for each row in the sidebar list. Confirms via `confirm()` then calls the existing `useDeleteReport` mutation (already implemented in `useSenseiReports.tsx`).
- After deletion, if the deleted report was selected, clear `selectedId` and let the auto-select fall back to the next report.

### B. Stop the Sensei from guessing

**File:** `supabase/functions/generate-report/index.ts`

Tighten `callSensei` so it only writes what the data supports:

- **Add explicit "evidence-only" rules to the system prompt:**
  - "If the data does not contain enough evidence for a section (e.g. no losing streak, no edge cluster, fewer than 5 reviewed trades), explicitly write a one-sentence section like *'Not enough data this week to call a pattern.'* and skip naming any pattern."
  - "Do not infer emotions, intent, or 'meta-patterns' that are not directly supported by the supplied `top_emotions`, `tilt_sequences`, `revenge`, `oversize`, or `worst_trade_narratives`."
  - "Cite at least one whitelisted trade ID for every claim that names a pattern. If you cannot, say so plainly instead of fabricating."
- **Reduce temperature** from `0.7` → `0.4` for less creative leaps.
- **Drop low-evidence sections in post-processing** (already partially done): if a non-Verdict section has zero citations AND its body contains language like "likely", "probably", "suggests", "appears to" — replace it with the canonical "not enough data this period" sentence rather than keeping a guessed paragraph.
- Add a small `evidence_summary` block to the LLM payload that explicitly tells the model what's *missing* (e.g. `"no_losing_streak": true`, `"no_revenge_pattern": true`, `"reviewed_count_low": true`) so it has explicit signals not to invent.

### C. Schema suggestions must only propose NEW fields

**File:** `supabase/functions/generate-report/index.ts` (function `schemaSuggestions`)

Today the dedupe only checks `live_trade_questions`. The user reported that "mistakes" is being re-suggested though it already exists in their journal. Expand the existence check:

1. Load the user's `custom_field_definitions` (active rows) in addition to `live_trade_questions`.
2. Build a normalized set of "field signatures" combining:
   - `id` from live_trade_questions
   - `key` (and slugified `label`) from custom_field_definitions
   - A hardcoded list of system fields already captured by the journal: `mistakes`, `did_well`, `to_improve`, `thoughts`, `psychology_notes`, `emotional_state_before`, `emotional_state_after`, `regime`, `profile`, `playbook_id`, `actual_playbook_id`, `actual_profile`, `session`.
3. Skip any candidate whose `missing_field` / `proposed_question.id` / slugified label collides with that set.
4. Rename the current `mistake_category` suggestion logic so it checks for `mistakes` (system field) first — if present, it's not re-suggested.
5. **Also dedupe in the UI** as a defensive belt-and-suspenders: in `SchemaSuggestionCard.tsx`, query `custom_field_definitions` + `live_trade_questions` and hide the card entirely if a field with the same key/label slug already exists. This protects historic reports too.

---

## Files touched

**Edited:**
- `src/components/shared-reports/EducationalTradeCard.tsx` — clickable screenshots with lightbox dialog
- `src/components/shared-reports/TradePickerPanel.tsx` (minor — show ordered chevrons context if helpful)
- `src/pages/SharedReports.tsx` — split-button with Daily / Weekly / Custom presets
- `src/pages/SharedReportEditor.tsx` — inline edit fields for header/screenshots, reorder cards
- `src/hooks/useSharedReports.tsx` — extend `useUpdateReportTrade` patch shape
- `src/types/sharedReports.ts` — extend `SharedReportTrade` and `PublicTradeCard` for overrides
- `supabase/functions/get-shared-report/index.ts` — apply overrides to public payload
- `src/components/reports/ReportSidebar.tsx` — delete-on-hover button
- `src/components/reports/SchemaSuggestionCard.tsx` — client-side dedupe against existing fields
- `supabase/functions/generate-report/index.ts` — tightened sensei prompt + temperature, evidence-only rules, expanded `schemaSuggestions` dedupe (includes `custom_field_definitions` + system fields)

**Migration:**
- Additive widening of `shared_report_trades.screenshot_overrides` shape (no schema change required — it's already `jsonb`) and addition of nullable override columns (`symbol_override`, `direction_override`, `entry_time_override`, `session_override`, `playbook_name_override`).

No destructive changes. Existing shared reports continue to render exactly as today until the user edits an override.