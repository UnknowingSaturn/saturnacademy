
## Where we are

Last loop introduced `ReportTradeEditor`, the lightbox, daily/weekly/custom presets and the public payload override pipeline — but `SharedReportEditor.tsx` still references a removed `handleCaptionChange` helper and an unimported `X` icon, so the project does not build. Sensei delete, prompt tightening, and dedupe were not started.

## What I'll finish in this pass

### 1. Fix the Shared Report editor (`src/pages/SharedReportEditor.tsx`)
- Replace the broken caption block (lines ~243‑274) with the real `ReportTradeEditor`, passing in `link`, the live trade fallback values (`liveSymbol`, `liveDirection`, `liveEntryTime`, `liveSession`, `livePlaybookName`), the source screenshots, position controls (`onMoveUp` / `onMoveDown` reusing `handleMoveCard`), `onRemove`, and `onPatch` (uses `handlePatchTrade`).
- Drop the leftover `CaptionInput` / `handleCaptionChange` / unused `X` imports — captions live inside `ReportTradeEditor` now.
- Result: full per-trade editing (symbol, direction, entry time, session, playbook, screenshot reorder/hide/edit, captions) renders inline next to each preview card.

### 2. Sensei Reports — delete from sidebar (`src/components/reports/ReportSidebar.tsx` + `src/pages/Reports.tsx`)
- Add a small trash icon that appears on row hover, wired to `useDeleteReport` with a confirm dialog.
- Pass an `onDelete(id)` prop from `Reports.tsx`. After delete, if the deleted report was selected, clear `selectedId` so the empty state shows again.

### 3. Sensei AI — be more helpful, less guessy (`supabase/functions/generate-report/index.ts`)
- Drop `temperature` from `0.7` → `0.4` in `callSensei`.
- Add evidence-only rules to the system prompt:
  - "If a number, behavior, or pattern is not in the supplied data, say *'I don't have enough evidence yet'* in that section instead of guessing."
  - "If `top_emotions` is empty or all sample sizes are too small, do not assert emotional patterns — name the journaling gap as the bleed instead."
  - "If `tilt_sequences` is empty, the Pattern Underneath section must say so explicitly rather than invent a tilt narrative."
- Add a runtime guard: when there are fewer than 3 closed trades or fewer than 2 reviewed trades, skip the LLM call entirely and write a "Not enough data yet — log more trades and reviews" placeholder verdict + sections, so the AI never fabricates a story over thin data.

### 4. Smarter schema suggestions (`supabase/functions/generate-report/index.ts`)
- Extend `schemaSuggestions` to also pull `custom_field_definitions` (columns the user already added) AND a hardcoded set of system column keys that already exist on every trade: `mistakes`, `did_well`, `to_improve`, `psychology_notes`, `emotional_state_before`, `emotional_state_after`, `news_risk`, `regime`, `score`, `checklist_answers`, plus the live‑trade question ids.
- Build a single `existingFieldKeys: Set<string>` covering all three sources, then skip any suggestion whose `proposed_question.id` OR a normalized form of its `label` ("primary cause of mistake" → "mistake", "minutes since your last trade" → "time since last trade") collides with an existing key/label.
- Rationale: this is exactly the case where the AI suggested adding a "Mistakes" field that already exists in `trade_reviews.mistakes`.

### 5. Frontend dedupe safety net (`src/components/reports/SchemaSuggestionCard.tsx` + `src/components/reports/ReportView.tsx`)
- Before rendering the suggestion list, fetch `custom_field_definitions` (one query, cached) and the user's live‑trade questions, and filter out any suggestion whose id/label already exists. This protects historical reports that were generated before the backend dedupe shipped.

## What I will NOT touch this loop
- The `EducationalTradeCard` lightbox (already shipped & working).
- The `get-shared-report` override pipeline (already shipped & working).
- Database schema (the override columns + `screenshot_overrides` jsonb already exist from last migration).

## Files

**Edited**
- `src/pages/SharedReportEditor.tsx` — wire `ReportTradeEditor`, remove dead code/imports
- `src/components/reports/ReportSidebar.tsx` — add hover delete button
- `src/pages/Reports.tsx` — pass `onDelete`, clear selection on delete
- `supabase/functions/generate-report/index.ts` — temp 0.4, evidence-only rules, low-data guard, dedupe with custom_field_definitions + system keys
- `src/components/reports/ReportView.tsx` — filter `schema_suggestions` against existing fields before rendering
- `src/components/reports/SchemaSuggestionCard.tsx` — minor: rely on parent to filter (no behavior change beyond hook order)

**Edge functions to deploy**: `generate-report`

After this loop the editor builds again, you can delete Sensei reports inline, the AI will refuse to fabricate when data is thin, and the "add to journal" suggestions will only show fields you actually don't have yet.
