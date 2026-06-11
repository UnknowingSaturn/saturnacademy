
CREATE TABLE public.symbol_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  raw_symbol text NOT NULL,
  canonical_symbol text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, raw_symbol)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.symbol_aliases TO authenticated;
GRANT ALL ON public.symbol_aliases TO service_role;

ALTER TABLE public.symbol_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own symbol aliases"
ON public.symbol_aliases FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_symbol_aliases_updated_at
BEFORE UPDATE ON public.symbol_aliases
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_symbol_aliases_user ON public.symbol_aliases(user_id);
