
CREATE TABLE public.symbol_groups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  symbols TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.symbol_groups TO authenticated;
GRANT ALL ON public.symbol_groups TO service_role;

ALTER TABLE public.symbol_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own symbol_groups"
  ON public.symbol_groups
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_symbol_groups_updated_at
  BEFORE UPDATE ON public.symbol_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_symbol_groups_user ON public.symbol_groups(user_id);
