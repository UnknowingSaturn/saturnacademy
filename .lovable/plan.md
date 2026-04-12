

# Direct Journal Integration in Live Trades

## The Idea
Instead of maintaining a separate "Live Trade Questions" system that tries to mirror journal fields, embed the actual journal components directly into the Live Trade compliance panel. When a trader fills in data during a live trade, they're filling in the journal entry itself — zero duplication, zero mapping logic.

## Current Flow (Inefficient)
```text
Live Trade Panel → Custom Questions → Hardcoded mapping → trade_reviews
Journal Panel   → TradeProperties + Screenshots + Checklist → trades + trade_reviews
```
Two separate UIs writing to the same tables with fragile glue code in between.

## Proposed Flow (Direct)
```text
Live Trade Panel:
  1. Screenshots (TradeScreenshotGallery) — upload per-timeframe images
  2. Playbook Checklist (existing compliance rules)
  3. Trade Properties (TradeProperties) — emotion, session, model, profile, regime, place, etc.

All writes go directly to trades + trade_reviews tables.
Journal shows the same data — already populated.
```

## What Changes

### 1. `LiveTradeCompliancePanel.tsx` — Replace questions section with journal components
- **Remove** the entire "Trade Journal" card (lines 564-578) that renders custom `liveQuestions`
- **Remove** the `questionAnswers` state and its auto-save effect (the hardcoded mapping logic)
- **Add** a `TradeScreenshotGallery` section after the playbook checklist — this already handles upload/delete/captions with timeframe labels
- **Add** a `TradeProperties` component (the same one used in journal) — renders emotion, session, model, alignment, entry TF, profile, regime, place as BadgeSelect dropdowns
- Both components already save directly to `trades` and `trade_reviews` tables via `useUpdateTrade` and `useUpsertTradeReview`

### 2. Reorder the panel sections
The live trade panel will flow as:
1. **Score ring + playbook header** (existing)
2. **Auto-verified rules** (existing, collapsible)
3. **Confirmations checklist** (existing)
4. **Invalidation checks** (existing)
5. **Screenshots** — `TradeScreenshotGallery` for uploading chart images with timeframe + caption
6. **Trade Properties** — emotion, session, model, profile, regime, place (BadgeSelect dropdowns)
7. **Management tips** (existing)
8. **Watch out / failure modes** (existing)

### 3. Clean up unused code
- Remove `questionAnswers` state, `questionSaveRef`, and the question auto-save `useEffect`
- Remove `renderQuestion` function
- Remove import of `LiveTradeQuestion` and `DEFAULT_LIVE_TRADE_QUESTIONS`
- The `LiveQuestionsPanel` settings and `LiveTradeQuestion` type can remain for now (no breaking changes) but are no longer used by the live panel

## Files Modified
| File | Change |
|------|--------|
| `src/components/journal/LiveTradeCompliancePanel.tsx` | Replace custom questions with `TradeScreenshotGallery` + `TradeProperties`; remove question mapping logic |

## Why This Is Smartest
- **Zero duplication**: One set of components, one set of save logic
- **Already built**: `TradeProperties` and `TradeScreenshotGallery` are production-ready with auto-save
- **Instant journal sync**: Data entered during live trades appears in journal immediately — no mapping needed
- **Matches the screenshots**: Emotion/Session/Model/Profile dropdowns + chart screenshots with captions

