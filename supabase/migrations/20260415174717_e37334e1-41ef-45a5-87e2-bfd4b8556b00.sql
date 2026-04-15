
CREATE TABLE public.simulation_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  playbook_id UUID REFERENCES public.playbooks(id) ON DELETE SET NULL,
  strategy_id UUID REFERENCES public.generated_strategies(id) ON DELETE SET NULL,
  alpha_code TEXT NOT NULL DEFAULT '',
  parameters JSONB DEFAULT '{}'::jsonb,
  results JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'running',
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.simulation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own simulation runs"
ON public.simulation_runs FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own simulation runs"
ON public.simulation_runs FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own simulation runs"
ON public.simulation_runs FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own simulation runs"
ON public.simulation_runs FOR DELETE
USING (auth.uid() = user_id);
