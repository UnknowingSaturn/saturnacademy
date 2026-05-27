
-- ============================================================
-- Phase D.1: Additive schema
-- ============================================================

-- 1. Add stable identity columns to events
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS install_id text,
  ADD COLUMN IF NOT EXISTS broker_login text;

-- 2. Add stable identity + repair_state to trades
ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS install_id text,
  ADD COLUMN IF NOT EXISTS broker_login text,
  ADD COLUMN IF NOT EXISTS repair_state text NOT NULL DEFAULT 'none';

ALTER TABLE public.trades
  DROP CONSTRAINT IF EXISTS trades_repair_state_check;
ALTER TABLE public.trades
  ADD CONSTRAINT trades_repair_state_check
  CHECK (repair_state IN ('none','pending_exit','advisory_closed','reconciled'));

-- 3. Backfill identity columns from raw_payload + accounts
UPDATE public.events e
SET
  install_id  = COALESCE(e.install_id,  (e.raw_payload->>'install_id'), a.mt5_install_id),
  broker_login = COALESCE(
    e.broker_login,
    (e.raw_payload->'account_info'->>'login'),
    a.account_number
  )
FROM public.accounts a
WHERE e.account_id = a.id
  AND (e.install_id IS NULL OR e.broker_login IS NULL);

UPDATE public.trades t
SET
  install_id   = COALESCE(t.install_id,   a.mt5_install_id),
  broker_login = COALESCE(t.broker_login, a.account_number)
FROM public.accounts a
WHERE t.account_id = a.id
  AND (t.install_id IS NULL OR t.broker_login IS NULL);

-- Lookup indexes for the read-time resolver
CREATE INDEX IF NOT EXISTS idx_events_user_install_login
  ON public.events (user_id, install_id, broker_login);
CREATE INDEX IF NOT EXISTS idx_trades_user_install_login
  ON public.trades (user_id, install_id, broker_login);
CREATE INDEX IF NOT EXISTS idx_accounts_user_install_login
  ON public.accounts (user_id, mt5_install_id, account_number);

-- ============================================================
-- 4. trade_partial_fills — typed replacement for partial_closes JSONB
-- ============================================================
CREATE TABLE IF NOT EXISTS public.trade_partial_fills (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  trade_id      uuid NOT NULL REFERENCES public.trades(id) ON DELETE CASCADE,
  ticket        bigint,
  deal_id       bigint,
  lots          numeric NOT NULL,
  price         numeric NOT NULL,
  profit        numeric,
  commission    numeric DEFAULT 0,
  swap          numeric DEFAULT 0,
  occurred_at   timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trade_partial_fills_trade
  ON public.trade_partial_fills (trade_id, occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_trade_partial_fills_deal
  ON public.trade_partial_fills (trade_id, deal_id)
  WHERE deal_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trade_partial_fills TO authenticated;
GRANT ALL ON public.trade_partial_fills TO service_role;

ALTER TABLE public.trade_partial_fills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own partial fills"
  ON public.trade_partial_fills FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users insert own partial fills"
  ON public.trade_partial_fills FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own partial fills"
  ON public.trade_partial_fills FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users delete own partial fills"
  ON public.trade_partial_fills FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- 5. trade_modifications — typed SL/TP change history
-- ============================================================
CREATE TABLE IF NOT EXISTS public.trade_modifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  trade_id      uuid NOT NULL REFERENCES public.trades(id) ON DELETE CASCADE,
  field         text NOT NULL CHECK (field IN ('sl','tp')),
  old_value     numeric,
  new_value     numeric,
  occurred_at   timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trade_modifications_trade
  ON public.trade_modifications (trade_id, occurred_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trade_modifications TO authenticated;
GRANT ALL ON public.trade_modifications TO service_role;

ALTER TABLE public.trade_modifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own modifications"
  ON public.trade_modifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users insert own modifications"
  ON public.trade_modifications FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own modifications"
  ON public.trade_modifications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users delete own modifications"
  ON public.trade_modifications FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- 6. trade_repair_events — audit log of repair actions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.trade_repair_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  trade_id      uuid NOT NULL REFERENCES public.trades(id) ON DELETE CASCADE,
  action        text NOT NULL,
  source        text,
  metadata      jsonb DEFAULT '{}'::jsonb,
  applied_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trade_repair_events_trade
  ON public.trade_repair_events (trade_id, applied_at);

GRANT SELECT, INSERT ON public.trade_repair_events TO authenticated;
GRANT ALL ON public.trade_repair_events TO service_role;

ALTER TABLE public.trade_repair_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own repair events"
  ON public.trade_repair_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users insert own repair events"
  ON public.trade_repair_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 7. trade_view — resolves the account at read time
-- ============================================================
DROP VIEW IF EXISTS public.trade_view;
CREATE VIEW public.trade_view
WITH (security_invoker = on) AS
SELECT
  t.*,
  COALESCE(
    (
      SELECT a.id FROM public.accounts a
      WHERE a.user_id = t.user_id
        AND a.account_number = t.broker_login
        AND a.mt5_install_id = t.install_id
        AND a.is_active = true
      LIMIT 1
    ),
    t.account_id
  ) AS resolved_account_id
FROM public.trades t;

GRANT SELECT ON public.trade_view TO authenticated;
GRANT ALL ON public.trade_view TO service_role;
