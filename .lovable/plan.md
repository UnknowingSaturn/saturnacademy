

# Fix Screenshot Persistence — Root-Cause Architecture Fix

## Direct answer

**No, the previous fix was not enough.** It only patched two of five clobbers. There are **five components** that all write to the same `trade_reviews` row through `useUpsertTradeReview`, and the mutation **always writes every column** (defaulting omitted ones to `[]` / `{}` / `null`). Every save by any panel can wipe data written by any other panel.

The pass-through "preserve existing values" hacks scattered across `LiveTradeCompliancePanel`, `LiveTradeQuestionsPanel`, and `TradeProperties` are band-aids that read from a stale `trade.review` snapshot — the moment two panels save within the same React Query refetch window, one wins and the other's data gets blown away (often the screenshot, since uploads are fast).

The right fix is **at the mutation layer**, not in each consumer.

## All writers to `trade_reviews` (audit)

| Component | Field it owns | Currently passes through |
|---|---|---|
| `LiveTradeCompliancePanel` (debounced) | `checklist_answers` (compliance), `score` | regime, emotional, psychology, screenshots |
| `LiveTradeCompliancePanel.handleScreenshotsChange` | `screenshots` | checklist_answers, regime, emotional, psychology |
| `LiveTradeQuestionsPanel` (debounced) | `checklist_answers` (live questions, prefixed) | regime, emotional, psychology, screenshots |
| `TradeProperties.handleRegimeChange` | `regime` | checklist_answers, emotional, psychology, screenshots |
| `TradeProperties.handleEmotionChange` | `emotional_state_before` | checklist_answers, regime, psychology, screenshots |
| `TradeDetailPanel` autosave | mistakes, did_well, to_improve, actionable_steps, thoughts, etc. | (whole review snapshot via `useAutoSave`) |

Any two of these firing close together = data loss. Screenshots lose the most because uploads return fast and immediately trigger a refetch, leaving the next debounced compliance/questions save holding a stale snapshot.

## Architecture fix — partial upsert at the mutation layer

### 1. `useUpsertTradeReview` — write only fields the caller provided

Rewrite the payload builder to use **explicit key presence** (`'field' in review`) instead of defaulting omitted fields:

```ts
const payload: Record<string, any> = { trade_id: review.trade_id };
if ('playbook_id' in review)            payload.playbook_id = review.playbook_id;
if ('score' in review)                  payload.score = review.score ?? 0;
if ('regime' in review)                 payload.regime = review.regime;
if ('news_risk' in review)              payload.news_risk = review.news_risk ?? 'none';
if ('emotional_state_before' in review) payload.emotional_state_before = review.emotional_state_before;
if ('emotional_state_after' in review)  payload.emotional_state_after = review.emotional_state_after;
if ('psychology_notes' in review)       payload.psychology_notes = review.psychology_notes;
if ('thoughts' in review)               payload.thoughts = review.thoughts;
if ('checklist_answers' in review)      payload.checklist_answers = review.checklist_answers;
if ('mistakes' in review)               payload.mistakes = review.mistakes;
if ('did_well' in review)               payload.did_well = review.did_well;
if ('to_improve' in review)             payload.to_improve = review.to_improve;
if ('actionable_steps' in review)       payload.actionable_steps = review.actionable_steps;
if ('screenshots' in review)            payload.screenshots = review.screenshots;
```

**Key safety property**: Postgres `UPSERT` only updates the columns supplied in the payload (the `INSERT … ON CONFLICT DO UPDATE SET col = EXCLUDED.col` set is implicitly limited to columns present in the INSERT). So a `screenshots`-only save updates only `screenshots` and `updated_at`. Nothing else is touched.

This is the ONLY place we need to fix it. Every consumer benefits automatically.

### 2. Special handling for the FIRST insert

There's one edge case: the very first time we upsert for a trade, the row doesn't exist yet. `score` has a default of `0` and `news_risk` defaults to `'none'` at the DB level, so omitting them is fine. `checklist_answers` defaults to `'{}'`, arrays default to `'[]'`. So we're safe — Postgres column defaults handle the insert path. No changes needed.

