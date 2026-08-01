-- Multi-TP sibling grouping becomes a database invariant.
-- Previously this lived only in the ingest edge function, so any other insert
-- path (history import, trade-rebuild, repair, manual idea/paper trades) never
-- grouped, and the read-then-write raced across separate invocations.

-- Supporting index for the sibling probe.
CREATE INDEX IF NOT EXISTS trades_sibling_probe_idx
  ON public.trades (user_id, account_id, symbol, direction, entry_time);

-- Shared predicate: greedy "attach to nearest sibling" grouping.
CREATE OR REPLACE FUNCTION public.assign_trade_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eps numeric;
  v_sib record;
BEGIN
  -- Explicit group_key (backfill / reconciler) wins. Non-executed trade types,
  -- accountless rows and rows without a price never group.
  IF NEW.group_key IS NOT NULL
     OR NEW.account_id IS NULL
     OR NEW.entry_price IS NULL
     OR NEW.entry_time IS NULL
     OR COALESCE(NEW.trade_type::text, 'executed') <> 'executed'
  THEN
    RETURN NEW;
  END IF;

  -- Serialize concurrent leg inserts for the same account/symbol/direction so
  -- two legs arriving milliseconds apart cannot both decide "no sibling".
  PERFORM pg_advisory_xact_lock(
    hashtext('trade_group:' || NEW.user_id::text || ':' || NEW.account_id::text
             || ':' || NEW.symbol || ':' || NEW.direction::text)
  );

  v_eps := greatest(abs(NEW.entry_price) * 0.0005, 0.0001);

  SELECT t.id, t.group_key
    INTO v_sib
    FROM public.trades t
   WHERE t.user_id = NEW.user_id
     AND t.account_id = NEW.account_id
     AND t.symbol = NEW.symbol
     AND t.direction = NEW.direction
     AND t.id IS DISTINCT FROM NEW.id
     AND COALESCE(t.trade_type::text, 'executed') = 'executed'
     AND t.entry_price IS NOT NULL
     AND t.entry_time BETWEEN NEW.entry_time - interval '30 seconds'
                          AND NEW.entry_time + interval '30 seconds'
     AND abs(t.entry_price - NEW.entry_price) <= v_eps
   ORDER BY (t.group_key IS NOT NULL) DESC, t.entry_time DESC, t.created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_sib.group_key IS NOT NULL THEN
    NEW.group_key := v_sib.group_key;
  ELSE
    UPDATE public.trades
       SET group_key = v_sib.id::text, group_role = 'leader'
     WHERE id = v_sib.id;
    NEW.group_key := v_sib.id::text;
  END IF;
  NEW.group_role := 'leg';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trades_assign_group ON public.trades;
CREATE TRIGGER trades_assign_group
  BEFORE INSERT ON public.trades
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_trade_group();

-- Idempotent reconciler: same predicate, set-wise, over ungrouped rows only.
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

  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.regroup_trades(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regroup_trades(uuid, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.regroup_trades(uuid, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.regroup_trades(uuid, timestamptz) TO service_role;

-- Backfill everything missed since the 2026-07-13 one-off migration.
SELECT public.regroup_trades();
