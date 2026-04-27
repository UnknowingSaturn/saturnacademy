# Fix: trade #227 (2:08 AM EST) labelled Tokyo instead of London

## Root cause
Your `session_definitions` table has **Tokyo 20:00→00:00** and **London 02:00→05:00 EST**, so 2:08 AM is London. But every backend classifier ignores that table and uses hardcoded defaults where Tokyo runs `19:00→04:00`, so anything before 4 AM is auto-tagged Tokyo.

Affected files (all hardcode session windows):
- `supabase/functions/backfill-trades/index.ts` — `sessionFromTime()` lines ~210-215
- `supabase/functions/reprocess-trades/index.ts` — `DEFAULT_SESSIONS` const + `sessionFromTime()`; the `use_custom_sessions` request flag is declared but never read
- `supabase/functions/reprocess-orphan-exits/index.ts` — same hardcoded windows
- `supabase/functions/ingest-events/index.ts` — needs verification (likely also hardcoded for live events)

## Changes

### 1. Shared session classifier (per edge function)
For each function above, replace the hardcoded array with:
```ts
async function loadSessions(supabase, userId): Promise<SessionDefinition[]> {
  const { data } = await supabase
    .from('session_definitions')
    .select('key,name,start_hour,start_minute,end_hour,end_minute,timezone,sort_order,is_active')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('sort_order');
  return (data && data.length) ? data : DEFAULT_SESSIONS;
}
```
Then `sessionFromTime(entryTime, sessions)` walks them in `sort_order` (first match wins, with overnight wrap handling already in `reprocess-trades`).

### 2. `ingest-events` (live trade ingest)
If it sets `session` on insert, load the owning user's sessions once per request and use the same helper. If it currently leaves `session` null and relies on a downstream pass, no change needed — confirm during implementation.

### 3. `reprocess-trades`
- Actually read `use_custom_sessions` (default `true`).
- Resolve the user from `account_id` (`accounts.user_id`) before loading sessions.

### 4. One-shot reclassification for existing data
Add a small action — either:
- a button in Journal Settings → Sessions panel ("Reclassify all trades with current sessions"), or
- a new `reclassify-sessions` edge function the same panel calls — that re-runs `sessionFromTime` over every trade for the current user using their live `session_definitions` and updates only the `session` column. No P&L touched.

This fixes #227 and any other historically mis-tagged trade in one click without a full reprocess.

### 5. Sanity / regression
- Add unit-style assertions in the helper (or an inline self-check) for overnight wrap (Tokyo 20→00) and adjacency (Tokyo ends 00:00, London starts 02:00 — the 00:00–02:00 gap stays unclassified, matching your current config).
- Verify `src/types/settings.ts` `DEFAULT_SESSIONS` (Tokyo 19→04, London 3→12) is only used as a *seed* when a brand-new user has no rows — keep it as-is, but document that it is not the source of truth once a user customises.

## Out of scope
- No schema changes; `session_definitions` already exists with the right shape.
- No UI redesign of the Session column — only the auto-classifier and a reclassify button.
- DST handling stays as-is (sessions are stored in `America/New_York`, classifier compares in that TZ).

## Verification after implementation
1. Re-deploy the three edge functions.
2. Click the new "Reclassify sessions" button.
3. Confirm trade #227 flips from Tokyo → London.
4. Spot-check a few NY-AM and Tokyo-overnight trades to make sure they didn't regress.