### 3. `checklist_answers` is shared between two panels — keep merge semantics there

Compliance and Questions both write `checklist_answers` (compliance writes plain keys, questions writes `__live_questions.*` keys). When either panel updates, it must read the current DB value, merge, and write back. They already do this. With the partial-upsert fix, the merge becomes the only correctness requirement for `checklist_answers` (no more clobbering of unrelated fields).

To make the merge more robust against stale `existingReview`, add a "fresh-read" right before the save in both panels: `await supabase.from('trade_reviews').select('checklist_answers').eq('trade_id', tradeId).maybeSingle()`, merge with current local answers, then upsert. This eliminates the stale-snapshot race for the shared field. Cheap (one indexed lookup, debounced anyway).

### 4. Remove all pass-through hacks (now dead code)

After fix #1 and #3, delete:
- `LiveTradeCompliancePanel`: `mergeWithLiveQuestions` stays (still needed for `checklist_answers` merge), but drop the `regime / emotional / psychology / screenshots` pass-throughs in the debounced effect, flush-on-unmount, and `handleScreenshotsChange`.
- `LiveTradeQuestionsPanel`: drop `regime / emotional / psychology / screenshots` pass-throughs in debounced effect and flush-on-unmount.
- `TradeProperties.handleRegimeChange` / `handleEmotionChange`: drop the `...(trade.review && { ... })` pass-through blocks.

### 5. Initial-state guard for Questions panel

In `LiveTradeQuestionsPanel`, add: skip save entirely if `existingReview === null` AND all answers are empty/falsy. Prevents an unnecessary empty-review insert on trade open.

### 6. Storage layer is verified correct

`useScreenshots` uploads to the public `trade-screenshots` bucket with permanent storage, returns a `getPublicUrl` (no expiry). Only the DB reference was being wiped — files in storage were always intact. No bucket/RLS/storage changes.

## Why this is the right architectural choice

- **Single source of truth for write semantics** — one mutation, one rule: only write what you sent.
- **Eliminates a whole class of bugs** — any future panel writing to `trade_reviews` is automatically safe.
- **No DB schema change, no migration, no breaking change** — Postgres upsert already supports partial updates correctly when columns are omitted from the INSERT clause.
- **Removes ~40 lines of fragile pass-through code** across three components.
- **Fresh-read merge** for the one truly shared field (`checklist_answers`) eliminates the stale-snapshot race without introducing locks or optimistic concurrency.

## Files

| File | Change |
|---|---|
| `src/hooks/useTrades.tsx` | Rewrite `useUpsertTradeReview` to build payload with `'field' in review` checks; drop default values for omitted columns |
| `src/components/journal/LiveTradeCompliancePanel.tsx` | Remove `regime/emotional/psychology/screenshots` pass-throughs from debounced save, flush-on-unmount, `handleScreenshotsChange`; add fresh-read of `checklist_answers` before merge |
| `src/components/journal/LiveTradeQuestionsPanel.tsx` | Remove same pass-throughs; add fresh-read of `checklist_answers` before merge; add empty-initial-state guard |
| `src/components/journal/TradeProperties.tsx` | Remove pass-through blocks in `handleRegimeChange` and `handleEmotionChange` (now they only send the field they own) |

No DB migrations. No RLS changes. No storage changes. No new dependencies. No edge function redeploys.

## Validation plan

1. Upload screenshot → switch trades → return → screenshot persists ✓
2. Upload screenshot → tick compliance checkbox (debounce fires) → screenshot persists ✓
3. Upload screenshot → answer live question (debounce fires) → screenshot persists ✓
4. Change emotion → screenshot still there ✓
5. Compliance + Questions both writing `checklist_answers` within 500ms → both keysets retained ✓
6. Existing journal trades with mistakes/did_well/to_improve unaffected when live panel saves ✓

