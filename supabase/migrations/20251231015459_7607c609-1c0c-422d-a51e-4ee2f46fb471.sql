-- Add screenshots column to playbooks table
ALTER TABLE public.playbooks
ADD COLUMN screenshots jsonb DEFAULT '[]'::jsonb;