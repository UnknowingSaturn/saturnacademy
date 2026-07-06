# Fix: Trading Coach edge functions not deployed

## Root cause

The three coach edge functions exist in the repo but are **not deployed** to Lovable Cloud:

- `coach-chat`
- `coach-drain-embeddings`
- `coach-embed-trade`

Direct probes to each function return:

```text
404 NOT_FOUND — "Requested function was not found"
```

The client (`src/hooks/useCoach.tsx → useSendCoachMessage`) calls `supabase.functions.invoke("coach-chat", …)`, which surfaces this as a generic "Edge Function returned a non-2xx status code" — that's the failure the user is seeing. There are no runtime logs for `coach-chat` because the runtime never received a request.

The code itself looks correct: auth via `requireUser`, thread ownership check, rate limit, signed URLs scoped to the user's folder, bounded tool loop against `google/gemini-2.5-pro` through the Lovable AI Gateway, persistence to `coach_messages`, and fire-and-forget drain of embed jobs. Nothing in the source explains a 404.

## Fix

1. **Deploy the three coach functions** (`coach-chat`, `coach-drain-embeddings`, `coach-embed-trade`) so the runtime picks them up. No `supabase/config.toml` change needed — Lovable-managed functions default to `verify_jwt = false`, and each function validates the JWT itself where required (`requireUser` in `coach-chat`; `coach-drain-embeddings` and `coach-embed-trade` are internal callers).

2. **Verify with a live probe** using `supabase--curl_edge_functions` against `/coach-chat` with a real thread and the logged-in preview session:
   - Expect `200` with `{ reply, tool_calls, title }`, or a clean domain error (`404 Thread not found`, `429 rate limit`, `402 credits exhausted`).
   - Any `500` gets diagnosed from `supabase--edge_function_logs` for `coach-chat` and fixed in a follow-up (most likely candidates: missing `LOVABLE_API_KEY`, missing `coach_embed_queue` table, or a `match_user_trades` RPC that isn't present).

3. **Confirm from the UI** by opening Trading Coach in the preview and sending one message; the message should persist and an assistant reply should render.

## Not in scope

- No changes to `useCoach.tsx`, `coachTools.ts`, `coachEmbed.ts`, or the system prompt.
- No schema changes unless step 2 surfaces a missing table/RPC — that would be a separate follow-up plan.
- No switch away from `google/gemini-2.5-pro` or the gateway chat-completions endpoint.
