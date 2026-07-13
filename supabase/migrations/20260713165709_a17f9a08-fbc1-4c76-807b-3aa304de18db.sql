-- Multi-TP sibling grouping: non-destructive columns + backfill.
-- Groups broker positions that are actually the same idea split across
-- multiple TP legs by a MT5 position sizer.

ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS group_key text,
  ADD COLUMN IF NOT EXISTS group_role text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trades_group_role_check'
  ) THEN
    ALTER TABLE public.trades
      ADD CONSTRAINT trades_group_role_check
      CHECK (group_role IS NULL OR group_role IN ('leader','leg'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS trades_group_key_idx
  ON public.trades (user_id, group_key)
  WHERE group_key IS NOT NULL;

-- Backfill: group rows by (user_id, account_id, symbol, direction) where
-- consecutive entries are within 30 seconds AND price is within 5 bps
-- (0.05%). First row of each group becomes 'leader', rest become 'leg'.
-- Rows that are the only member of their group are left with NULL group_key
-- (nothing to collapse).
WITH ordered AS (
  SELECT
    id, user_id, account_id, symbol, direction,
    entry_time, entry_price,
    LAG(entry_time)  OVER w AS prev_time,
    LAG(entry_price) OVER w AS prev_price,
    LAG(id)          OVER w AS prev_id
  FROM public.trades
  WHERE account_id IS NOT NULL
    AND entry_time IS NOT NULL
    AND entry_price IS NOT NULL
  WINDOW w AS (
    PARTITION BY user_id, account_id, symbol, direction
    ORDER BY entry_time, id
  )
),
flagged AS (
  SELECT
    id,
    CASE
      WHEN prev_time IS NOT NULL
       AND entry_time - prev_time <= interval '30 seconds'
       AND ABS(entry_price - prev_price) <= GREATEST(entry_price * 0.0005, 0.0001)
      THEN 0 ELSE 1
    END AS is_new_group
  FROM ordered
),
grouped AS (
  SELECT
    id,
    SUM(is_new_group) OVER (ORDER BY id) AS grp_id
  FROM flagged
),
-- Only keep groups with 2+ members
final AS (
  SELECT
    id,
    grp_id,
    COUNT(*) OVER (PARTITION BY grp_id) AS grp_size,
    ROW_NUMBER() OVER (PARTITION BY grp_id ORDER BY id) AS rn,
    FIRST_VALUE(id) OVER (PARTITION BY grp_id ORDER BY id) AS leader_id
  FROM grouped
)
UPDATE public.trades t
   SET group_key  = f.leader_id::text,
       group_role = CASE WHEN f.rn = 1 THEN 'leader' ELSE 'leg' END
  FROM final f
 WHERE t.id = f.id
   AND f.grp_size > 1;
