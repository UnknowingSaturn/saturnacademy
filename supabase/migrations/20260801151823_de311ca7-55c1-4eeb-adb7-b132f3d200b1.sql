-- regroup_trades: skip rows already grouped mid-run (the loop cursor can hand
-- back a row that a previous iteration just linked), and normalise roles so
-- every group has exactly one leader = earliest leg.
CREATE OR REPLACE FUNCTION public.regroup_trades(
  _user_id uuid DEFAULT NULL,
  _from timestamptz DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_sib record;
  v_eps numeric;
  v_cur text;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT t.id, t.user_id, t.account_id, t.symbol, t.direction,
           t.entry_price, t.entry_time
      FROM public.trades t
     WHERE t.group_key IS NULL
       AND t.account_id IS NOT NULL
       AND t.entry_price IS NOT NULL
       AND COALESCE(t.trade_type::text, 'executed') = 'executed'
       AND (_user_id IS NULL OR t.user_id = _user_id)
       AND (_from IS NULL OR t.entry_time >= _from)
     ORDER BY t.entry_time ASC, t.created_at ASC
  LOOP
    SELECT group_key INTO v_cur FROM public.trades WHERE id = r.id;
    CONTINUE WHEN v_cur IS NOT NULL;

    v_eps := greatest(abs(r.entry_price) * 0.0005, 0.0001);

    SELECT t.id, t.group_key
      INTO v_sib
      FROM public.trades t
     WHERE t.user_id = r.user_id
       AND t.account_id = r.account_id
       AND t.symbol = r.symbol
       AND t.direction = r.direction
       AND t.id <> r.id
       AND t.entry_price IS NOT NULL
       AND COALESCE(t.trade_type::text, 'executed') = 'executed'
       AND t.entry_time BETWEEN r.entry_time - interval '30 seconds'
                            AND r.entry_time + interval '30 seconds'
       AND abs(t.entry_price - r.entry_price) <= v_eps
     ORDER BY (t.group_key IS NOT NULL) DESC, t.entry_time ASC, t.created_at ASC
     LIMIT 1;

    CONTINUE WHEN NOT FOUND;

    IF v_sib.group_key IS NULL THEN
      UPDATE public.trades
         SET group_key = v_sib.id::text, group_role = 'leader'
       WHERE id = v_sib.id;
      UPDATE public.trades
         SET group_key = v_sib.id::text, group_role = 'leg'
       WHERE id = r.id;
    ELSE
      UPDATE public.trades
         SET group_key = v_sib.group_key, group_role = 'leg'
       WHERE id = r.id;
    END IF;

    n := n + 1;
  END LOOP;

  -- Exactly one leader per group: the earliest leg.
  WITH ranked AS (
    SELECT id, group_key,
           row_number() OVER (
             PARTITION BY group_key
             ORDER BY entry_time ASC, created_at ASC, id ASC
           ) AS rn
      FROM public.trades
     WHERE group_key IS NOT NULL
       AND (_user_id IS NULL OR user_id = _user_id)
  )
  UPDATE public.trades t
     SET group_role = CASE WHEN ranked.rn = 1 THEN 'leader' ELSE 'leg' END
    FROM ranked
   WHERE t.id = ranked.id
     AND t.group_role IS DISTINCT FROM
         CASE WHEN ranked.rn = 1 THEN 'leader' ELSE 'leg' END;

  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.regroup_trades(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regroup_trades(uuid, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.regroup_trades(uuid, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.regroup_trades(uuid, timestamptz) TO service_role;

-- Repair the groups created by the previous migration (no leader labelled).
SELECT public.regroup_trades();
