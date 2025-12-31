-- Add copier_role and master_account_id to setup_tokens table
-- This allows the setup token to carry the intended role when accounts are auto-created

ALTER TABLE public.setup_tokens 
ADD COLUMN IF NOT EXISTS copier_role public.copier_role DEFAULT 'independent';

ALTER TABLE public.setup_tokens 
ADD COLUMN IF NOT EXISTS master_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;