
-- 1. terminal_snapshots
CREATE TABLE public.terminal_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  terminal_id text NOT NULL,
  active_login text,
  account_id uuid,
  open_tickets bigint[] NOT NULL DEFAULT '{}',
  ea_version text,
  raw_payload jsonb,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_terminal_snapshots_terminal_login_recv
  ON public.terminal_snapshots (terminal_id, active_login, received_at DESC);
CREATE INDEX idx_terminal_snapshots_user_recv
  ON public.terminal_snapshots (user_id, received_at DESC);
CREATE INDEX idx_terminal_snapshots_account_recv
  ON public.terminal_snapshots (account_id, received_at DESC);

GRANT SELECT ON public.terminal_snapshots TO authenticated;
GRANT ALL ON public.terminal_snapshots TO service_role;

ALTER TABLE public.terminal_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own terminal snapshots"
  ON public.terminal_snapshots FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- 2. terminal_accounts
CREATE TABLE public.terminal_accounts (
  terminal_id text NOT NULL,
  account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  is_currently_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (terminal_id, account_id)
);

CREATE INDEX idx_terminal_accounts_user ON public.terminal_accounts (user_id);
CREATE INDEX idx_terminal_accounts_active
  ON public.terminal_accounts (terminal_id, is_currently_active);

GRANT SELECT ON public.terminal_accounts TO authenticated;
GRANT ALL ON public.terminal_accounts TO service_role;

ALTER TABLE public.terminal_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own terminal accounts"
  ON public.terminal_accounts FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_terminal_accounts_updated_at
  BEFORE UPDATE ON public.terminal_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Backfill: clear false break-even PnL on snapshot_closed rows
UPDATE public.trades
SET net_pnl = NULL, gross_pnl = NULL
WHERE is_open = false
  AND net_pnl = 0
  AND gross_pnl = 0
  AND partial_closes @> '[{"type":"snapshot_closed"}]'::jsonb
  AND NOT (partial_closes @> '[{"type":"repaired_from_snapshot"}]'::jsonb)
  AND NOT (partial_closes @> '[{"type":"repaired_reopened"}]'::jsonb);
