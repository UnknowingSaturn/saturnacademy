ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS field_label_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;