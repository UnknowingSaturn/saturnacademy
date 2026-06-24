ALTER TABLE public.trades DROP CONSTRAINT IF EXISTS trades_ideal_entry_window_check;
ALTER TABLE public.trades DROP CONSTRAINT IF EXISTS trades_failed_setup_half_check;
ALTER TABLE public.trades DROP COLUMN IF EXISTS ideal_entry_window;
ALTER TABLE public.trades DROP COLUMN IF EXISTS failed_setup_half;