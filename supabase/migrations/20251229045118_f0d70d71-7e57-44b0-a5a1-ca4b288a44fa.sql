-- Add color column to playbooks table
ALTER TABLE public.playbooks 
ADD COLUMN color TEXT DEFAULT '#6366f1';