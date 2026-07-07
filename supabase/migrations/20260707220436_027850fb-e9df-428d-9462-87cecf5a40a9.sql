-- Close stuck trade 53d664ff using the real close event captured on 2026-05-04 18:25:23
-- (event id 3cb47695..., deal_id=2556669, price=7206.30, profit=$2.90).
-- total_lots is intentionally left at the ingested value so historical R-multiples
-- and the audit trail of the ingest de-dup bug remain intact.
UPDATE public.trades
SET
  is_open      = false,
  exit_time    = '2026-05-04 18:25:23+00',
  exit_price   = 7206.30,
  gross_pnl    = 2.90,
  net_pnl      = 2.90,
  commission   = 0,
  swap         = 0,
  awaiting_exit = false
WHERE id = '53d664ff-6e2c-44db-bb8f-682443d4b452'
  AND is_open = true;