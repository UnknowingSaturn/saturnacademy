
DO $$ BEGIN
  CREATE TYPE public.account_live_state AS ENUM ('live', 'dormant', 'verifying', 'stale');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS live_state public.account_live_state NOT NULL DEFAULT 'live',
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS force_resync boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS accounts_live_state_idx ON public.accounts (live_state);
CREATE INDEX IF NOT EXISTS accounts_last_heartbeat_idx ON public.accounts (last_heartbeat_at);
