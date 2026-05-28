-- R11 partial: drop ea_type column + enum, keep copier_role as single source
DROP INDEX IF EXISTS public.idx_accounts_copier;

ALTER TABLE public.accounts DROP COLUMN IF EXISTS ea_type;

DROP TYPE IF EXISTS public.ea_type;

CREATE INDEX IF NOT EXISTS idx_accounts_copier
  ON public.accounts(user_id, copier_role)
  WHERE copier_enabled = true;