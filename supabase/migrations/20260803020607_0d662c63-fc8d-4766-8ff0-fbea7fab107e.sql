ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS journal_field_layout jsonb DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.user_settings.journal_field_layout IS 'Unified field layout: table order/hidden, detail order/hidden/groups, removed fields, label overrides.';