create extension if not exists vector;

-- ============================================================
-- coach_threads
-- ============================================================
create table public.coach_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New conversation',
  context_trade_id uuid references public.trades(id) on delete set null,
  context_route text,
  message_count integer not null default 0,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index coach_threads_user_updated_idx on public.coach_threads (user_id, updated_at desc);

grant select, insert, update, delete on public.coach_threads to authenticated;
grant all on public.coach_threads to service_role;

alter table public.coach_threads enable row level security;

create policy "Users manage their own coach threads"
  on public.coach_threads for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger update_coach_threads_updated_at
  before update on public.coach_threads
  for each row execute function public.update_updated_at_column();

-- ============================================================
-- coach_messages
-- ============================================================
create table public.coach_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.coach_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant','system','tool')),
  parts jsonb not null,
  attachments jsonb,
  tool_calls jsonb,
  token_usage jsonb,
  created_at timestamptz not null default now()
);
create index coach_messages_thread_created_idx on public.coach_messages (thread_id, created_at);
create index coach_messages_user_created_idx on public.coach_messages (user_id, created_at desc);

grant select, insert, update, delete on public.coach_messages to authenticated;
grant all on public.coach_messages to service_role;

alter table public.coach_messages enable row level security;

create policy "Users manage their own coach messages"
  on public.coach_messages for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- trade_embeddings (1536 dims to fit pgvector HNSW 2000-dim cap)
-- ============================================================
create table public.trade_embeddings (
  trade_id uuid primary key references public.trades(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content_hash text not null,
  content_preview text,
  embedding vector(1536) not null,
  model_version text not null default 'openai/text-embedding-3-small',
  updated_at timestamptz not null default now()
);
create index trade_embeddings_user_idx on public.trade_embeddings (user_id);
create index trade_embeddings_hnsw_idx
  on public.trade_embeddings using hnsw (embedding vector_cosine_ops);

grant select, insert, update, delete on public.trade_embeddings to authenticated;
grant all on public.trade_embeddings to service_role;

alter table public.trade_embeddings enable row level security;

create policy "Users manage their own trade embeddings"
  on public.trade_embeddings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- coach_embed_queue
-- ============================================================
create table public.coach_embed_queue (
  id bigserial primary key,
  trade_id uuid not null references public.trades(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  enqueued_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text
);
create unique index coach_embed_queue_trade_unique on public.coach_embed_queue (trade_id);
create index coach_embed_queue_user_idx on public.coach_embed_queue (user_id);

grant select, insert, update, delete on public.coach_embed_queue to authenticated;
grant all on public.coach_embed_queue to service_role;

alter table public.coach_embed_queue enable row level security;

create policy "Users see their own embed queue rows"
  on public.coach_embed_queue for select
  using (auth.uid() = user_id);

-- ============================================================
-- Enqueue helpers + triggers
-- ============================================================
create or replace function public.enqueue_trade_embed(_trade_id uuid, _user_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.coach_embed_queue (trade_id, user_id)
  values (_trade_id, _user_id)
  on conflict (trade_id) do update
    set enqueued_at = now(), attempts = 0, last_error = null;
$$;

create or replace function public.trg_enqueue_trade_embed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trade_id uuid;
  v_user_id uuid;
begin
  if tg_table_name = 'trades' then
    v_trade_id := coalesce(new.id, old.id);
    v_user_id  := coalesce(new.user_id, old.user_id);
  elsif tg_table_name in ('trade_reviews','ai_reviews','trade_comments') then
    v_trade_id := coalesce(new.trade_id, old.trade_id);
    select user_id into v_user_id from public.trades where id = v_trade_id;
  end if;

  if v_trade_id is not null and v_user_id is not null then
    perform public.enqueue_trade_embed(v_trade_id, v_user_id);
  end if;
  return null;
end;
$$;

create trigger enqueue_embed_on_trade
  after insert or update on public.trades
  for each row execute function public.trg_enqueue_trade_embed();

create trigger enqueue_embed_on_trade_review
  after insert or update or delete on public.trade_reviews
  for each row execute function public.trg_enqueue_trade_embed();

create trigger enqueue_embed_on_ai_review
  after insert or update or delete on public.ai_reviews
  for each row execute function public.trg_enqueue_trade_embed();

create trigger enqueue_embed_on_trade_comment
  after insert or update or delete on public.trade_comments
  for each row execute function public.trg_enqueue_trade_embed();

-- ============================================================
-- Similarity RPC — scoped to caller
-- ============================================================
create or replace function public.match_user_trades(
  query_embedding vector(1536),
  match_count integer default 5
)
returns table (
  trade_id uuid,
  similarity double precision,
  content_preview text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    te.trade_id,
    1 - (te.embedding <=> query_embedding) as similarity,
    te.content_preview
  from public.trade_embeddings te
  where te.user_id = auth.uid()
  order by te.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function public.match_user_trades(vector, integer) to authenticated, service_role;