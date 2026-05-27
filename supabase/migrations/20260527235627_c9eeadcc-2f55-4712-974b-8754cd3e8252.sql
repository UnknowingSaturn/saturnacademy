-- Add tombstone column for trades whose ticket vanished from MT5 open list
-- without producing a real exit event yet. Only ingest-events writes real PnL;
-- sync-account-state now sets awaiting_exit=true instead of fabricating zero PnL.
ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS awaiting_exit BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_trades_awaiting_exit
  ON public.trades (account_id) WHERE awaiting_exit = true;