## What I verified already

- Vendored quant copies (`supabase/functions/_shared/quant/vendor/*`) are byte-in-sync with `shared/quant/*` — no drift.
- `coach-chat/index.ts`, `_shared/coachTools.ts`, and both embed functions type-check clean under Deno.
- No browser console or runtime errors captured in the preview snapshot.
- Backend logs show the Coach function only booting recently, with **no** HTTP request rows and **no** error lines; the last successful AI Gateway calls were at 01:14 UTC. So the failure is not yet visible in any log I can read — the exact message is being swallowed client-side.

Root cause of "edge function error" as displayed: `useCoach.tsx` calls `supabase.functions.invoke("coach-chat", ...)` and, on a non-2xx response, the SDK throws a generic `FunctionsHttpError` ("Edge Function returned a non-2xx status code"). The function's real JSON body (`{ error: "..." }` — auth, rate limit, AI 402/429, tool failure) is never read, so neither you nor I can see what actually broke.

## Plan

1. **Make the real error visible (client)**
   - In `src/hooks/useCoach.tsx`, on `FunctionsHttpError` read `error.context` (the `Response`) and parse its JSON `error` field; fall back to status text. Show that in the toast instead of the generic SDK string.
   - Keep the existing `(data as any).error` path for 200-with-error responses.

2. **Reproduce and capture the server-side failure**
   - Invoke `coach-chat` directly against a real thread and read the status + body, then pull function logs for that invocation. This gives the exact failure (401 auth, 429 rate limit, 402 credits, or a thrown exception inside the tool loop).

3. **Fix the identified root cause.** Most likely candidates, each with a concrete fix:
   - *Auth/401*: verify `SUPABASE_ANON_KEY` path in `requireUser` still resolves under the current signing-keys setup; switch to JWKS validation if the anon-key `getUser()` call is failing.
   - *Unhandled throw in the tool loop*: wrap each `executeTool` call so one bad tool result degrades to `ok:false` instead of a 500, and log the tool name + message.
   - *429 rate limit*: the current limit counts 30 user messages / 10 min per user; if that is what you hit, surface a clear "rate limited, retry in Ns" message rather than a generic error.
   - *AI Gateway 402/429*: already handled, but ensure the message reaches the toast via step 1.

4. **Full audit that the previous Coach overhaul landed correctly** (this is the "make sure all past changes were made fully" part)
   - Confirm in the database that `journal_trade_tier`, `journal_notes`, `journal_cohort`, `journal_cohort_stats`, and `search_journal` all exist and execute, and that grants let the function's role call them.
   - Run the Coach tool smoke test (`coach-chat/coachTools_test.ts`) against the live schema: every tool in `COACH_TOOL_NAMES` must return `ok:true`, including `getStats`, `searchJournal`, `analyzeCohort`, and `simulateChallenge`.
   - Verify the embed queue is draining (no stale `coach_embed_queue` rows with `attempts > 0` / `last_error`), since `coach-chat` fires `coach-drain-embeddings` without awaiting it.
   - Confirm `supabase/config.toml` needs no `coach-chat` block, and that the deployed version matches the repo (redeploy the coach functions if the boot logs indicate a stale bundle).

5. **Re-test end to end** by sending a Coach message and confirming a normal reply plus tool-call rows, with no failure banner appended.

## Technical notes

- No schema changes are planned unless step 4 finds a missing/ungranted object.
- Edits expected: `src/hooks/useCoach.tsx` (error surfacing), `supabase/functions/coach-chat/index.ts` (defensive tool-loop error handling and clearer rate-limit message), possibly `supabase/functions/_shared/edgeAuth.ts` if auth is the cause.
- If the reproduction shows the request never reaches the function at all, the investigation shifts to the invoke URL/CORS path rather than function internals; I'll report that rather than guess.
