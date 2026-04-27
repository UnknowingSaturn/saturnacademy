-- Allow multiple accounts to share a terminal/API key, but each (user, broker login) must be unique
CREATE UNIQUE INDEX IF NOT EXISTS uniq_accounts_user_account_number
  ON public.accounts (user_id, account_number)
  WHERE account_number IS NOT NULL;

-- Speed up lookups for snapshot_closed repair queries
CREATE INDEX IF NOT EXISTS idx_trades_snapshot_closed
  ON public.trades (account_id)
  WHERE is_open = false AND net_pnl = 0;