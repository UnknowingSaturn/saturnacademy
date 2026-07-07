ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS ranker_comfort_dd_pct numeric NOT NULL DEFAULT 10;