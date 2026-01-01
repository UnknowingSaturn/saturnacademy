-- Add performance indexes for frequently queried columns

-- Index on events.idempotency_key for duplicate checking
CREATE INDEX IF NOT EXISTS idx_events_idempotency_key ON public.events(idempotency_key);

-- Index on events.account_id and processed for event processing
CREATE INDEX IF NOT EXISTS idx_events_account_processed ON public.events(account_id, processed);

-- Index on trades.ticket and account_id for lookups
CREATE INDEX IF NOT EXISTS idx_trades_ticket_account ON public.trades(ticket, account_id) WHERE ticket IS NOT NULL;

-- Index on trades.entry_time for time-based queries
CREATE INDEX IF NOT EXISTS idx_trades_entry_time ON public.trades(entry_time DESC);

-- Index on trades.is_open for filtering open trades
CREATE INDEX IF NOT EXISTS idx_trades_is_open ON public.trades(user_id, is_open) WHERE is_open = true;

-- Index on copier_executions.executed_at for time-based queries
CREATE INDEX IF NOT EXISTS idx_copier_executions_executed_at ON public.copier_executions(executed_at DESC);

-- Index on copier_executions for finding by master/receiver account
CREATE INDEX IF NOT EXISTS idx_copier_executions_accounts ON public.copier_executions(master_account_id, receiver_account_id);

-- Index on accounts for copier lookups
CREATE INDEX IF NOT EXISTS idx_accounts_copier ON public.accounts(user_id, copier_role, ea_type) WHERE copier_enabled = true;