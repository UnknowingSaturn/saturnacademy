ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS detail_visible_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS detail_field_order jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS detail_visible_sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS detail_section_order jsonb NOT NULL DEFAULT '[]'::jsonb;