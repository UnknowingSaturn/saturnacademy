## Problem confirmed

The "Delete field" dialog in **Journal Settings → Fields** displays wrong counts (always `0`) and the "Also permanently erase data" action is a no-op for many system fields.

**Root cause**: `useCountTradesWithSystemField` and `useEraseSystemFieldData` always query the `trades` table by the field's `key`, but several system fields actually live on the `trade_reviews` table or under a different column name, and "dual" fields span two columns.

Verified against your real data right now:

| Field key (UI) | Where the data really lives | Real count | Dialog shows |
|---|---|---|---|
| `regime` | `trade_reviews.regime` (planned) + `trades.actual_regime` (actual) | 10 + 6 | **0** |
| `emotion` | `trade_reviews.emotional_state_before` | 16 | **0** |
| `model` | `trades.playbook_id` + `trades.actual_playbook_id` | varies | wrong key |
| `timeframes` | `trades.alignment` + `trades.entry_timeframes` | 11 + 20 | wrong key |
| `news_risk` | `trade_reviews.news_risk` | 29 | **0** |
| `psychology_notes` | `trade_reviews.psychology_notes` | — | **0** |
| `session`, `profile`, `place`, `actual_*` | `trades.<key>` (correct already) | — | OK |

So when you saw *"0 trades have a value for it"* on Regime, the dialog was checking the non-existent `trades.regime` column instead of the real `trade_reviews.regime` (10) + `trades.actual_regime` (6) = **16 trades**. Erasing would also have done nothing.

---

## Fix

### 1. Centralise a system-field source map

In `src/types/settings.ts`, export a single source-of-truth map describing where each system field's data lives. Each entry lists one or two `{ table, column }` pairs:

```ts
export const SYSTEM_FIELD_SOURCES: Record<string, Array<{ table: 'trades' | 'trade_reviews'; column: string }>> = {
  // Single-column trade fields
  session:  [{ table: 'trades', column: 'session' }],
  profile:  [{ table: 'trades', column: 'profile' }],
  place:    [{ table: 'trades', column: 'place' }],
  alignment:        [{ table: 'trades', column: 'alignment' }],
  entry_timeframes: [{ table: 'trades', column: 'entry_timeframes' }],
  actual_profile:   [{ table: 'trades', column: 'actual_profile' }],
  actual_regime:    [{ table: 'trades', column: 'actual_regime' }],

  // Single-column review fields
  emotion:                   [{ table: 'trade_reviews', column: 'emotional_state_before' }],
  emotional_state_before:    [{ table: 'trade_reviews', column: 'emotional_state_before' }],
  news_risk:                 [{ table: 'trade_reviews', column: 'news_risk' }],
  psychology_notes:          [{ table: 'trade_reviews', column: 'psychology_notes' }],

  // Dual planned + actual
  regime: [
    { table: 'trade_reviews', column: 'regime' },
    { table: 'trades', column: 'actual_regime' },
  ],
  model: [
    { table: 'trades', column: 'playbook_id' },
    { table: 'trades', column: 'actual_playbook_id' },
  ],
  timeframes: [
    { table: 'trades', column: 'alignment' },
    { table: 'trades', column: 'entry_timeframes' },
  ],
};
```

Update `canEraseSystemField` (and the duplicate `canEraseSystem` helper inside `FieldsPanel.tsx`) to derive from the keys of this map — eliminating drift between the two lists.

### 2. Rewrite `useCountTradesWithSystemField`

`src/hooks/useCustomFields.tsx` — replace the body to:

1. Look up the source map for `columnKey`. If unknown, return 0.
2. For each `{ table, column }` entry, count rows owned by the user where the column is non-null:
   - For `trades`: `select id, head, count: 'exact'` with `eq('user_id', user.id).not(column, 'is', null)`.
   - For `trade_reviews`: review rows have no `user_id` column, so filter via the `trade_id` join: `select id, head, count: 'exact'` with `not(column, 'is', null)` and an `in('trade_id', <ids of user's trades>)`. To avoid loading every trade id, use `.in('trade_id', supabase.from('trades').select('id').eq('user_id', user.id))` via PostgREST's `in.(select …)` is not available — instead use a single fetch of `trade_ids` for the user (already cached) or just run the query through the existing RLS (RLS already restricts `trade_reviews` to the user's trades), so we can simply do `select('id', { count: 'exact', head: true }).not(column, 'is', null)` and rely on RLS to limit it.
3. Sum the per-source counts. Return the total.

(Confirmed: `trade_reviews` RLS already restricts to `trade_id IN (user's trades)`, so a plain count with the auth client is correct.)

### 3. Rewrite `useEraseSystemFieldData`

Same map-driven approach:

1. For each `{ table, column }` entry in `SYSTEM_FIELD_SOURCES[columnKey]`:
   - `update({ [column]: null }).not(column, 'is', null)` on that table (with `eq('user_id', user.id)` on `trades`; `trade_reviews` is RLS-restricted automatically).
   - Collect the affected row count.
2. After all updates, invalidate `['trades']`, `['open-trades']`, **and** `['trade_reviews', ...]` queries.
3. Toast with the combined count.

### 4. Apply the same fix in `ColumnConfigPanel.tsx`

That panel also has a delete-with-erase flow using the same hooks (or a parallel implementation). Verify it now consumes the corrected `useCountTradesWithSystemField` / `useEraseSystemFieldData` so its count and erase work for review-backed fields too. (No code change expected if it already imports the hooks.)

### 5. Sanity-check core fields

Keep the existing guard: core fields (`entry_time`, `symbol`, `direction`, `r_multiple_actual`, etc.) must remain non-erasable — `SYSTEM_FIELD_SOURCES` only contains erasable keys, and `canEraseSystemField` returns `false` for anything not in the map.

---

## Files touched

- `src/types/settings.ts` — add `SYSTEM_FIELD_SOURCES`, update `canEraseSystemField`.
- `src/hooks/useCustomFields.tsx` — rewrite `useCountTradesWithSystemField` and `useEraseSystemFieldData` to walk the source map across `trades` + `trade_reviews`.
- `src/components/journal/settings/FieldsPanel.tsx` — replace the local `canEraseSystem` helper with the centralised one (single source of truth).
- (No DB migration; no UI layout changes.)

## Out of scope

- Custom fields (`useCountTradesWithCustomField` already correctly walks `trades.custom_fields` JSONB — confirmed showing real counts).
- Changing the dialog visuals (the screenshot's UI stays as is).
- Row-level safety: erase still requires the explicit "Also permanently erase data" checkbox.
