ALTER TABLE public.trades DROP COLUMN IF EXISTS first_half_setup;
ALTER TABLE public.trades DROP COLUMN IF EXISTS second_half_setup;

ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS ideal_entry_window text;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS failed_setup_half text;

ALTER TABLE public.trades DROP CONSTRAINT IF EXISTS trades_ideal_entry_window_check;
ALTER TABLE public.trades ADD CONSTRAINT trades_ideal_entry_window_check
  CHECK (ideal_entry_window IS NULL OR ideal_entry_window IN ('none','first','second','both'));

ALTER TABLE public.trades DROP CONSTRAINT IF EXISTS trades_failed_setup_half_check;
ALTER TABLE public.trades ADD CONSTRAINT trades_failed_setup_half_check
  CHECK (failed_setup_half IS NULL OR failed_setup_half IN ('none','first','second','both'));