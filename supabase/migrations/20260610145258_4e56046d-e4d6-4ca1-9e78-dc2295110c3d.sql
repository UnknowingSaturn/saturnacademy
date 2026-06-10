
INSERT INTO public.trade_partial_fills (user_id, trade_id, ticket, deal_id, lots, price, profit, commission, swap, occurred_at)
SELECT '6117754f-8c8c-49c8-a610-252764fd7bcf', '7f04ec3a-f6cc-49fa-8aa9-419f0cd934e4', 5681494, 5161419, 2.0, 29196.80, 346.40, 0, 0, '2026-06-10 14:25:04+00'
WHERE NOT EXISTS (
  SELECT 1 FROM public.trade_partial_fills WHERE trade_id = '7f04ec3a-f6cc-49fa-8aa9-419f0cd934e4' AND deal_id = 5161419
);

UPDATE public.trades
SET gross_pnl = 407.20, net_pnl = 407.20, r_multiple_actual = 0.54
WHERE id = '7f04ec3a-f6cc-49fa-8aa9-419f0cd934e4';

SELECT public.apply_equity_delta('39c6a9e7-f8fd-46e0-be41-a3fe424e7586'::uuid, 346.40);
