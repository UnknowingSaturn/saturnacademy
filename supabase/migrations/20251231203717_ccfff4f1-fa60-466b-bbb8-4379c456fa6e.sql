-- Add ea_type enum to track which EA is actually running
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ea_type') THEN
    CREATE TYPE public.ea_type AS ENUM ('journal', 'master', 'receiver');
  END IF;
END$$;

-- Add ea_type column to accounts
ALTER TABLE public.accounts 
ADD COLUMN IF NOT EXISTS ea_type public.ea_type DEFAULT NULL;

-- Reset copier_role for all accounts since no copier EAs are installed yet
-- This clears the manual role assignments
UPDATE public.accounts 
SET copier_role = 'independent', 
    copier_enabled = false, 
    master_account_id = NULL
WHERE copier_role != 'independent';