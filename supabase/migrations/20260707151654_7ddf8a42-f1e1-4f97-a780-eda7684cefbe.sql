ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS pair_lab_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.user_settings.pair_lab_prefs IS
  'Per-user last-used Pair Lab filter state (profile, propFirmMode, includeUnrealized, includeUnassigned, scope, tab, lens, distanceUnit). Hydrated on Pair Lab mount when URL params are absent; URL params always win.';