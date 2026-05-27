CREATE TABLE public.account_balance_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  balance numeric NOT NULL,
  equity numeric,
  margin numeric,
  free_margin numeric,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_minute bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_acct_bal_snap_dedup ON public.account_balance_snapshots(account_id, recorded_minute);
CREATE INDEX idx_acct_bal_snap_acct_time ON public.account_balance_snapshots(account_id, recorded_at DESC);
CREATE INDEX idx_acct_bal_snap_user_time ON public.account_balance_snapshots(user_id, recorded_at DESC);

GRANT SELECT, INSERT ON public.account_balance_snapshots TO authenticated;
GRANT ALL ON public.account_balance_snapshots TO service_role;

ALTER TABLE public.account_balance_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own balance snapshots"
ON public.account_balance_snapshots FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users insert own balance snapshots"
ON public.account_balance_snapshots FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);