
-- ============================================================
-- 1. RLS: add TO authenticated to policies that defaulted to PUBLIC
-- ============================================================

-- copier_executions
DROP POLICY IF EXISTS "Users can create own executions" ON public.copier_executions;
DROP POLICY IF EXISTS "Users can delete own executions" ON public.copier_executions;
DROP POLICY IF EXISTS "Users can update own executions" ON public.copier_executions;
DROP POLICY IF EXISTS "Users can view own executions" ON public.copier_executions;
CREATE POLICY "Users can create own executions" ON public.copier_executions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view own executions"   ON public.copier_executions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can update own executions" ON public.copier_executions FOR UPDATE TO authenticated USING (auth.uid() = user_id);
-- Intentionally omit DELETE — executions are an audit log

-- copier_symbol_mappings
DROP POLICY IF EXISTS "Users can create own symbol mappings" ON public.copier_symbol_mappings;
DROP POLICY IF EXISTS "Users can delete own symbol mappings" ON public.copier_symbol_mappings;
DROP POLICY IF EXISTS "Users can update own symbol mappings" ON public.copier_symbol_mappings;
DROP POLICY IF EXISTS "Users can view own symbol mappings" ON public.copier_symbol_mappings;
CREATE POLICY "Users can create own symbol mappings" ON public.copier_symbol_mappings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view own symbol mappings"   ON public.copier_symbol_mappings FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can update own symbol mappings" ON public.copier_symbol_mappings FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own symbol mappings" ON public.copier_symbol_mappings FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- copier_receiver_settings
DROP POLICY IF EXISTS "Users can create own receiver settings" ON public.copier_receiver_settings;
DROP POLICY IF EXISTS "Users can delete own receiver settings" ON public.copier_receiver_settings;
DROP POLICY IF EXISTS "Users can update own receiver settings" ON public.copier_receiver_settings;
DROP POLICY IF EXISTS "Users can view own receiver settings" ON public.copier_receiver_settings;
CREATE POLICY "Users can create own receiver settings" ON public.copier_receiver_settings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view own receiver settings"   ON public.copier_receiver_settings FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can update own receiver settings" ON public.copier_receiver_settings FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own receiver settings" ON public.copier_receiver_settings FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- notebook_entries
DROP POLICY IF EXISTS "Users can create own notebook entries" ON public.notebook_entries;
DROP POLICY IF EXISTS "Users can delete own notebook entries" ON public.notebook_entries;
DROP POLICY IF EXISTS "Users can update own notebook entries" ON public.notebook_entries;
DROP POLICY IF EXISTS "Users can view own notebook entries" ON public.notebook_entries;
CREATE POLICY "Users can create own notebook entries" ON public.notebook_entries FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view own notebook entries"   ON public.notebook_entries FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can update own notebook entries" ON public.notebook_entries FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own notebook entries" ON public.notebook_entries FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- session_definitions
DROP POLICY IF EXISTS "Users can create own sessions" ON public.session_definitions;
DROP POLICY IF EXISTS "Users can delete own sessions" ON public.session_definitions;
DROP POLICY IF EXISTS "Users can update own sessions" ON public.session_definitions;
DROP POLICY IF EXISTS "Users can view own sessions" ON public.session_definitions;
CREATE POLICY "Users can create own sessions" ON public.session_definitions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view own sessions"   ON public.session_definitions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can update own sessions" ON public.session_definitions FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own sessions" ON public.session_definitions FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- playbooks
DROP POLICY IF EXISTS "Users can create own playbooks" ON public.playbooks;
DROP POLICY IF EXISTS "Users can delete own playbooks" ON public.playbooks;
DROP POLICY IF EXISTS "Users can update own playbooks" ON public.playbooks;
DROP POLICY IF EXISTS "Users can view own playbooks" ON public.playbooks;
CREATE POLICY "Users can create own playbooks" ON public.playbooks FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view own playbooks"   ON public.playbooks FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can update own playbooks" ON public.playbooks FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own playbooks" ON public.playbooks FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- trade_comments
DROP POLICY IF EXISTS "Users can create own comments" ON public.trade_comments;
DROP POLICY IF EXISTS "Users can delete own comments" ON public.trade_comments;
DROP POLICY IF EXISTS "Users can view own trade comments" ON public.trade_comments;
CREATE POLICY "Users can create own comments"      ON public.trade_comments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view own trade comments"  ON public.trade_comments FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own comments"      ON public.trade_comments FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- setup_tokens
DROP POLICY IF EXISTS "Users can create own setup tokens" ON public.setup_tokens;
DROP POLICY IF EXISTS "Users can delete own setup tokens" ON public.setup_tokens;
DROP POLICY IF EXISTS "Users can view own setup tokens" ON public.setup_tokens;
CREATE POLICY "Users can create own setup tokens" ON public.setup_tokens FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view own setup tokens"   ON public.setup_tokens FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own setup tokens" ON public.setup_tokens FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- accounts
DROP POLICY IF EXISTS "Users can create own accounts" ON public.accounts;
DROP POLICY IF EXISTS "Users can delete own accounts" ON public.accounts;
DROP POLICY IF EXISTS "Users can update own accounts" ON public.accounts;
DROP POLICY IF EXISTS "Users can view own accounts" ON public.accounts;
CREATE POLICY "Users can create own accounts" ON public.accounts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view own accounts"   ON public.accounts FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can update own accounts" ON public.accounts FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own accounts" ON public.accounts FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- reports
DROP POLICY IF EXISTS "Users can create own reports" ON public.reports;
DROP POLICY IF EXISTS "Users can delete own reports" ON public.reports;
DROP POLICY IF EXISTS "Users can update own reports" ON public.reports;
DROP POLICY IF EXISTS "Users can view own reports" ON public.reports;
CREATE POLICY "Users can create own reports" ON public.reports FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view own reports"   ON public.reports FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can update own reports" ON public.reports FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own reports" ON public.reports FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- report_schedule_runs (read-only for users)
DROP POLICY IF EXISTS "Users can view own schedule runs" ON public.report_schedule_runs;
CREATE POLICY "Users can view own schedule runs" ON public.report_schedule_runs FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- knowledge_entries
DROP POLICY IF EXISTS "Users can delete own knowledge entries" ON public.knowledge_entries;
DROP POLICY IF EXISTS "Users can insert own knowledge entries" ON public.knowledge_entries;
DROP POLICY IF EXISTS "Users can update own knowledge entries" ON public.knowledge_entries;
DROP POLICY IF EXISTS "Users can view own knowledge entries" ON public.knowledge_entries;
CREATE POLICY "Users can insert own knowledge entries" ON public.knowledge_entries FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view own knowledge entries"   ON public.knowledge_entries FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can update own knowledge entries" ON public.knowledge_entries FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own knowledge entries" ON public.knowledge_entries FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- knowledge_chat_messages
DROP POLICY IF EXISTS "Users can delete own knowledge chat" ON public.knowledge_chat_messages;
DROP POLICY IF EXISTS "Users can insert own knowledge chat" ON public.knowledge_chat_messages;
DROP POLICY IF EXISTS "Users can view own knowledge chat" ON public.knowledge_chat_messages;
CREATE POLICY "Users can insert own knowledge chat" ON public.knowledge_chat_messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view own knowledge chat"   ON public.knowledge_chat_messages FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own knowledge chat" ON public.knowledge_chat_messages FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- custom_field_definitions
DROP POLICY IF EXISTS "Users can create own field defs" ON public.custom_field_definitions;
DROP POLICY IF EXISTS "Users can delete own field defs" ON public.custom_field_definitions;
DROP POLICY IF EXISTS "Users can update own field defs" ON public.custom_field_definitions;
DROP POLICY IF EXISTS "Users can view own field defs" ON public.custom_field_definitions;
CREATE POLICY "Users can create own field defs" ON public.custom_field_definitions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view own field defs"   ON public.custom_field_definitions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can update own field defs" ON public.custom_field_definitions FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own field defs" ON public.custom_field_definitions FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- profiles
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can view own profile"   ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- shared_reports owner policies (anon/authenticated public-link policies kept as-is)
DROP POLICY IF EXISTS "Owners can delete own shared reports" ON public.shared_reports;
DROP POLICY IF EXISTS "Owners can insert own shared reports" ON public.shared_reports;
DROP POLICY IF EXISTS "Owners can update own shared reports" ON public.shared_reports;
DROP POLICY IF EXISTS "Owners can view own shared reports" ON public.shared_reports;
CREATE POLICY "Owners can insert own shared reports" ON public.shared_reports FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owners can view own shared reports"   ON public.shared_reports FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owners can update own shared reports" ON public.shared_reports FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owners can delete own shared reports" ON public.shared_reports FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- shared_report_trades owner policies
DROP POLICY IF EXISTS "Owners can delete own report trades" ON public.shared_report_trades;
DROP POLICY IF EXISTS "Owners can insert own report trades" ON public.shared_report_trades;
DROP POLICY IF EXISTS "Owners can update own report trades" ON public.shared_report_trades;
DROP POLICY IF EXISTS "Owners can view own report trades" ON public.shared_report_trades;
CREATE POLICY "Owners can insert own report trades" ON public.shared_report_trades FOR INSERT TO authenticated WITH CHECK (shared_report_id IN (SELECT id FROM public.shared_reports WHERE user_id = auth.uid()));
CREATE POLICY "Owners can view own report trades"   ON public.shared_report_trades FOR SELECT TO authenticated USING (shared_report_id IN (SELECT id FROM public.shared_reports WHERE user_id = auth.uid()));
CREATE POLICY "Owners can update own report trades" ON public.shared_report_trades FOR UPDATE TO authenticated USING (shared_report_id IN (SELECT id FROM public.shared_reports WHERE user_id = auth.uid()));
CREATE POLICY "Owners can delete own report trades" ON public.shared_report_trades FOR DELETE TO authenticated USING (shared_report_id IN (SELECT id FROM public.shared_reports WHERE user_id = auth.uid()));

