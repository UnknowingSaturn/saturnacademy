

# Codebase Validation & Cleanup Report

## Scope note

Your task list mentions "drivers, invoices, supervisors, finance, subscriptions, onboarding". **None of those exist in this project** — Ephemeris is a trading journal + MT5 trade copier. I validated against what's actually here: live-trade journaling, screenshots persistence, playbooks, copier, edge functions. If you meant a different project, let me know.

## 1. Functional verification — recent changes are correctly wired

| Area | Status | Notes |
|---|---|---|
| Partial-upsert mutation (`useUpsertTradeReview`) | ✅ Correct | Builds payload via `'field' in review` checks, lines 348-362 of `useTrades.tsx`. No defaulted columns. |
| `LiveTradeCompliancePanel` — fresh-read merge | ✅ Correct | `fetchFreshChecklistAnswers` → `buildMergedAnswers` runs before every debounced save. |
| `LiveTradeQuestionsPanel` — fresh-read merge | ✅ Correct | Same pattern, prefixes `__live_questions.*`. |
| `TradeProperties` — partial saves | ✅ Correct | `handleRegimeChange` and `handleEmotionChange` only send their own field. |
| Screenshot persistence | ✅ Fixed | `handleScreenshotsChange` only sends `screenshots` + optional `playbook_id`. |
| Optional playbook | ✅ Working | `LiveTrades.tsx` always renders `LiveTradeCompliancePanel`; no playbook gate. |
| `LiveTradesContext` pending-saves type | ✅ Widened | `Set<'chat' \| 'compliance' \| 'questions'>` matches all three flows. |
| Supabase linter | ✅ Clean | No warnings. |

## 2. Dead code to remove

These were superseded by the recent refactors and have no remaining callers:

| File / Symbol | Why it can go |
|---|---|
| `src/components/journal/ModelSelectionPrompt.tsx` | No imports anywhere. The optional-playbook flow uses an inline `Select` inside `LiveTradeCompliancePanel`. |
| `useCreateTradeReview` (in `useTrades.tsx`) | Backwards-compat shim that just re-exports `useUpsertTradeReview`. Grep finds zero callers. |
| `useUpdateTradeReview` (in `useTrades.tsx`) | Legacy partial-update hook. Zero callers — everything goes through the upsert now. |
| `LiveTrades.tsx` → `handleModelSelected` (line 74-76) | Unused after `ModelSelectionPrompt` was removed from the page. |

## 3. Minor optimization opportunities (low priority)

- `LiveTradeCompliancePanel.tsx` — the debounced save runs even when only one checkbox toggled. Already debounced at 500ms, no action needed.
- `useTrades` query — re-fetches the full graph (`*, playbook, trade_reviews, ai_reviews, account`) on every review save. Consider replacing the broad `invalidateQueries(['trades'])` in `useUpsertTradeReview.onSuccess` with a more targeted update — but only if you start seeing perceptible lag. Not urgent.
- No 1000-row Supabase limit risk on the active queries (filtered by user / date / open status).

## 4. Database integrity

- All 24 tables have RLS enabled with `auth.uid()`-scoped policies (verified via injected schema).
- No orphaned tables. Every table has a corresponding hook or edge-function consumer.
- Storage bucket `trade-screenshots` is correctly public and the URL is stored in `trade_reviews.screenshots`.
- RLS policies use `auth.uid()` directly. Wrapping in `(select auth.uid())` is a micro-optimization; only worth doing on hot multi-row tables. Skip unless profiling shows policy cost.

## 5. Edge functions — all in use

Verified in `supabase/config.toml` and consumers:
- `ingest-events`, `trades-overlay`, `backfill-trades`, `reprocess-trades`, `restore-trade-times`, `playbook-assistant`, `reprocess-orphan-exits`, `fresh-start`, `trade-analytics`, `copier-config`, `copier-update-check`, `copier-setup-token`, `strategy-lab`. All referenced. No orphans.

## 6. Items I will NOT touch

- Driver/invoice/supervisor/finance flows (don't exist).
- Subscription/onboarding flows (don't exist).
- Mobile responsiveness audit (out of scope of the recent changes; would be a separate plan).
- Multi-role testing (only one role: authenticated user — no admin/supervisor model).

## Plan

| File | Action |
|---|---|
| `src/components/journal/ModelSelectionPrompt.tsx` | **Delete** — no consumers |
| `src/hooks/useTrades.tsx` | **Remove** `useCreateTradeReview` and `useUpdateTradeReview` (lines 387-435) |
| `src/pages/LiveTrades.tsx` | **Remove** unused `handleModelSelected` (lines 74-76) |

No DB migrations, no edge function changes, no schema changes, no new dependencies.

## Validation after cleanup

1. `tsc --noEmit` → clean
2. Open live trade → upload screenshot → tick compliance → answer question → switch trade → return → all persist
3. Trade journal detail panel still saves mistakes/did_well/to_improve correctly (uses `useAutoSave` → `useUpsertTradeReview` → still partial)
4. Manual trade form still creates via `useCreateTrade` (unaffected)

