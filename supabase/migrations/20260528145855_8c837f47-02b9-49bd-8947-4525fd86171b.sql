-- Tranche 1: persist read_quality (planned-vs-actual playbook grading) on every report
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS read_quality JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Tranche 5: recover the 4 partial_close events that were purged by migration
-- 20260527194623. We replay them from the events log into trade_partial_fills,
-- joining on (account_id, ticket). ON CONFLICT DO NOTHING guards against any
-- row that's already been backfilled.
INSERT INTO public.trade_partial_fills (
  trade_id, user_id, ticket, deal_id, lots, price, profit, commission, swap, occurred_at
)
SELECT
  t.id              AS trade_id,
  e.user_id,
  e.ticket,
  NULL              AS deal_id,
  e.lot_size        AS lots,
  e.price,
  e.profit,
  COALESCE(e.commission, 0),
  COALESCE(e.swap, 0),
  e.event_timestamp AS occurred_at
FROM public.events e
JOIN public.trades t
  ON  t.account_id = e.account_id
  AND t.ticket     = e.ticket
WHERE e.event_type = 'partial_close'
  AND NOT EXISTS (
    SELECT 1 FROM public.trade_partial_fills f
    WHERE  f.trade_id  = t.id
      AND  f.ticket    = e.ticket
      AND  f.occurred_at = e.event_timestamp
  );