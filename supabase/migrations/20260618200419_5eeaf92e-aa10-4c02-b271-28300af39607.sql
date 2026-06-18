ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS sim_balance numeric NOT NULL DEFAULT 100000,
  ADD COLUMN IF NOT EXISTS sim_prop_firm text,
  ADD COLUMN IF NOT EXISTS sim_risk_per_trade_pct numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS sim_hard_cap_pct numeric NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS sim_source text NOT NULL DEFAULT 'manual';

ALTER TABLE public.user_settings
  DROP CONSTRAINT IF EXISTS user_settings_sim_source_check;
ALTER TABLE public.user_settings
  ADD CONSTRAINT user_settings_sim_source_check
  CHECK (sim_source IN ('manual','active_account'));