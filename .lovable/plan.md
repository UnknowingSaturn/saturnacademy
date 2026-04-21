

# Why "Apply Timezone Correction" had an edge function error

## What the logs say right now

The most recent run of `restore-trade-times` succeeded:
- offset −4, 8 events grouped into 2 positions, 2 trades updated, 0 not found.

So the function is healthy *now*. The earlier error was almost certainly one of these three concrete issues, all visible in the code.

## The 3 likely causes

### 1. `restoreData` is undefined when the function returns an error response (most likely)
In `EditAccountDialog.tsx:139–157`:
```ts
const { data: restoreData, error: restoreError } = await supabase.functions.invoke('restore-trade-times', { ... });
if (restoreError) throw restoreError;
// later:
description: `Synced ${restoreData.trades_updated || 0} trades ...`
```
When the edge function returns a non-2xx (e.g. 404 "Account not found", 500), `supabase.functions.invoke` populates `error` AND can leave `data` `null`. The throw fires and the toast shows whatever message the FunctionsHttpError carries, which often surfaces as a generic *"Edge Function returned a non-2xx status code"* — that's the unhelpful message you probably saw.

### 2. The `reprocess-trades` step depends on the account having events for that range
After restoring, we call `reprocess-trades`. If the account has trades but `events` rows are missing for some tickets (notFoundCount > 0), restore silently skips them, then `reprocess-trades` tries to recompute sessions on times that may be `NULL` and can blow up. Logs would show "Trade not found for ticket X" lines.

### 3. Empty events table → silent success but UI still says "0 trades"
If you applied correction on an account that has no rows in `events` (e.g. trades were imported via CSV not the EA), the function returns 200 with `trades_updated: 0`. Not an *error*, but it looks broken.

## Recommended fix (small, surgical)

Edit only `supabase/functions/restore-trade-times/index.ts` and `EditAccountDialog.tsx`:

**A. Make the edge function's error responses richer**
- On account-not-found → return 404 with `{ error: "Account <id> not found" }` (already does this — good).
- Wrap the per-ticket update loop in try/catch and return a `failures: []` array in the JSON so the UI can surface what actually failed.
- Bound the events query (`limit(50000)`) and add a row-count guard: if `events.length === 0`, return `{ trades_updated: 0, message: "No EA events stored for this account — timezone correction only applies to trades imported via the live EA bridge, not CSV imports." }`. The frontend can then show a clearer toast.

**B. Make the dialog handle `data` being null**
In `EditAccountDialog.tsx:139–157`:
- Read `restoreData?.trades_updated ?? 0` (avoids the `Cannot read properties of null` crash if the function ever returns 200 with empty body).
- Surface `restoreData?.message` in the toast when `trades_updated === 0` so empty-events accounts get an explanation instead of "Synced 0 trades".
- If `reprocess-trades` errors AFTER restore succeeded, show a partial-success toast ("Times restored, but session recompute failed — try reprocess again") instead of throwing the whole flow as a failure.

**C. Add server-side guard for missing trade times**
In `restore-trade-times/index.ts`, skip any `openEvent` whose `event_timestamp` is `null` or unparseable (`isNaN(new Date(...).getTime())`) instead of letting `convertToUTC` produce `Invalid Date → toISOString()` which throws.

## Files

| File | Change |
|---|---|
| `supabase/functions/restore-trade-times/index.ts` | Add empty-events early return with explanatory message; per-ticket try/catch with `failures` array; guard against null/invalid `event_timestamp`; add `.limit(50000)` on events query |
| `src/components/accounts/EditAccountDialog.tsx` | Use `restoreData?.trades_updated ?? 0`; surface `restoreData?.message` in toast; treat `reprocess-trades` failure after successful restore as partial-success not full-failure |

## Validation

1. Click **Apply Timezone Correction** on an account with EA events → toast shows "Synced N trades..." (current happy path still works).
2. Click on an account with no events → toast explains "No EA events stored — only applies to live-bridge trades."
3. Simulate one bad event timestamp → loop continues, `failures` array shows the bad ticket, others get updated.
4. If `reprocess-trades` step fails → toast says "Times restored, recompute failed" instead of a generic edge function error.

