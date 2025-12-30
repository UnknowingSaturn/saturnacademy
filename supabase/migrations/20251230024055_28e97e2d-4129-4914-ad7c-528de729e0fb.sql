-- Add sync history settings to setup_tokens table
ALTER TABLE public.setup_tokens 
ADD COLUMN IF NOT EXISTS sync_history_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS sync_history_from TIMESTAMPTZ DEFAULT NULL;