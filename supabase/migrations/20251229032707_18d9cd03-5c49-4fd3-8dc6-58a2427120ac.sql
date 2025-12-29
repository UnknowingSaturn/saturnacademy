-- Add risk limit columns to playbooks table
ALTER TABLE public.playbooks 
  ADD COLUMN IF NOT EXISTS max_r_per_trade numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS max_daily_loss_r numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS max_trades_per_session integer DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.playbooks.max_r_per_trade IS 'Maximum R-multiple allowed per trade';
COMMENT ON COLUMN public.playbooks.max_daily_loss_r IS 'Maximum daily loss in R-multiples';
COMMENT ON COLUMN public.playbooks.max_trades_per_session IS 'Maximum number of trades allowed per session';