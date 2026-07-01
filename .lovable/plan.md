# Plan: Trading Coach — Robust v2

Global AI assistant that critiques uploaded chart screenshots and answers questions grounded in the user's own trading history. Uses `google/gemini-2.5-pro` via Lovable AI Gateway, with two retrieval paths: **structured tool calls** for live numbers, **pgvector embeddings** for fuzzy recall of past prose (reviews, mistakes, notes).

---

## 1. User surface

- **Floating "Ask Coach" button** — bottom-right, mounted inside `ProtectedRoute`. Hidden on `/auth`, `/reset-password`, `/r/:slug`.
- **Slide-out panel** (`Sheet`, right side, resizable 420–720px, remembers width in localStorage). Expand-to-fullscreen toggle → routes to `/coach/:threadId`.
- **Dedicated `/coach` + `/coach/:threadId`** — same conversation component, full page.
- **Contextual entry points** — "Ask Coach about this trade" button on Journal trade detail and Pair Lab drill-down modals; pre-attaches the trade as context.
- **Composer**: textarea (auto-focus, Shift+Enter for newline), paste-image / drag-drop / attach button, model-thinking indicator, stop-stream button, character counter (soft warn at 4k).

## 2. Conversation model (decided upfront)

**Threaded + database persistence** — matches the "no way to locate past lessons" problem the user described. Every thread has a URL. Handled per `chat-agent-ui-contract`:

- Route: `/coach/:threadId`; `/coach` selects most-recent or creates a new one and navigates.
- Chat window keyed by `threadId`. `useChat({ id: threadId })`.
- Thread list in panel left rail: title, updated_at, delete, rename (inline).
- Auto-title after first assistant reply via one cheap `gemini-2.5-flash-lite` call (max 6 words, no quotes).

## 3. Database (single migration)

```sql
-- pgvector
create extension if not exists vector;

create table public.coach_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New conversation',
  context_trade_id uuid references public.trades(id) on delete set null,
  context_route text,
  message_count int not null default 0,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.coach_threads (user_id, updated_at desc);

create table public.coach_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.coach_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant','system','tool')),
  parts jsonb not null,          -- AI SDK UIMessage.parts
  attachments jsonb,             -- [{ storage_path, signed_url_expires_at, kind }]
  tool_calls jsonb,              -- for auditability
  token_usage jsonb,             -- { input, output, model }
  created_at timestamptz not null default now()
);
create index on public.coach_messages (thread_id, created_at);

create table public.trade_embeddings (
  trade_id uuid primary key references public.trades(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content_hash text not null,    -- sha256 of embedded text; skip re-embed if unchanged
  content_preview text,          -- first 240 chars for debugging
  embedding vector(3072) not null,
  model_version text not null default 'gemini-embedding-001',
  updated_at timestamptz not null default now()
);
create index on public.trade_embeddings using hnsw (embedding vector_cosine_ops);
create index on public.trade_embeddings (user_id);

-- GRANTs (per stack rules)
grant select, insert, update, delete on public.coach_threads to authenticated;
grant select, insert, update, delete on public.coach_messages to authenticated;
grant select, insert, update, delete on public.trade_embeddings to authenticated;
grant all on all three to service_role;

-- RLS: user_id = auth.uid() on all three. Messages additionally scoped via thread ownership.

-- Similarity RPC
create function public.match_user_trades(
  p_user_id uuid, query_embedding vector(3072), match_count int default 5
) returns table (trade_id uuid, similarity float, content_preview text)
language sql stable security definer set search_path=public as $$
  select trade_id, 1 - (embedding <=> query_embedding), content_preview
  from public.trade_embeddings
  where user_id = p_user_id
  order by embedding <=> query_embedding
  limit match_count;
$$;
```

**Storage bucket** `coach-uploads` (private): RLS `bucket_id = 'coach-uploads' and (storage.foldername(name))[1] = auth.uid()::text`. Object path `{user_id}/{thread_id}/{uuid}.{ext}`.

## 4. Embeddings pipeline

