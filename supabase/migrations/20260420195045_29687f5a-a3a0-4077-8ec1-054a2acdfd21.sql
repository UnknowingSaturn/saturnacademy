-- Reports table: stores generated weekly/monthly/custom trading reports
CREATE TABLE public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  account_id UUID,
  report_type TEXT NOT NULL CHECK (report_type IN ('weekly', 'monthly', 'custom')),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  edge_clusters JSONB NOT NULL DEFAULT '[]'::jsonb,
  leak_clusters JSONB NOT NULL DEFAULT '[]'::jsonb,
  consistency JSONB NOT NULL DEFAULT '{}'::jsonb,
  psychology JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  sensei_notes JSONB,
  sensei_model TEXT,
  
  schema_suggestions JSONB DEFAULT '[]'::jsonb,
  goals JSONB DEFAULT '[]'::jsonb,
  prior_goals_evaluation JSONB,
  
  verdict TEXT,
  grade TEXT,
  
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('generating', 'completed', 'failed')),
  error_message TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reports_user_period ON public.reports(user_id, period_start DESC);
CREATE INDEX idx_reports_user_type ON public.reports(user_id, report_type, period_start DESC);

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own reports"
  ON public.reports FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own reports"
  ON public.reports FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own reports"
  ON public.reports FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own reports"
  ON public.reports FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_reports_updated_at
  BEFORE UPDATE ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Idempotency table for scheduled report generation
CREATE TABLE public.report_schedule_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  report_type TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL,
  report_id UUID,
  error_message TEXT,
  UNIQUE (user_id, report_type, period_start)
);

CREATE INDEX idx_report_schedule_runs_user ON public.report_schedule_runs(user_id, attempted_at DESC);

ALTER TABLE public.report_schedule_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own schedule runs"
  ON public.report_schedule_runs FOR SELECT
  USING (auth.uid() = user_id);

-- Enable extensions for cron scheduling
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;