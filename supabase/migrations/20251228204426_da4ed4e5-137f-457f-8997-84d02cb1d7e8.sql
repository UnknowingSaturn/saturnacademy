-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create enums
CREATE TYPE public.trade_direction AS ENUM ('buy', 'sell');
CREATE TYPE public.event_type AS ENUM ('open', 'modify', 'partial_close', 'close');
CREATE TYPE public.account_type AS ENUM ('demo', 'live', 'prop');
CREATE TYPE public.prop_firm AS ENUM ('ftmo', 'fundednext', 'other');
CREATE TYPE public.session_type AS ENUM ('tokyo', 'london', 'new_york', 'overlap_london_ny', 'off_hours');
CREATE TYPE public.regime_type AS ENUM ('rotational', 'transitional');
CREATE TYPE public.news_risk AS ENUM ('none', 'low', 'high');
CREATE TYPE public.emotional_state AS ENUM ('great', 'good', 'calm', 'confident', 'focused', 'alright', 'okay', 'normal', 'rough', 'anxious', 'fomo', 'revenge', 'tilted', 'exhausted');
CREATE TYPE public.ai_provider AS ENUM ('openai', 'gemini', 'lovable');

-- Profiles table for user data
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Trigger to create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (new.id, new.email, COALESCE(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  RETURN new;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Trading Accounts table (multi-account ready)
CREATE TABLE public.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  broker TEXT,
  account_number TEXT,
  terminal_id TEXT,
  account_type public.account_type DEFAULT 'demo',
  prop_firm public.prop_firm,
  balance_start DECIMAL(15,2) DEFAULT 0,
  equity_current DECIMAL(15,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  api_key TEXT, -- For MT5 ingestion auth
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own accounts" ON public.accounts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own accounts" ON public.accounts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own accounts" ON public.accounts
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own accounts" ON public.accounts
  FOR DELETE USING (auth.uid() = user_id);

-- Events table (immutable, event-sourced)
CREATE TABLE public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT UNIQUE NOT NULL,
  account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE,
  terminal_id TEXT,
  event_type public.event_type NOT NULL,
  ticket BIGINT NOT NULL,
  symbol TEXT NOT NULL,
  direction public.trade_direction NOT NULL,
  lot_size DECIMAL(10,4) NOT NULL,
  price DECIMAL(20,10) NOT NULL,
  sl DECIMAL(20,10),
  tp DECIMAL(20,10),
  commission DECIMAL(15,4) DEFAULT 0,
  swap DECIMAL(15,4) DEFAULT 0,
  profit DECIMAL(15,4),
  event_timestamp TIMESTAMPTZ NOT NULL,
  raw_payload JSONB,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed BOOLEAN DEFAULT false
);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- Events accessed via account ownership
CREATE POLICY "Users can view events for their accounts" ON public.events
  FOR SELECT USING (
    account_id IN (SELECT id FROM public.accounts WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can insert events for their accounts" ON public.events
  FOR INSERT WITH CHECK (
    account_id IN (SELECT id FROM public.accounts WHERE user_id = auth.uid())
  );

-- Trades table (normalized summary)
CREATE TABLE public.trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  terminal_id TEXT,
  ticket BIGINT,
  symbol TEXT NOT NULL,
  direction public.trade_direction NOT NULL,
  total_lots DECIMAL(10,4) NOT NULL,
  entry_price DECIMAL(20,10) NOT NULL,
  entry_time TIMESTAMPTZ NOT NULL,
  exit_price DECIMAL(20,10),
  exit_time TIMESTAMPTZ,
  sl_initial DECIMAL(20,10),
  tp_initial DECIMAL(20,10),
  sl_final DECIMAL(20,10),
  tp_final DECIMAL(20,10),
  gross_pnl DECIMAL(15,4),
  commission DECIMAL(15,4) DEFAULT 0,
  swap DECIMAL(15,4) DEFAULT 0,
  net_pnl DECIMAL(15,4),
  r_multiple_planned DECIMAL(10,4),
  r_multiple_actual DECIMAL(10,4),
  session public.session_type,
  duration_seconds INTEGER,
  partial_closes JSONB DEFAULT '[]',
  is_open BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own trades" ON public.trades
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own trades" ON public.trades
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own trades" ON public.trades
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own trades" ON public.trades
  FOR DELETE USING (auth.uid() = user_id);

-- Playbooks table (strategy templates)
CREATE TABLE public.playbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  session_filter public.session_type[],
  symbol_filter TEXT[],
  checklist_questions JSONB NOT NULL DEFAULT '[]', -- Array of {id, question, order}
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.playbooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own playbooks" ON public.playbooks
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own playbooks" ON public.playbooks
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own playbooks" ON public.playbooks
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own playbooks" ON public.playbooks
  FOR DELETE USING (auth.uid() = user_id);

-- Trade Reviews table (playbook scoring + psychology)
CREATE TABLE public.trade_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id UUID NOT NULL REFERENCES public.trades(id) ON DELETE CASCADE,
  playbook_id UUID REFERENCES public.playbooks(id) ON DELETE SET NULL,
  checklist_answers JSONB DEFAULT '{}', -- {question_id: boolean}
  score INTEGER DEFAULT 0, -- 0-5 based on yes answers
  regime public.regime_type,
  news_risk public.news_risk DEFAULT 'none',
  emotional_state_before public.emotional_state,
  emotional_state_after public.emotional_state,
  psychology_notes TEXT,
  mistakes JSONB DEFAULT '[]', -- Array of strings
  did_well JSONB DEFAULT '[]',
  to_improve JSONB DEFAULT '[]',
  actionable_steps JSONB DEFAULT '[]', -- Array of {text, completed}
  thoughts TEXT,
  screenshots JSONB DEFAULT '[]', -- Array of URLs
  reviewed_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.trade_reviews ENABLE ROW LEVEL SECURITY;

-- Reviews accessed via trade ownership
CREATE POLICY "Users can view own trade reviews" ON public.trade_reviews
  FOR SELECT USING (
    trade_id IN (SELECT id FROM public.trades WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can create reviews for own trades" ON public.trade_reviews
  FOR INSERT WITH CHECK (
    trade_id IN (SELECT id FROM public.trades WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update own trade reviews" ON public.trade_reviews
  FOR UPDATE USING (
    trade_id IN (SELECT id FROM public.trades WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can delete own trade reviews" ON public.trade_reviews
  FOR DELETE USING (
    trade_id IN (SELECT id FROM public.trades WHERE user_id = auth.uid())
  );

-- Trade Comments table (threaded)
CREATE TABLE public.trade_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id UUID NOT NULL REFERENCES public.trades(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  screenshot_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.trade_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own trade comments" ON public.trade_comments
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own comments" ON public.trade_comments
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own comments" ON public.trade_comments
  FOR DELETE USING (auth.uid() = user_id);

-- AI Prompts table (provider-agnostic)
CREATE TABLE public.ai_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE, -- NULL = system default
  name TEXT NOT NULL,
  prompt_type TEXT NOT NULL, -- 'trade_analysis', 'weekly_summary', etc.
  provider public.ai_provider DEFAULT 'lovable',
  system_prompt TEXT NOT NULL,
  user_prompt_template TEXT,
  temperature DECIMAL(3,2) DEFAULT 0.7,
  max_tokens INTEGER DEFAULT 1000,
  is_active BOOLEAN DEFAULT true,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_prompts ENABLE ROW LEVEL SECURITY;

-- Users can view system prompts (user_id is null) and their own
CREATE POLICY "Users can view prompts" ON public.ai_prompts
  FOR SELECT USING (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "Users can create own prompts" ON public.ai_prompts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own prompts" ON public.ai_prompts
  FOR UPDATE USING (auth.uid() = user_id);

-- Prop Firm Rules table
CREATE TABLE public.prop_firm_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm public.prop_firm NOT NULL,
  rule_name TEXT NOT NULL,
  rule_type TEXT NOT NULL, -- 'daily_loss', 'max_drawdown', 'profit_target', 'min_days', etc.
  value DECIMAL(10,4) NOT NULL,
  is_percentage BOOLEAN DEFAULT true,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.prop_firm_rules ENABLE ROW LEVEL SECURITY;

-- Prop firm rules are public read
CREATE POLICY "Anyone can view prop firm rules" ON public.prop_firm_rules
  FOR SELECT USING (true);

-- Insert default FTMO and FundedNext rules
INSERT INTO public.prop_firm_rules (firm, rule_name, rule_type, value, is_percentage, description) VALUES
  ('ftmo', 'Daily Loss Limit', 'daily_loss', 5.00, true, 'Maximum 5% daily loss'),
  ('ftmo', 'Max Drawdown', 'max_drawdown', 10.00, true, 'Maximum 10% total drawdown'),
  ('ftmo', 'Profit Target', 'profit_target', 10.00, true, 'Reach 10% profit target'),
  ('ftmo', 'Minimum Trading Days', 'min_days', 4, false, 'Trade at least 4 days'),
  ('fundednext', 'Daily Loss Limit', 'daily_loss', 5.00, true, 'Maximum 5% daily loss'),
  ('fundednext', 'Max Drawdown', 'max_drawdown', 10.00, true, 'Maximum 10% total drawdown'),
  ('fundednext', 'Profit Target', 'profit_target', 10.00, true, 'Reach 10% profit target'),
  ('fundednext', 'Minimum Trading Days', 'min_days', 5, false, 'Trade at least 5 days'),
  ('fundednext', 'News Trading', 'news_restriction', 0, false, 'No trading 2 min before/after high impact news');

-- Create indexes for performance
CREATE INDEX idx_events_account ON public.events(account_id);
CREATE INDEX idx_events_ticket ON public.events(ticket);
CREATE INDEX idx_events_idempotency ON public.events(idempotency_key);
CREATE INDEX idx_trades_user ON public.trades(user_id);
CREATE INDEX idx_trades_account ON public.trades(account_id);
CREATE INDEX idx_trades_symbol ON public.trades(symbol);
CREATE INDEX idx_trades_session ON public.trades(session);
CREATE INDEX idx_trades_entry_time ON public.trades(entry_time);
CREATE INDEX idx_trade_reviews_trade ON public.trade_reviews(trade_id);
CREATE INDEX idx_playbooks_user ON public.playbooks(user_id);

-- Updated at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_accounts_updated_at BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_trades_updated_at BEFORE UPDATE ON public.trades
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_playbooks_updated_at BEFORE UPDATE ON public.playbooks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_trade_reviews_updated_at BEFORE UPDATE ON public.trade_reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_ai_prompts_updated_at BEFORE UPDATE ON public.ai_prompts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default AI prompts
INSERT INTO public.ai_prompts (user_id, name, prompt_type, provider, system_prompt, user_prompt_template) VALUES
(NULL, 'Trade Analysis', 'trade_analysis', 'lovable', 
'You are a trading coach with a blunt, analytical personality. No fluff. Give actionable feedback based on the structured data provided. Focus on what went wrong and provide a specific checklist for improvement. If rules were violated, call them out directly. Reference specific numbers and patterns.',
'Analyze this trade:
Trade: {{trade}}
Playbook: {{playbook_name}}
Checklist Score: {{score}}/5
Failed Questions: {{failed_questions}}
Regime: {{regime}}
News Risk: {{news_risk}}
Session: {{session}}
Emotional State: Before={{emotional_before}}, After={{emotional_after}}

Recent performance context:
- Last 10 trades win rate: {{recent_win_rate}}%
- This playbook''s average score: {{playbook_avg_score}}

Provide:
1. VERDICT (one line)
2. WHAT WENT WRONG (bullet points for each failed checklist item)
3. CHECKLIST FOR NEXT TRADE (3-5 actionable items)
4. PATTERN DETECTED (if any recurring issues)'),

(NULL, 'Weekly Summary', 'weekly_summary', 'lovable',
'You are a trading performance analyst. Provide a blunt, data-driven weekly summary. Focus on patterns, not individual trades. Identify the top 3 things to stop doing and top 3 things to keep doing. Be specific with numbers.',
'Weekly trading summary for {{date_range}}:

Performance:
- Total trades: {{total_trades}}
- Win rate: {{win_rate}}%
- Total R: {{total_r}}
- Best trade: {{best_trade_r}}R
- Worst trade: {{worst_trade_r}}R

By Session:
{{session_breakdown}}

By Playbook:
{{playbook_breakdown}}

Emotional patterns:
{{emotional_patterns}}

Checklist compliance:
- Average score: {{avg_score}}/5
- Most failed questions: {{most_failed}}

Provide:
1. OVERALL VERDICT
2. STOP DOING (max 3 items with specific data)
3. KEEP DOING (max 3 items with specific data)
4. FOCUS FOR NEXT WEEK (single priority)');