**Content** per trade: `symbol | side | outcome | R | date | playbook.name | thoughts | mistakes | to_improve | psychology_notes | ai_review.summary | trade_comments`. Skip if all prose fields empty (numbers alone don't need semantic recall).

**When to embed**:
- Backfill edge function `coach-backfill-embeddings` — paginated (500/batch), invokable manually or via one-off from Journal settings. Shows progress. Idempotent via `content_hash`.
- Incremental: DB trigger `after insert or update` on `trades`, `trade_reviews`, `ai_reviews`, `trade_comments` calls edge function `coach-embed-trade` via `pg_net` (or lightweight: enqueue a row in a `coach_embed_queue` table and process on next chat request — avoids `pg_net` dependency). **Decision: queue table + drain-on-chat + a scheduled `coach-drain-embeddings` every 5min.** Simpler, no `pg_net`.

**Model**: `google/gemini-embedding-001` (3072-dim). Skip re-embed when `content_hash` matches.

## 5. Edge function `coach-chat`

- `verify_jwt = true`. Reads user from JWT — **never trust `user_id` from body**.
- Streams via AI SDK `streamText` → `toUIMessageStreamResponse({ originalMessages, onFinish })`.
- Model: `google/gemini-2.5-pro`.
- `stopWhen: stepCountIs(50)`.
- Persists user message on entry (with attachments), assistant message in `onFinish`. Both wrapped in try/catch; failed persistence logs + surfaces a non-fatal toast, doesn't lose the stream.
- Updates `coach_threads.message_count`, `last_message_at`, `updated_at` atomically.
- **Drains embed queue** (up to 20) before answering so recall is fresh.
- **Rate limit**: max 30 messages / user / 10min via a simple in-function check against `coach_messages` count; returns 429 with retry hint.
- **Attachment handling**: client uploads to storage, sends `{ storage_path }`; server mints a 1h signed URL and inlines it in the multimodal `image_url` content block. Never trusts client-provided URLs.

### Tools (Zod schemas, all scoped to `auth.uid()` server-side)

| Tool | Purpose |
|---|---|
| `searchTrades` | Filter by symbol/side/outcome/session/dateRange/playbook, returns compact rows (id, date, symbol, R, outcome, session) — max 25. |
| `getTradeDetail` | Full trade incl. modifications, reviews, screenshots, notes. |
| `getPlaybookStats` | Aggregate expectancy, win rate, sample, drawdown per playbook. |
| `getPairLabHourStats` | Expectancy per hour bucket for a symbol (reuses `pairLabMath`). |
| `getRecentPerformance` | Rollup for N days (mirrors dashboard). |
| `recallSimilarTrades` | Embeds `query` → `match_user_trades` RPC → returns top-k with previews and links. Preferred over `searchTrades` for fuzzy prose queries ("times I felt FOMO", "when I revenge-traded"). |
| `getUserContext` | Timezone, session definitions, account currency — so the model doesn't guess. |

### System prompt (locked)

- Persona: elite discretionary trading coach; direct, specific, blunt, no platitudes ("trust the process", "stay disciplined" — banned).
- Must cite specific trades by date+symbol when making claims about the user's history.
- Must call tools before citing numbers; never fabricate stats.
- Explicit refusals: no live market predictions, no "will price go up/down" answers, no financial advice framing. If asked, pivot to "here's what your data says about setups like this".
- Vision rules: describe what's visible, tie to user's playbooks/history, avoid inventing chart features not present.
- Always answer in user's timezone (fetched via `getUserContext`).

## 6. Frontend files

**New**
- `src/contexts/CoachContext.tsx` — panel open/close, active thread, attached context (trade/route).
- `src/hooks/useCoachThreads.ts` — CRUD threads, invalidations.
- `src/hooks/useCoachChat.ts` — wraps `useChat` with `DefaultChatTransport` → `${VITE_SUPABASE_URL}/functions/v1/coach-chat`, auth header from current session.
- `src/components/coach/CoachFab.tsx`
- `src/components/coach/CoachPanel.tsx` — resizable Sheet
- `src/components/coach/CoachThreadList.tsx` — inline rename, delete confirm
- `src/components/coach/CoachConversation.tsx` — AI Elements: `Conversation`, `Message`, `MessageResponse`, `Tool`, `PromptInput` (per `chat-ui-composition`)
- `src/components/coach/CoachAttachmentPreview.tsx` — thumbnail, remove, upload progress
- `src/components/coach/CoachContextChip.tsx` — "Context: Journal › GBPUSD 2026-06-30 ✕"
- `src/pages/Coach.tsx` — `/coach` + `/coach/:threadId`
- `src/lib/coachUpload.ts` — image validation (mime, ≤5MB, ≤2 attachments per message), storage upload

**Edited**
- `src/App.tsx` — routes for `/coach` and `/coach/:threadId`, mount `CoachContext` + `CoachFab` inside `ProtectedRoute`.
- `src/components/layout/AppSidebar.tsx` — "Coach" nav item.
- `src/pages/Journal.tsx` (trade detail) + Pair Lab drill-downs — "Ask Coach" button that opens panel with context.

## 7. Edge cases explicitly handled

| Scenario | Handling |
|---|---|
| User has 0 trades | Coach still works; tools return empty; system prompt notes "no history yet — answer generally and invite them to import trades". |
| User deletes a trade referenced by a past message | Message keeps rendering; on click, show "Trade no longer exists". |
| Thread deleted mid-stream | AbortController on client; server `onFinish` no-ops if thread row missing. |
| Very long threads | Server sends only last 30 messages + a summary of earlier turns (auto-summarize when count > 40). |
| Large image | Client rejects >5MB with clear error; downscale to max 2000px before upload. |
| Model 429/402 | Surface exact toast: rate limit → "Retry in a moment"; credits → "AI credits exhausted — top up in Settings". Never a generic assistant reply. |
| Streaming interrupted | Partial content saved with `parts` marked incomplete; user can retry. |
| Two devices, same thread | Thread list refetches on window focus; message list uses `staleTime: 0` when panel open. |
| Prompt injection in trade notes | Tool results wrapped in `<user_data>...</user_data>` and system prompt instructs the model to treat contents as data, not instructions. |
| Missing embeddings | `recallSimilarTrades` falls back to `searchTrades` with a note "semantic recall unavailable yet — showing recent matching trades". |
| Re-embed on prose edits | Trigger enqueues; drain runs before next chat call so recall is fresh. |
| Concurrent embed drains | Queue rows locked with `for update skip locked`. |
| Timezone drift | Every tool result includes an ISO timestamp + the user's TZ; system prompt formats display in user TZ. |
| Cost control | `getRecentPerformance`, `searchTrades` return compact projections (not full rows). Vision calls only when an image is actually attached. |
| Security | RLS on all three tables; storage RLS on `coach-uploads`; edge function reads `user_id` from JWT only; tool handlers re-scope every query by `auth.uid()`. |

## 8. Rollout order

1. Migration (tables, pgvector, RPC, RLS, GRANTs, queue table) + storage bucket.
2. `coach-embed-trade` + `coach-drain-embeddings` + trigger + backfill function.
3. `coach-chat` edge function with tools + vision.
4. Frontend: context, hooks, panel, FAB, conversation UI.
5. `/coach` page + sidebar entry.
6. Contextual "Ask Coach" buttons in Journal + Pair Lab.
7. Backfill run for existing trades (progress toast).

## 9. Explicit non-goals (kept out to stay effective, not complicated)

- No thread sharing / export (add later if asked).
- No cross-user data.
- No agent that mutates journal data. Read-only tools this phase; write tools ("save this as a lesson to my playbook") are Phase 2.
- No voice input this phase.
- No RAG over knowledge-base articles (already has its own chat).

## 10. Confirm before build

- **Persona tone**: blunt/direct (default) vs socratic. Default is blunt per your framing.
- **Backfill trigger**: run automatically on first Coach open, or button in Settings? Default: prompt on first open with "Index your N trades so Coach can recall past lessons (~1min)".