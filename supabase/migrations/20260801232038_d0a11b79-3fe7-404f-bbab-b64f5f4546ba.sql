
create extension if not exists pg_trgm;

-- Flatten arbitrary jsonb prose (string / array / object) into readable text.
create or replace function public.jsonb_prose(v jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when v is null or jsonb_typeof(v) = 'null' then null
    when jsonb_typeof(v) = 'string' then nullif(btrim(v #>> '{}'), '')
    when jsonb_typeof(v) = 'array' then (
      select nullif(btrim(string_agg(p, ' | ')), '')
      from (
        select public.jsonb_prose(e) as p
        from jsonb_array_elements(v) e
      ) s
      where s.p is not null
    )
    when jsonb_typeof(v) = 'object' then (
      select nullif(btrim(string_agg(k || ': ' || p, '; ')), '')
      from (
        select t.k as k, public.jsonb_prose(t.val) as p
        from jsonb_each(v) as t(k, val)
      ) s
      where s.p is not null
    )
    else nullif(btrim(v #>> '{}'), '')
  end
$$;

-- One row per piece of user prose anywhere in the journal.
create or replace view public.journal_notes
with (security_invoker = on)
as
select
  'review:' || r.id::text || ':' || f.field                  as note_key,
  r.trade_id,
  t.user_id,
  'review'::text                                             as source,
  f.field                                                    as field,
  null::text                                                 as label,
  f.body                                                     as body,
  coalesce(r.reviewed_at, r.updated_at, r.created_at)        as occurred_at
from public.trade_reviews r
join public.trades t on t.id = r.trade_id
cross join lateral (values
  ('mistakes',         public.jsonb_prose(r.mistakes)),
  ('did_well',         public.jsonb_prose(r.did_well)),
  ('to_improve',       public.jsonb_prose(r.to_improve)),
  ('actionable_steps', public.jsonb_prose(r.actionable_steps)),
  ('thoughts',         nullif(btrim(r.thoughts), '')),
  ('psychology_notes', nullif(btrim(r.psychology_notes), ''))
) as f(field, body)
where f.body is not null

union all

select
  'screenshot:' || r.id::text || ':' || (s.ord - 1)::text,
  r.trade_id,
  t.user_id,
  'screenshot',
  'description',
  nullif(btrim(coalesce(s.value ->> 'timeframe', s.value ->> 'label')), ''),
  btrim(s.value ->> 'description'),
  coalesce(r.reviewed_at, r.updated_at, r.created_at)
from public.trade_reviews r
join public.trades t on t.id = r.trade_id
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(r.screenshots) = 'array' then r.screenshots else '[]'::jsonb end
) with ordinality as s(value, ord)
where jsonb_typeof(s.value) = 'object'
  and nullif(btrim(coalesce(s.value ->> 'description', '')), '') is not null

union all

select
  'comment:' || c.id::text,
  c.trade_id,
  c.user_id,
  'comment',
  'content',
  null::text,
  btrim(c.content),
  c.created_at
from public.trade_comments c
where nullif(btrim(c.content), '') is not null

union all

select
  'ai_review:' || a.id::text || ':' || f.field,
  a.trade_id,
  t.user_id,
  'ai_review',
  f.field,
  null::text,
  f.body,
  coalesce(a.updated_at, a.created_at)
from public.ai_reviews a
join public.trades t on t.id = a.trade_id
cross join lateral (values
  ('technical_review',    public.jsonb_prose(a.technical_review)),
  ('mistake_attribution', public.jsonb_prose(a.mistake_attribution)),
  ('psychology_analysis', public.jsonb_prose(a.psychology_analysis)),
  ('actionable_guidance', public.jsonb_prose(a.actionable_guidance)),
  ('visual_analysis',     public.jsonb_prose(a.visual_analysis)),
  ('thesis_evaluation',   public.jsonb_prose(a.thesis_evaluation))
) as f(field, body)
where f.body is not null;

grant select on public.journal_notes to authenticated;
grant select on public.journal_notes to service_role;

-- Note-level embeddings (replaces trade-level trade_embeddings).
create table if not exists public.note_embeddings (
  note_key      text primary key,
  trade_id      uuid not null references public.trades(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  source        text not null,
  field         text not null,
  label         text,
  content_hash  text not null,
  content_preview text,
  embedding     vector(1536) not null,
  model_version text not null,
  updated_at    timestamptz not null default now()
);

grant select on public.note_embeddings to authenticated;
grant all on public.note_embeddings to service_role;

alter table public.note_embeddings enable row level security;

drop policy if exists "note_embeddings_owner_select" on public.note_embeddings;
create policy "note_embeddings_owner_select"
  on public.note_embeddings for select
  to authenticated
  using (user_id = auth.uid());

create index if not exists note_embeddings_trade_idx on public.note_embeddings (trade_id);
create index if not exists note_embeddings_user_idx on public.note_embeddings (user_id);
create index if not exists note_embeddings_vec_idx
  on public.note_embeddings using hnsw (embedding vector_cosine_ops);

-- Hybrid (keyword + vector) search over journal prose, fused by reciprocal rank.
create or replace function public.search_journal(
  _user_id uuid,
  _query text default null,
  _query_embedding vector default null,
  _k int default 12,
  _source text default null,
  _timeframe text default null,
  _symbol text default null,
  _from timestamptz default null,
  _to timestamptz default null
)
returns table (
  note_key text,
  trade_id uuid,
  source text,
  field text,
  label text,
  body text,
  occurred_at timestamptz,
  kw_rank int,
  vec_rank int,
  score double precision
)
language sql
stable
security definer
set search_path = public
as $$
with base as (
  select n.note_key, n.trade_id, n.source, n.field, n.label, n.body, n.occurred_at
  from public.journal_notes n
  join public.trades t on t.id = n.trade_id
  where n.user_id = _user_id
    and (_source is null or n.source = _source)
    and (_timeframe is null or lower(coalesce(n.label, '')) = lower(_timeframe))
    and (_symbol is null or upper(t.symbol) = upper(_symbol))
    and (_from is null or t.entry_time >= _from)
    and (_to is null or t.entry_time <= _to)
),
kw as (
  select b.note_key,
         row_number() over (
           order by greatest(
             ts_rank(to_tsvector('english', b.body), websearch_to_tsquery('english', _query)),
             similarity(b.body, _query)
           ) desc, b.occurred_at desc
         ) as rnk
  from base b
  where _query is not null
    and btrim(_query) <> ''
    and (
      to_tsvector('english', b.body) @@ websearch_to_tsquery('english', _query)
      or b.body ilike '%' || _query || '%'
      or similarity(b.body, _query) > 0.25
    )
  limit greatest(_k * 4, 40)
),
vec as (
  select e.note_key,
         row_number() over (order by e.embedding <=> _query_embedding) as rnk
  from public.note_embeddings e
  join base b on b.note_key = e.note_key
  where _query_embedding is not null
  limit greatest(_k * 4, 40)
)
select b.note_key, b.trade_id, b.source, b.field, b.label, b.body, b.occurred_at,
       kw.rnk::int as kw_rank,
       vec.rnk::int as vec_rank,
       coalesce(1.0 / (60 + kw.rnk), 0) + coalesce(1.0 / (60 + vec.rnk), 0) as score
from base b
left join kw on kw.note_key = b.note_key
left join vec on vec.note_key = b.note_key
where kw.rnk is not null or vec.rnk is not null
order by score desc, b.occurred_at desc
limit _k;
$$;

-- Cohort statistics for a set of trades (typically the trades behind search hits).
create or replace function public.journal_cohort_stats(
  _user_id uuid,
  _trade_ids uuid[]
)
returns table (
  n int,
  closed_n int,
  wins int,
  losses int,
  win_rate numeric,
  total_pnl numeric,
  avg_pnl numeric,
  expectancy_r numeric,
  avg_r numeric,
  median_r numeric,
  best_r numeric,
  worst_r numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with c as (
    select t.*
    from public.trades t
    where t.user_id = _user_id
      and t.id = any(_trade_ids)
  ),
  closed as (
    select * from c where coalesce(is_open, false) = false and net_pnl is not null
  )
  select
    (select count(*) from c)::int,
    (select count(*) from closed)::int,
    (select count(*) from closed where net_pnl > 0)::int,
    (select count(*) from closed where net_pnl < 0)::int,
    (select round(100.0 * count(*) filter (where net_pnl > 0) / nullif(count(*), 0), 1) from closed),
    (select round(sum(net_pnl)::numeric, 2) from closed),
    (select round(avg(net_pnl)::numeric, 2) from closed),
    (select round(avg(r_multiple_actual)::numeric, 3) from closed where r_multiple_actual is not null),
    (select round(avg(r_multiple_actual)::numeric, 3) from closed where r_multiple_actual is not null),
    (select round((percentile_cont(0.5) within group (order by r_multiple_actual))::numeric, 3) from closed where r_multiple_actual is not null),
    (select round(max(r_multiple_actual)::numeric, 3) from closed where r_multiple_actual is not null),
    (select round(min(r_multiple_actual)::numeric, 3) from closed where r_multiple_actual is not null);
$$;

revoke all on function public.search_journal(uuid, text, vector, int, text, text, text, timestamptz, timestamptz) from public, anon;
revoke all on function public.journal_cohort_stats(uuid, uuid[]) from public, anon;
grant execute on function public.search_journal(uuid, text, vector, int, text, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.journal_cohort_stats(uuid, uuid[]) to service_role;
