
-- =====================================================================
-- Phase 1: Critical fixes — security, indexes, atomicity, integrity
-- =====================================================================

-- 1. CRITICAL: Re-enable security_invoker on trade_view (RLS bypass fix)
DROP VIEW IF EXISTS public.trade_view;

CREATE VIEW public.trade_view
WITH (security_invoker = on) AS
SELECT t.id,
    t.user_id,
    t.account_id,
    t.terminal_id,
    t.ticket,
    t.symbol,
    t.direction,
    t.total_lots,
    t.entry_price,
    t.entry_time,
    t.exit_price,
    t.exit_time,
    t.sl_initial,
    t.tp_initial,
    t.sl_final,
    t.tp_final,
    t.gross_pnl,
    t.commission,
    t.swap,
    t.net_pnl,
    t.r_multiple_planned,
    t.r_multiple_actual,
    t.session,
    t.duration_seconds,
    t.is_open,
    t.created_at,
    t.updated_at,
    t.alignment,
    t.entry_timeframes,
    t.profile,
    t.place,
    t.trade_number,
    t.original_lots,
    t.balance_at_entry,
    t.equity_at_entry,
    t.playbook_id,
    t.is_archived,
    t.archived_at,
    t.trade_type,
    t.risk_percent,
    t.actual_playbook_id,
    t.actual_profile,
    t.actual_regime,
    t.custom_fields,
    t.install_id,
    t.broker_login,
    t.repair_state,
    COALESCE((SELECT a.id
              FROM public.accounts a
              WHERE a.user_id = t.user_id
                AND a.account_number = t.broker_login
                AND a.mt5_install_id = t.install_id
                AND a.is_active = true
              LIMIT 1), t.account_id) AS resolved_account_id
FROM public.trades t;

GRANT SELECT ON public.trade_view TO authenticated;
GRANT ALL ON public.trade_view TO service_role;

-- 2. Missing indexes on hot RLS paths
CREATE INDEX IF NOT EXISTS idx_accounts_user_id
  ON public.accounts(user_id);

CREATE INDEX IF NOT EXISTS idx_ai_reviews_user_id
  ON public.ai_reviews(user_id);

CREATE INDEX IF NOT EXISTS idx_trade_partial_fills_user_id
  ON public.trade_partial_fills(user_id);

CREATE INDEX IF NOT EXISTS idx_trade_modifications_user_id
  ON public.trade_modifications(user_id);

CREATE INDEX IF NOT EXISTS idx_trade_repair_events_user_id
  ON public.trade_repair_events(user_id);

CREATE INDEX IF NOT EXISTS idx_trades_user_entry
  ON public.trades(user_id, entry_time DESC);

CREATE INDEX IF NOT EXISTS idx_trades_user_open
  ON public.trades(user_id) WHERE is_open = true;

CREATE INDEX IF NOT EXISTS idx_events_user_timestamp
  ON public.events(user_id, event_timestamp DESC);

-- 3. Atomic view-count increment RPC for shared reports
CREATE OR REPLACE FUNCTION public.increment_shared_report_view(p_report_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.shared_reports
  SET view_count = view_count + 1
  WHERE id = p_report_id
    AND visibility = 'public_link'
    AND published_at IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_shared_report_view(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_shared_report_view(uuid) TO anon, authenticated, service_role;

-- 4. Lock-safe per-user trade_number generator (prevents concurrent dupes)
CREATE OR REPLACE FUNCTION public.set_trade_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.trade_number IS NULL THEN
    -- Serialize trade_number assignment per-user within the transaction.
    PERFORM pg_advisory_xact_lock(hashtext('trade_number:' || NEW.user_id::text));
    SELECT COALESCE(MAX(trade_number), 0) + 1
      INTO NEW.trade_number
      FROM public.trades
      WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

-- 5. updated_at triggers on copier settings/mappings (was frozen at insert time)
DROP TRIGGER IF EXISTS trg_copier_symbol_mappings_updated_at ON public.copier_symbol_mappings;
CREATE TRIGGER trg_copier_symbol_mappings_updated_at
  BEFORE UPDATE ON public.copier_symbol_mappings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_copier_receiver_settings_updated_at ON public.copier_receiver_settings;
CREATE TRIGGER trg_copier_receiver_settings_updated_at
  BEFORE UPDATE ON public.copier_receiver_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. Missing FKs to auth.users (NOT VALID grandfathers any historical orphans;
--    enforced on all future writes).
ALTER TABLE public.reports
  DROP CONSTRAINT IF EXISTS reports_user_id_fkey,
  ADD CONSTRAINT reports_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.reports
  DROP CONSTRAINT IF EXISTS reports_account_id_fkey,
  ADD CONSTRAINT reports_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL NOT VALID;

ALTER TABLE public.knowledge_entries
  DROP CONSTRAINT IF EXISTS knowledge_entries_user_id_fkey,
  ADD CONSTRAINT knowledge_entries_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.knowledge_chat_messages
  DROP CONSTRAINT IF EXISTS knowledge_chat_messages_user_id_fkey,
  ADD CONSTRAINT knowledge_chat_messages_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.shared_reports
  DROP CONSTRAINT IF EXISTS shared_reports_user_id_fkey,
  ADD CONSTRAINT shared_reports_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.trade_partial_fills
  DROP CONSTRAINT IF EXISTS trade_partial_fills_user_id_fkey,
  ADD CONSTRAINT trade_partial_fills_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.trade_modifications
  DROP CONSTRAINT IF EXISTS trade_modifications_user_id_fkey,
  ADD CONSTRAINT trade_modifications_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.trade_repair_events
  DROP CONSTRAINT IF EXISTS trade_repair_events_user_id_fkey,
  ADD CONSTRAINT trade_repair_events_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.report_schedule_runs
  DROP CONSTRAINT IF EXISTS report_schedule_runs_user_id_fkey,
  ADD CONSTRAINT report_schedule_runs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.report_schedule_runs
  DROP CONSTRAINT IF EXISTS report_schedule_runs_report_id_fkey,
  ADD CONSTRAINT report_schedule_runs_report_id_fkey
    FOREIGN KEY (report_id) REFERENCES public.reports(id) ON DELETE SET NULL NOT VALID;

-- 7. Make the self-referential master_account_id FK SET NULL on delete
--    (previously RESTRICT — blocked master account deletion if receivers pointed to it).
ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_master_account_id_fkey;
ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_master_account_id_fkey
    FOREIGN KEY (master_account_id) REFERENCES public.accounts(id) ON DELETE SET NULL NOT VALID;
