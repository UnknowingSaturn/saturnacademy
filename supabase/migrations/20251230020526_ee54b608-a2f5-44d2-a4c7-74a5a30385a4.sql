-- Add historical sync settings columns to accounts table
ALTER TABLE public.accounts 
ADD COLUMN sync_history_enabled boolean DEFAULT true,
ADD COLUMN sync_history_from timestamptz;