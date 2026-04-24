-- 1. Per-user column rename/resize overrides
ALTER TABLE public.user_settings 
  ADD COLUMN IF NOT EXISTS column_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2. User-defined custom column definitions
CREATE TABLE IF NOT EXISTS public.custom_field_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  key text NOT NULL,
  label text NOT NULL,
  type text NOT NULL CHECK (type IN ('text','number','select','multi_select','date','checkbox','url')),
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_value jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
);

ALTER TABLE public.custom_field_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own field defs"
  ON public.custom_field_definitions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own field defs"
  ON public.custom_field_definitions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own field defs"
  ON public.custom_field_definitions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own field defs"
  ON public.custom_field_definitions FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_custom_field_definitions_updated_at
  BEFORE UPDATE ON public.custom_field_definitions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_custom_field_definitions_user
  ON public.custom_field_definitions (user_id, sort_order);

-- 3. Per-trade custom field values
ALTER TABLE public.trades 
  ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;