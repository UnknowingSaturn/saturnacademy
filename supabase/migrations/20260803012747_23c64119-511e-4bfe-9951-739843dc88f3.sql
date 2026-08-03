
CREATE OR REPLACE FUNCTION public.journal_cohort(
  _user_id     uuid,
  _tiers       text[]      DEFAULT ARRAY['journaled','partial'],
  _playbook    text        DEFAULT NULL,
  _symbol      text        DEFAULT NULL,
  _session     text        DEFAULT NULL,
  _direction   text        DEFAULT NULL,
  _from        timestamptz DEFAULT NULL,
  _to          timestamptz DEFAULT NULL,
  _days        integer     DEFAULT NULL,
  _trade_ids   uuid[]      DEFAULT NULL,
  _group_by    text        DEFAULT NULL,
  _include_open boolean    DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_from timestamptz := COALESCE(_from, CASE WHEN _days IS NOT NULL THEN now() - make_interval(days => _days) END);
  v_stats jsonb;
  v_groups jsonb;
  v_coverage jsonb;
  v_facts jsonb;
  v_n integer;
BEGIN
  WITH pop AS (
    SELECT t.*, tt.tier, p.name AS pb_name
    FROM public.trades t
    JOIN public.journal_trade_tier tt ON tt.trade_id = t.id
    LEFT JOIN public.playbooks p ON p.id = COALESCE(t.actual_playbook_id, t.playbook_id)
    WHERE t.user_id = _user_id
      AND COALESCE(t.trade_type::text, 'executed') = 'executed'
      AND (_include_open OR (COALESCE(t.is_open, false) = false AND t.net_pnl IS NOT NULL))
      AND (v_from IS NULL OR t.entry_time >= v_from)
      AND (_to   IS NULL OR t.entry_time <= _to)
      AND (_symbol IS NULL OR upper(t.symbol) = upper(_symbol))
      AND (_session IS NULL OR lower(COALESCE(t.session,'')) = lower(_session))
      AND (_direction IS NULL OR t.direction::text = lower(_direction))
      AND (_trade_ids IS NULL OR t.id = ANY(_trade_ids))
      AND (_playbook IS NULL OR lower(COALESCE(p.name,'')) = lower(_playbook))
  ),
  cohort AS (
    SELECT * FROM pop WHERE _tiers IS NULL OR tier = ANY(_tiers)
  ),
  agg AS (
    SELECT
      count(*)::int AS n,
      count(*) FILTER (WHERE net_pnl > 0)::int AS wins,
      count(*) FILTER (WHERE net_pnl < 0)::int AS losses,
      round(100.0 * count(*) FILTER (WHERE net_pnl > 0) / NULLIF(count(*),0), 1) AS win_rate_pct,
      round(avg(r_multiple_actual)::numeric, 3) AS expectancy_r,
      round(sum(r_multiple_actual)::numeric, 2) AS gross_r,
      round(sum(net_pnl)::numeric, 2) AS net_pnl,
      count(r_multiple_actual)::int AS r_sample,
      round(max(r_multiple_actual)::numeric, 2) AS best_r,
      round(min(r_multiple_actual)::numeric, 2) AS worst_r,
      min(entry_time) AS first_trade,
      max(entry_time) AS last_trade
    FROM cohort
  ),
  cov AS (
    SELECT jsonb_object_agg(tier, jsonb_build_object(
             'n', n, 'net_pnl', pnl, 'win_rate_pct', wr, 'expectancy_r', er)) AS j
    FROM (
      SELECT tier, count(*)::int n, round(sum(net_pnl)::numeric,2) pnl,
             round(100.0*count(*) FILTER (WHERE net_pnl>0)/NULLIF(count(*),0),1) wr,
             round(avg(r_multiple_actual)::numeric,3) er
      FROM pop GROUP BY tier
    ) s
  ),
  grp AS (
    SELECT jsonb_agg(g ORDER BY (g->>'expectancy_r')::numeric DESC NULLS LAST) AS j
    FROM (
      SELECT jsonb_build_object(
        'key', k,
        'n', count(*)::int,
        'win_rate_pct', round(100.0*count(*) FILTER (WHERE net_pnl>0)/NULLIF(count(*),0),1),
        'expectancy_r', round(avg(r_multiple_actual)::numeric,3),
        'gross_r', round(sum(r_multiple_actual)::numeric,2),
        'net_pnl', round(sum(net_pnl)::numeric,2),
        'confidence', CASE WHEN count(*) < 10 THEN 'anecdotal'
                           WHEN count(*) < 30 THEN 'indicative'
                           ELSE 'established' END
      ) AS g
      FROM (
        SELECT c.*, CASE _group_by
          WHEN 'symbol'    THEN c.symbol
          WHEN 'session'   THEN COALESCE(c.session, 'unassigned')
          WHEN 'direction' THEN c.direction::text
          WHEN 'playbook'  THEN COALESCE(c.pb_name, '(no playbook)')
          WHEN 'tier'      THEN c.tier
          WHEN 'weekday'   THEN btrim(to_char(c.entry_time, 'Day'))
          WHEN 'hour'      THEN to_char(c.entry_time, 'HH24') || ':00 UTC'
          WHEN 'month'     THEN to_char(c.entry_time, 'YYYY-MM')
          ELSE NULL END AS k
        FROM cohort c
      ) x
      WHERE k IS NOT NULL
      GROUP BY k
    ) y
  )
  SELECT to_jsonb(agg.*), cov.j, grp.j
  INTO v_stats, v_coverage, v_groups
  FROM agg, cov, grp;

  v_n := COALESCE((v_stats->>'n')::int, 0);

  SELECT jsonb_agg(f ORDER BY ord) INTO v_facts FROM (
    SELECT 1 AS ord, jsonb_build_object(
      'id', 'f1',
      'text', format('cohort [%s] | n=%s | WR %s%% | expectancy %sR | gross %sR | net %s',
        COALESCE(array_to_string(_tiers, '+'), 'all tiers'),
        v_n,
        COALESCE((v_stats->>'win_rate_pct'), 'n/a'),
        COALESCE((v_stats->>'expectancy_r'), 'n/a'),
        COALESCE((v_stats->>'gross_r'), 'n/a'),
        COALESCE((v_stats->>'net_pnl'), 'n/a'))
    ) AS f
    UNION ALL
    SELECT 2, jsonb_build_object(
      'id', 'f2',
      'text', format('coverage by tier | %s',
        COALESCE((SELECT string_agg(format('%s: n=%s net %s WR %s%%', key,
                     value->>'n', value->>'net_pnl', COALESCE(value->>'win_rate_pct','n/a')), ' | ')
                  FROM jsonb_each(COALESCE(v_coverage, '{}'::jsonb))), 'no trades'))
    )
    UNION ALL
    SELECT 2 + row_number() OVER (), jsonb_build_object(
      'id', 'g' || row_number() OVER (),
      'text', format('%s | n=%s | WR %s%% | expectancy %sR | net %s | %s',
        g->>'key', g->>'n', COALESCE(g->>'win_rate_pct','n/a'),
        COALESCE(g->>'expectancy_r','n/a'), COALESCE(g->>'net_pnl','n/a'), g->>'confidence')
    )
    FROM jsonb_array_elements(COALESCE(v_groups, '[]'::jsonb)) g
  ) z;

  RETURN jsonb_build_object(
    'filters', jsonb_build_object(
      'tiers', _tiers, 'playbook', _playbook, 'symbol', _symbol, 'session', _session,
      'direction', _direction, 'from', v_from, 'to', _to, 'group_by', _group_by,
      'include_open', _include_open, 'explicit_ids', _trade_ids IS NOT NULL),
    'stats', v_stats,
    'groups', COALESCE(v_groups, '[]'::jsonb),
    'coverage', COALESCE(v_coverage, '{}'::jsonb),
    'confidence', CASE WHEN v_n < 10 THEN 'anecdotal' WHEN v_n < 30 THEN 'indicative' ELSE 'established' END,
    'facts', COALESCE(v_facts, '[]'::jsonb),
    'contract', 'Quote numbers ONLY by copying a facts[].text verbatim and tagging its id. Do not compute, round or combine.'
  );
END;
$$;
