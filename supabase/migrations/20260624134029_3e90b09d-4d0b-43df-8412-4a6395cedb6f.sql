ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS first_half_setup TEXT,
  ADD COLUMN IF NOT EXISTS second_half_setup TEXT;

ALTER TABLE public.trades
  DROP CONSTRAINT IF EXISTS trades_first_half_setup_check,
  DROP CONSTRAINT IF EXISTS trades_second_half_setup_check;

ALTER TABLE public.trades
  ADD CONSTRAINT trades_first_half_setup_check
    CHECK (first_half_setup IS NULL OR first_half_setup IN ('none','worked','failed')),
  ADD CONSTRAINT trades_second_half_setup_check
    CHECK (second_half_setup IS NULL OR second_half_setup IN ('none','worked','failed'));