-- Add live-mode columns to shared_reports
ALTER TABLE public.shared_reports
  ADD COLUMN IF NOT EXISTS live_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS live_started_at timestamptz NULL;

-- Trigger: maintain live_started_at automatically when live_mode flips
CREATE OR REPLACE FUNCTION public.shared_reports_sync_live_started_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.live_mode IS DISTINCT FROM OLD.live_mode THEN
    IF NEW.live_mode = true AND NEW.live_started_at IS NULL THEN
      NEW.live_started_at := now();
    ELSIF NEW.live_mode = false THEN
      NEW.live_started_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shared_reports_sync_live_started_at ON public.shared_reports;
CREATE TRIGGER shared_reports_sync_live_started_at
  BEFORE UPDATE ON public.shared_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.shared_reports_sync_live_started_at();

-- Also stamp live_started_at on INSERT if the row is created already-live
CREATE OR REPLACE FUNCTION public.shared_reports_init_live_started_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.live_mode = true AND NEW.live_started_at IS NULL THEN
    NEW.live_started_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shared_reports_init_live_started_at ON public.shared_reports;
CREATE TRIGGER shared_reports_init_live_started_at
  BEFORE INSERT ON public.shared_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.shared_reports_init_live_started_at();