-- ============================================================
-- 2. trade_reviews + trade_features: switch to has_trade_access()
-- ============================================================

DROP POLICY IF EXISTS "Users can create reviews for own trades" ON public.trade_reviews;
DROP POLICY IF EXISTS "Users can delete own trade reviews" ON public.trade_reviews;
DROP POLICY IF EXISTS "Users can update own trade reviews" ON public.trade_reviews;
DROP POLICY IF EXISTS "Users can view own trade reviews" ON public.trade_reviews;
CREATE POLICY "Users can create reviews for own trades" ON public.trade_reviews FOR INSERT TO authenticated WITH CHECK (public.has_trade_access(trade_id));
CREATE POLICY "Users can view own trade reviews"        ON public.trade_reviews FOR SELECT TO authenticated USING (public.has_trade_access(trade_id));
CREATE POLICY "Users can update own trade reviews"      ON public.trade_reviews FOR UPDATE TO authenticated USING (public.has_trade_access(trade_id));
CREATE POLICY "Users can delete own trade reviews"      ON public.trade_reviews FOR DELETE TO authenticated USING (public.has_trade_access(trade_id));

DROP POLICY IF EXISTS "Users can insert features for own trades" ON public.trade_features;
DROP POLICY IF EXISTS "Users can delete features for own trades" ON public.trade_features;
DROP POLICY IF EXISTS "Users can update features for own trades" ON public.trade_features;
DROP POLICY IF EXISTS "Users can view features for own trades" ON public.trade_features;
CREATE POLICY "Users can insert features for own trades" ON public.trade_features FOR INSERT TO authenticated WITH CHECK (public.has_trade_access(trade_id));
CREATE POLICY "Users can view features for own trades"   ON public.trade_features FOR SELECT TO authenticated USING (public.has_trade_access(trade_id));
CREATE POLICY "Users can update features for own trades" ON public.trade_features FOR UPDATE TO authenticated USING (public.has_trade_access(trade_id));
CREATE POLICY "Users can delete features for own trades" ON public.trade_features FOR DELETE TO authenticated USING (public.has_trade_access(trade_id));

