CREATE TABLE public.field_overrides (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  field_key TEXT NOT NULL,
  type TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, field_key)
);

ALTER TABLE public.field_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own field overrides" ON public.field_overrides
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own field overrides" ON public.field_overrides
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own field overrides" ON public.field_overrides
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own field overrides" ON public.field_overrides
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_field_overrides_updated_at
  BEFORE UPDATE ON public.field_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_field_overrides_user ON public.field_overrides(user_id);