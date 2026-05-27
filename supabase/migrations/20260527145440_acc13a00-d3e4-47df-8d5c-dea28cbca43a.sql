
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS mt5_install_id TEXT,
  ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;

ALTER TABLE public.terminal_snapshots
  ADD COLUMN IF NOT EXISTS install_id TEXT;

ALTER TABLE public.terminal_accounts
  ADD COLUMN IF NOT EXISTS install_id TEXT;

CREATE INDEX IF NOT EXISTS idx_accounts_install_id ON public.accounts(mt5_install_id);
CREATE INDEX IF NOT EXISTS idx_terminal_snapshots_install_id ON public.terminal_snapshots(install_id, account_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_terminal_accounts_install_id ON public.terminal_accounts(install_id, is_currently_active);
