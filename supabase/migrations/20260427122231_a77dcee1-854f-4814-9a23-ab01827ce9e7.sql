ALTER TABLE public.shared_reports
  ADD COLUMN IF NOT EXISTS auto_title boolean NOT NULL DEFAULT true;