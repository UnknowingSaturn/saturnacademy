

# Comprehensive Page Audit & Fixes

## Summary

Three main areas of work: (1) Add date-period filtering to the Journal page, (2) Replace the AI chat in Live Trades with a structured questionnaire system, and (3) Fix gaps across all pages.

---

## Part 1: Journal — Date Period Filter (Default: Current Month)

**Problem:** Journal loads ALL trades with no date scoping, causing slow loads and overwhelming UX.

**Solution:**
- Add a period selector (This Week / This Month / Custom Range) to `Journal.tsx`, defaulting to "This Month"
- Add prev/next navigation arrows like Dashboard already has
- Filter `filteredTrades` by `entry_time` within the selected period
- Show period label (e.g. "April 2026") in the header area

**Files:** `src/pages/Journal.tsx`

---

## Part 2: Live Trades — Remove AI Chat, Add Structured Questionnaire

**Problem:** The `LiveJournalChat` component calls an AI edge function for every trade, which is slow, expensive, and produces inconsistent journaling. Users need a fast, structured way to document trades.

**Solution:**
- Remove the `LiveJournalChat` component and the Journal/Compliance tab split
- Replace with a single structured questionnaire panel that uses the playbook's `checklist_questions` plus a set of default journaling questions
- Default questions: emotional state (before), market regime, entry reasoning (free text), setup confidence (1-5), notes
- Questions are answered inline with dropdowns, toggles, and short text inputs — no AI round-trips
- Answers auto-save to `trade_reviews` (same as current compliance panel does)
- Keep the compliance checks (session/symbol validation) integrated into the same panel rather than a separate tab
- Add a "Live Trade Questions" configuration section to `JournalSettingsDialog` where users can add/edit/reorder their default live trade questions

**Files to modify:**
- `src/pages/LiveTrades.tsx` — remove Journal tab, replace with unified panel
- `src/components/journal/LiveTradeCompliancePanel.tsx` — extend to include journaling questions
- `src/components/journal/JournalSettingsDialog.tsx` — add "Live Questions" tab
- New: `src/components/journal/settings/LiveQuestionsPanel.tsx`

**Files to remove (dead code after change):**
- `src/components/live/LiveJournalChat.tsx`
- `src/components/live/QuickNoteInput.tsx` (if only used by chat)
- `supabase/functions/live-journal-chat/index.ts` (edge function no longer needed)

---

## Part 3: Page-by-Page Gap Analysis & Fixes

### Dashboard
- **OK overall.** Already has period selector, equity curve, session breakdown.
- **Gap:** No "custom date range" option — only week/month. Add a date picker for custom ranges.
- **Gap:** No account starting balance prompt when `balance_start` is 0 — equity curve shows misleading flat line.

### Analytics
- **OK.** AI-powered, has refresh, multiple sections.
- **Gap:** No date filtering — always analyzes ALL trades. Should respect the same period filter or at least offer a date range selector.
- **Minor:** The `refetch` button re-calls the edge function but doesn't pass any period context.

### Playbooks
- **Over-engineered:** The create/edit dialog is ~880 lines in a single file with 20+ state variables. This works but is hard to maintain.
- **Gap:** No way to archive/deactivate a playbook without deleting it (toggle exists in schema `is_active` but no UI toggle).
- **Action:** Add an active/inactive toggle to PlaybookCard. No refactor needed for now.

### Import
- **Gap:** CSV parser is naive — doesn't handle quoted commas, multi-line values. Not critical but worth noting.
- **Gap:** No account association — imported trades have no `account_id`, so they don't appear when filtering by account.
- **Action:** Add account selector to import flow.

### Accounts
- **OK.** Has danger zone, fresh start, recover trades.
- **Gap:** No "last seen" / heartbeat indicator from the EA. The EA now sends heartbeats but the UI doesn't show them.
- **Action:** Add a "Last seen: X minutes ago" badge to AccountCard using the latest heartbeat event timestamp.

### Live Trades
- **Bug:** Closed trades can get stuck showing as open if the realtime subscription misses the update (e.g. browser was backgrounded). The `refetchInterval: 60000` is the only fallback.
- **Action:** Reduce refetch interval to 15s for the Live Trades page, or add a "Refresh" button.

### Copier
- **OK for preview/demo mode.** No critical gaps.

---

## Part 4: Code Cleanup

- Remove `src/components/live/LiveJournalChat.tsx` (replaced)
- Remove `supabase/functions/live-journal-chat/index.ts` (no longer called)
- Remove unused imports from `LiveTrades.tsx` (`Bot` icon, etc.)
- Check if `QuickNoteInput.tsx` is used elsewhere — if not, remove

---

## Database Changes

- Add a `live_trade_questions` table or store in `user_settings` as a JSON column. Using `user_settings` is simpler — add a `live_trade_questions` jsonb column with a default set of questions.

**Migration:**
```sql
ALTER TABLE user_settings 
ADD COLUMN live_trade_questions jsonb 
DEFAULT '[
  {"id":"emotional_state","type":"select","label":"How are you feeling?","options":["Focused","Calm","Confident","Anxious","FOMO","Frustrated"]},
  {"id":"setup_confidence","type":"rating","label":"Setup confidence (1-5)"},
  {"id":"entry_reasoning","type":"text","label":"Why did you enter this trade?"},
  {"id":"market_context","type":"text","label":"Market context / regime"}
]'::jsonb;
```

---

## Implementation Order

1. Database migration (add `live_trade_questions` column)
2. Journal date period filter
3. Live Trades restructure (remove AI chat, add questionnaire)
4. Live Questions settings panel
5. Account heartbeat indicator
6. Import account selector
7. Playbook active/inactive toggle
8. Code cleanup & dead code removal
9. Reduce live trades refetch interval

