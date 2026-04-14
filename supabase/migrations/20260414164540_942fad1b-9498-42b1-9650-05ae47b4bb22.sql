
-- Create generated_strategies table for Code Lab EA versions
CREATE TABLE public.generated_strategies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  playbook_id UUID REFERENCES public.playbooks(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT 'Untitled Strategy',
  version INTEGER NOT NULL DEFAULT 1,
  mql5_code TEXT NOT NULL DEFAULT '',
  parameters JSONB DEFAULT '{}'::jsonb,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.generated_strategies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own strategies" ON public.generated_strategies FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own strategies" ON public.generated_strategies FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own strategies" ON public.generated_strategies FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own strategies" ON public.generated_strategies FOR DELETE USING (auth.uid() = user_id);

-- Create backtest_results table
CREATE TABLE public.backtest_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  strategy_id UUID REFERENCES public.generated_strategies(id) ON DELETE SET NULL,
  playbook_id UUID REFERENCES public.playbooks(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT 'Untitled Backtest',
  metrics JSONB DEFAULT '{}'::jsonb,
  equity_curve JSONB DEFAULT '[]'::jsonb,
  report_html TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.backtest_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own backtest results" ON public.backtest_results FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own backtest results" ON public.backtest_results FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own backtest results" ON public.backtest_results FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own backtest results" ON public.backtest_results FOR DELETE USING (auth.uid() = user_id);
