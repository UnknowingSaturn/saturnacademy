-- R11 full: prop_firm enum → prop_firms lookup table

CREATE TABLE public.prop_firms (
  id text PRIMARY KEY,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.prop_firms TO anon, authenticated;
GRANT ALL ON public.prop_firms TO service_role;

ALTER TABLE public.prop_firms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view prop firms"
  ON public.prop_firms FOR SELECT
  TO anon, authenticated
  USING (true);

INSERT INTO public.prop_firms (id, name, sort_order) VALUES
  ('ftmo', 'FTMO', 10),
  ('fundednext', 'FundedNext', 20),
  ('other', 'Other', 999);

-- Convert accounts.prop_firm enum → text
ALTER TABLE public.accounts
  ALTER COLUMN prop_firm TYPE text USING prop_firm::text;

ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_prop_firm_fkey
  FOREIGN KEY (prop_firm) REFERENCES public.prop_firms(id) ON UPDATE CASCADE;

-- Convert prop_firm_rules.firm enum → text
ALTER TABLE public.prop_firm_rules
  ALTER COLUMN firm TYPE text USING firm::text;

ALTER TABLE public.prop_firm_rules
  ADD CONSTRAINT prop_firm_rules_firm_fkey
  FOREIGN KEY (firm) REFERENCES public.prop_firms(id) ON UPDATE CASCADE;

-- Drop the now-unused enum
DROP TYPE public.prop_firm;