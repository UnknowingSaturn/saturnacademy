

# Live Trade Input Saving + Optional Playbook

## Direct answers

### 1. Does input save as you enter values, or do you lose progress?

**Mostly auto-saves, with two gaps.**

**What auto-saves correctly today:**
- ✅ **Compliance checkboxes** (`LiveTradeCompliancePanel`) — debounced 500ms via `upsertReview`, with a flush-on-unmount fallback. So ticking a checklist item, then switching trades or navigating away, persists to `trade_reviews`.
- ✅ **Screenshots** — saved immediately when added (no debounce needed).
- ✅ **Trade Properties** (session, emotion, model, alignment, etc.) — `TradeProperties` calls `updateTrade` / `upsertReview` on every change, no debounce gap.

**What does NOT save (the gap):**
- ❌ **`ModelSelectionPrompt`** — the playbook dropdown only persists when you click **"Continue with Compliance Check"**. If you select a playbook, then navigate away or switch trades without clicking the button, the selection is lost.
- ❌ **`live_trade_questions`** custom Q&A defined on `user_settings.live_trade_questions` (emotional_state, setup_confidence, entry_reasoning, market_context) is **not rendered anywhere** in the live panel. The schema exists, the default JSON is there, but no component reads/writes it. So users can't currently fill those in at all.

### 2. Make playbook optional for live trades — yes, this is the right call

Currently the live panel is **gated** on a playbook: if `selectedTrade.playbook_id` is missing, you only see `ModelSelectionPrompt` and nothing else. You can't journal, add screenshots, set properties, or answer custom questions without first picking a playbook. That's overly restrictive — many trades are taken outside any defined playbook (news, scalps, exploratory) and the user still wants to capture context.

## Plan

### A. Make playbook optional in the live panel

In `src/pages/LiveTrades.tsx`:
- Stop using `ModelSelectionPrompt` as a hard gate. Always render `LiveTradeCompliancePanel`.
- Pass `playbook` as `Playbook | null` instead of required.

In `src/components/journal/LiveTradeCompliancePanel.tsx`:
- Accept `playbook: Playbook | null`.
- When `playbook` is null:
  - Hide the compliance score ring header — show a small "No playbook" pill with an inline **"Attach playbook"** button (opens a compact Select inline; same `updateTrade({ playbook_id })` call as the prompt does today).
  - Hide Confirmation / Invalidation / Checklist / Management Tips / Failure Modes / Auto-Verified sections.
  - Keep visible: Screenshots, Trade Properties, and the new Custom Questions section (B).
- When playbook is set: show everything as today, plus the new Custom Questions section.

### B. Wire up `live_trade_questions` (auto-save in real time)

Add a new `LiveTradeQuestionsPanel` component rendered inside `LiveTradeCompliancePanel` (visible whether or not a playbook is set):
- Read `user_settings.live_trade_questions` (already loaded via `useUserSettings`).
- Render each question by type: `text` → textarea, `select` → BadgeSelect, `rating` → 1-5 stars/buttons.
- Store answers inside `trade_reviews.checklist_answers` under a reserved namespace key (e.g. `__live_questions.<questionId>`) so it doesn't collide with playbook checklist IDs and survives without a schema change.
- Auto-save with the same 500ms debounce + flush-on-unmount pattern already used in `LiveTradeCompliancePanel` (reuse `upsertReview` mutation, register `'questions'` in `pendingSavesRef`).
- Hydrate initial values from `existingReview.checklist_answers` using the prefix.

### C. Fix the playbook-selection persistence gap

In `ModelSelectionPrompt` (still used as an inline "attach playbook" UI in B):
- Auto-save `playbook_id` on selection change (no need to wait for confirm button) — calls `updateTrade.mutate({ id, playbook_id })` immediately.
- Keep the visual confirm button but it's now a no-op "Continue" navigation cue rather than the save trigger.

### D. Tiny context/type fix

`LiveTradesContext.registerPendingSave` types include `'questions'` but the implementation Set is typed `Set<'chat' | 'compliance'>`. Widen the inner Set type to `Set<'chat' | 'compliance' | 'questions'>` so the new questions flow can register cleanly. (Pure TS fix, no behavior change.)

### What stays the same

- Compliance checkboxes, screenshots, trade properties — already auto-save, no change.
- DB schema (`trade_reviews.checklist_answers` is `jsonb`, already accommodates extra keys).
- RLS, edge functions, migrations — none needed.

## Files

| File | Change |
|------|--------|
| `src/pages/LiveTrades.tsx` | Drop the `playbook_id` gate; always render `LiveTradeCompliancePanel`, pass `playbook \| null` |
| `src/components/journal/LiveTradeCompliancePanel.tsx` | Accept nullable playbook; hide playbook-driven sections when null; show inline "Attach playbook" CTA; render new questions panel |
| `src/components/journal/LiveTradeQuestionsPanel.tsx` (NEW) | Renders `live_trade_questions`, auto-saves into `trade_reviews.checklist_answers` under `__live_questions.*` prefix |
| `src/components/journal/ModelSelectionPrompt.tsx` | Auto-save `playbook_id` on selection (no longer requires Continue click) |
| `src/contexts/LiveTradesContext.tsx` | Widen pending-saves Set type to include `'questions'` |

No DB migrations. No edge function changes. No new dependencies.

