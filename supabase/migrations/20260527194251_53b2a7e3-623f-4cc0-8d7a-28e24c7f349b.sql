
-- Backfill trade_partial_fills from the legacy partial_closes JSONB.
-- Idempotent: re-running won't create duplicates.
INSERT INTO public.trade_partial_fills
  (user_id, trade_id, lots, price, profit, occurred_at)
SELECT
  t.user_id,
  t.id,
  (elem->>'lots')::numeric        AS lots,
  (elem->>'price')::numeric       AS price,
  NULLIF(elem->>'pnl','')::numeric AS profit,
  (elem->>'time')::timestamptz    AS occurred_at
FROM public.trades t
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(t.partial_closes, '[]'::jsonb)) AS elem
WHERE jsonb_typeof(t.partial_closes) = 'array'
  AND elem ? 'lots'
  AND elem ? 'price'
  AND elem ? 'time'
  AND (elem->>'lots') ~ '^-?[0-9]+(\.[0-9]+)?$'
  AND (elem->>'lots')::numeric > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.trade_partial_fills pf
    WHERE pf.trade_id = t.id
      AND pf.occurred_at = (elem->>'time')::timestamptz
      AND pf.lots  = (elem->>'lots')::numeric
      AND pf.price = (elem->>'price')::numeric
  );
