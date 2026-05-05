ALTER TABLE public.user_settings
ADD COLUMN IF NOT EXISTS deleted_system_fields jsonb NOT NULL DEFAULT '[]'::jsonb;