-- Clear the bad backfill from the previous migration.
UPDATE public.trades SET group_key = NULL, group_role = NULL
 WHERE group_key IS NOT NULL;

-- Correct backfill: partition the running "new-group" sum too, so group
-- boundaries only advance WITHIN a (user, account, symbol, direction)
-- partition. Combine partition identity + intra-partition index into the
-- group_key so keys stay globally unique.
WITH ordered AS (
  SELECT
    id, user_id, account_id, symbol, direction,
    entry_time, entry_price,
    LAG(entry_time)  OVER w AS prev_time,
    LAG(entry_price) OVER w AS prev_price
  FROM public.trades
  WHERE account_id IS NOT NULL
    AND entry_time  IS NOT NULL
    AND entry_price IS NOT NULL
  WINDOW w AS (
    PARTITION BY user_id, account_id, symbol, direction
    ORDER BY entry_time, id
  )
),
flagged AS (
  SELECT
    id, user_id, account_id, symbol, direction, entry_time,
    CASE
      WHEN prev_time IS NOT NULL
       AND entry_time - prev_time <= interval '30 seconds'
       AND ABS(entry_price - prev_price) <= GREATEST(entry_price * 0.0005, 0.0001)
      THEN 0 ELSE 1
    END AS is_new_group
  FROM ordered
),
indexed AS (
  SELECT
    id, user_id, account_id, symbol, direction, entry_time,
    SUM(is_new_group) OVER (
      PARTITION BY user_id, account_id, symbol, direction
      ORDER BY entry_time, id
    ) AS grp_idx
  FROM flagged
),
final AS (
  SELECT
    id, user_id, account_id, symbol, direction, grp_idx,
    COUNT(*)     OVER (PARTITION BY user_id, account_id, symbol, direction, grp_idx) AS grp_size,
    ROW_NUMBER() OVER (PARTITION BY user_id, account_id, symbol, direction, grp_idx ORDER BY entry_time, id) AS rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY user_id, account_id, symbol, direction, grp_idx
      ORDER BY entry_time, id
    ) AS leader_id
  FROM indexed
)
UPDATE public.trades t
   SET group_key  = f.leader_id::text,
       group_role = CASE WHEN f.rn = 1 THEN 'leader' ELSE 'leg' END
  FROM final f
 WHERE t.id = f.id
   AND f.grp_size > 1;
