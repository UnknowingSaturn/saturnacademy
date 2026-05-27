
-- ============================================================
-- PHASE B.1 — events.user_id + simplified RLS
-- ============================================================
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS user_id uuid;

UPDATE public.events e
SET user_id = a.user_id
FROM public.accounts a
WHERE e.account_id = a.id AND e.user_id IS NULL;

ALTER TABLE public.events ALTER COLUMN user_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_user_id ON public.events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_account_id ON public.events(account_id);
CREATE INDEX IF NOT EXISTS idx_events_ticket ON public.events(ticket);

DROP POLICY IF EXISTS "Users can view events for their accounts" ON public.events;
DROP POLICY IF EXISTS "Users can insert events for their accounts" ON public.events;

CREATE POLICY "Users view own events" ON public.events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own events" ON public.events
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT ON public.events TO authenticated;
GRANT ALL ON public.events TO service_role;

-- ============================================================
-- PHASE B.2 — Foreign keys (cascade delete where ownership clear)
-- ============================================================
-- accounts → auth.users (account deletion when user removed)
ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_user_id_fkey,
  ADD CONSTRAINT accounts_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- trades
ALTER TABLE public.trades
  DROP CONSTRAINT IF EXISTS trades_account_id_fkey,
  ADD CONSTRAINT trades_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;
ALTER TABLE public.trades
  DROP CONSTRAINT IF EXISTS trades_user_id_fkey,
  ADD CONSTRAINT trades_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- events
ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_account_id_fkey,
  ADD CONSTRAINT events_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;
ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_user_id_fkey,
  ADD CONSTRAINT events_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- account_balance_snapshots
ALTER TABLE public.account_balance_snapshots
  DROP CONSTRAINT IF EXISTS abs_account_id_fkey,
  ADD CONSTRAINT abs_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;
ALTER TABLE public.account_balance_snapshots
  DROP CONSTRAINT IF EXISTS abs_user_id_fkey,
  ADD CONSTRAINT abs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- terminal_accounts / terminal_snapshots
ALTER TABLE public.terminal_accounts
  DROP CONSTRAINT IF EXISTS terminal_accounts_account_id_fkey,
  ADD CONSTRAINT terminal_accounts_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;
ALTER TABLE public.terminal_accounts
  DROP CONSTRAINT IF EXISTS terminal_accounts_user_id_fkey,
  ADD CONSTRAINT terminal_accounts_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.terminal_snapshots
  DROP CONSTRAINT IF EXISTS terminal_snapshots_account_id_fkey,
  ADD CONSTRAINT terminal_snapshots_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE public.terminal_snapshots
  DROP CONSTRAINT IF EXISTS terminal_snapshots_user_id_fkey,
  ADD CONSTRAINT terminal_snapshots_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- copier_*
ALTER TABLE public.copier_executions
  DROP CONSTRAINT IF EXISTS copier_executions_master_account_id_fkey,
  ADD CONSTRAINT copier_executions_master_account_id_fkey
    FOREIGN KEY (master_account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE public.copier_executions
  DROP CONSTRAINT IF EXISTS copier_executions_receiver_account_id_fkey,
  ADD CONSTRAINT copier_executions_receiver_account_id_fkey
    FOREIGN KEY (receiver_account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;

ALTER TABLE public.copier_symbol_mappings
  DROP CONSTRAINT IF EXISTS copier_symbol_mappings_master_account_id_fkey,
  ADD CONSTRAINT copier_symbol_mappings_master_account_id_fkey
    FOREIGN KEY (master_account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;
ALTER TABLE public.copier_symbol_mappings
  DROP CONSTRAINT IF EXISTS copier_symbol_mappings_receiver_account_id_fkey,
  ADD CONSTRAINT copier_symbol_mappings_receiver_account_id_fkey
    FOREIGN KEY (receiver_account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE public.copier_receiver_settings
  DROP CONSTRAINT IF EXISTS copier_receiver_settings_receiver_account_id_fkey,
  ADD CONSTRAINT copier_receiver_settings_receiver_account_id_fkey
    FOREIGN KEY (receiver_account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

-- setup_tokens
ALTER TABLE public.setup_tokens
  DROP CONSTRAINT IF EXISTS setup_tokens_master_account_id_fkey,
  ADD CONSTRAINT setup_tokens_master_account_id_fkey
    FOREIGN KEY (master_account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;
ALTER TABLE public.setup_tokens
  DROP CONSTRAINT IF EXISTS setup_tokens_user_id_fkey,
  ADD CONSTRAINT setup_tokens_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ai_reviews / ai_feedback
ALTER TABLE public.ai_reviews
  DROP CONSTRAINT IF EXISTS ai_reviews_trade_id_fkey,
  ADD CONSTRAINT ai_reviews_trade_id_fkey
    FOREIGN KEY (trade_id) REFERENCES public.trades(id) ON DELETE CASCADE;
ALTER TABLE public.ai_feedback
  DROP CONSTRAINT IF EXISTS ai_feedback_ai_review_id_fkey,
  ADD CONSTRAINT ai_feedback_ai_review_id_fkey
    FOREIGN KEY (ai_review_id) REFERENCES public.ai_reviews(id) ON DELETE CASCADE;

-- shared_report_trades
ALTER TABLE public.shared_report_trades
  DROP CONSTRAINT IF EXISTS shared_report_trades_shared_report_id_fkey,
  ADD CONSTRAINT shared_report_trades_shared_report_id_fkey
    FOREIGN KEY (shared_report_id) REFERENCES public.shared_reports(id) ON DELETE CASCADE;
ALTER TABLE public.shared_report_trades
  DROP CONSTRAINT IF EXISTS shared_report_trades_trade_id_fkey,
  ADD CONSTRAINT shared_report_trades_trade_id_fkey
    FOREIGN KEY (trade_id) REFERENCES public.trades(id) ON DELETE CASCADE;

-- ============================================================
-- PHASE B.3 — Drop dead column
-- ============================================================
ALTER TABLE public.terminal_accounts DROP COLUMN IF EXISTS is_currently_active;

-- ============================================================
-- PHASE B.4 — Replace mark-dormant-accounts edge fn with pg_cron
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_dormant_accounts()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.accounts
  SET live_state = 'dormant'
  WHERE live_state = 'live'
    AND last_heartbeat_at IS NOT NULL
    AND last_heartbeat_at < now() - interval '10 minutes';
$$;

-- Unschedule any previous job with same name, then schedule fresh
DO $$
BEGIN
  PERFORM cron.unschedule('mark-dormant-accounts');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'mark-dormant-accounts',
  '*/2 * * * *',
  $$SELECT public.mark_dormant_accounts();$$
);