-- ============================================================
-- 3. Hot-path indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_trades_account_entry_time   ON public.trades (account_id, entry_time DESC);
CREATE INDEX IF NOT EXISTS idx_events_account_event_time   ON public.events (account_id, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_shared_reports_public       ON public.shared_reports (visibility, published_at) WHERE visibility = 'public_link';
CREATE INDEX IF NOT EXISTS idx_shared_report_trades_order  ON public.shared_report_trades (shared_report_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_copier_exec_receiver_time   ON public.copier_executions (receiver_account_id, executed_at DESC);

-- ============================================================
-- 4. Drop orphaned / unused objects
-- ============================================================
DROP TABLE IF EXISTS public.copier_config_versions CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ai_provider') THEN
    DROP TYPE public.ai_provider CASCADE;
  END IF;
END$$;

-- ============================================================
-- 5. CHECK constraint on trade_repair_events.action
-- ============================================================
ALTER TABLE public.trade_repair_events DROP CONSTRAINT IF EXISTS trade_repair_events_action_check;
ALTER TABLE public.trade_repair_events
  ADD CONSTRAINT trade_repair_events_action_check
  CHECK (action IN (
    'snapshot_closed',
    'repaired_from_snapshot',
    'repaired_reopened',
    'advisory_closed',
    'reconciled',
    'restored_entry_time',
    'reclassified_session',
    'manual_dismiss',
    'manual_repair'
  )) NOT VALID;

-- ============================================================
-- 6. Validate the NOT VALID FKs added in Phase 1
-- ============================================================
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT conrelid::regclass::text AS tbl, conname
    FROM pg_constraint
    WHERE contype = 'f'
      AND NOT convalidated
      AND connamespace = 'public'::regnamespace
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', rec.tbl, rec.conname);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipped validating % on %: %', rec.conname, rec.tbl, SQLERRM;
    END;
  END LOOP;
END$$;

-- ============================================================
-- 7. Atomic equity_current RPC (avoids the read/compute/write race)
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_equity_delta(_account_id uuid, _delta numeric)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.accounts
     SET equity_current = COALESCE(equity_current, 0) + _delta,
         updated_at = now()
   WHERE id = _account_id;
$$;
REVOKE ALL ON FUNCTION public.apply_equity_delta(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_equity_delta(uuid, numeric) TO service_role;
