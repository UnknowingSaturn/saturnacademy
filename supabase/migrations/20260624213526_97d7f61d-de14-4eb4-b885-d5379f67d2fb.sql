ALTER TABLE public.symbol_groups
  ADD COLUMN IF NOT EXISTS tick_size_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.symbol_groups.tick_size_overrides IS
  'Per-symbol tick-size override map: { "BTCUSD": 1.0, "ETHUSD": 0.1, ... }. Used by Pair Lab to correctly scale MAE / Ideal-SL when the default classifier mis-sizes (e.g. crypto whose broker quotes in whole-dollar ticks).';