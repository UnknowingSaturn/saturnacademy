CREATE TABLE public.mt5_installs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  install_id text NOT NULL,
  api_key text NOT NULL,
  label text,
  status text NOT NULL DEFAULT 'active',
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mt5_installs_status_chk CHECK (status IN ('active','revoked')),
  CONSTRAINT mt5_installs_user_install_uniq UNIQUE (user_id, install_id),
  CONSTRAINT mt5_installs_api_key_uniq UNIQUE (api_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mt5_installs TO authenticated;
GRANT ALL ON public.mt5_installs TO service_role;

ALTER TABLE public.mt5_installs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own MT5 installs"
  ON public.mt5_installs FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_mt5_installs_updated_at
  BEFORE UPDATE ON public.mt5_installs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX mt5_installs_api_key_idx ON public.mt5_installs (api_key);

-- Backfill: one install row per (user_id, mt5_install_id), reusing the key of
-- the most recently active account on that install so the EA keeps working.
INSERT INTO public.mt5_installs (user_id, install_id, api_key, label, last_seen_at)
SELECT DISTINCT ON (a.user_id, a.mt5_install_id)
       a.user_id,
       a.mt5_install_id,
       a.api_key,
       'MT5 install ' || left(a.mt5_install_id, 8),
       a.last_heartbeat_at
  FROM public.accounts a
 WHERE a.mt5_install_id IS NOT NULL
   AND a.api_key IS NOT NULL
 ORDER BY a.user_id, a.mt5_install_id, a.last_heartbeat_at DESC NULLS LAST, a.created_at DESC
ON CONFLICT (user_id, install_id) DO NOTHING;