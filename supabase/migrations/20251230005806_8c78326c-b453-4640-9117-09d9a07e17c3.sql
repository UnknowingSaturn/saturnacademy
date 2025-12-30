-- Create copier role enum type
CREATE TYPE public.copier_role AS ENUM ('independent', 'master', 'receiver');

-- Add copier-related columns to accounts table
ALTER TABLE public.accounts
ADD COLUMN copier_role public.copier_role DEFAULT 'independent',
ADD COLUMN master_account_id uuid REFERENCES public.accounts(id),
ADD COLUMN copier_enabled boolean DEFAULT false;

-- Index for quick lookup of receivers by master
CREATE INDEX idx_accounts_master ON public.accounts(master_account_id) WHERE master_account_id IS NOT NULL;

-- Store symbol mappings between master and receiver accounts
CREATE TABLE public.copier_symbol_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  master_account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  receiver_account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  master_symbol text NOT NULL,
  receiver_symbol text NOT NULL,
  is_enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(receiver_account_id, master_symbol)
);

-- Store risk and safety settings per receiver
CREATE TABLE public.copier_receiver_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE UNIQUE,
  
  -- Risk settings
  risk_mode text NOT NULL DEFAULT 'balance_multiplier' CHECK(risk_mode IN ('balance_multiplier', 'fixed_lot', 'risk_dollar', 'risk_percent', 'intent')),
  risk_value numeric NOT NULL DEFAULT 1.0,
  
  -- Safety settings
  max_slippage_pips numeric DEFAULT 3.0,
  max_daily_loss_r numeric DEFAULT 3.0,
  
  -- Session filters (stored as JSON array)
  allowed_sessions jsonb DEFAULT '["tokyo", "london", "new_york_am", "new_york_pm"]'::jsonb,
  
  -- Modes
  manual_confirm_mode boolean DEFAULT false,
  prop_firm_safe_mode boolean DEFAULT false,
  
  -- Polling settings
  poll_interval_ms integer DEFAULT 1000,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Track execution history for analytics
CREATE TABLE public.copier_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  master_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  receiver_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  
  idempotency_key text NOT NULL,
  master_position_id bigint,
  receiver_position_id bigint,
  
  event_type text NOT NULL,
  symbol text NOT NULL,
  direction text NOT NULL,
  
  master_lots numeric,
  receiver_lots numeric,
  master_price numeric,
  executed_price numeric,
  slippage_pips numeric,
  
  status text NOT NULL CHECK(status IN ('success', 'failed', 'skipped')),
  error_message text,
  
  executed_at timestamptz DEFAULT now(),
  UNIQUE(receiver_account_id, idempotency_key)
);

-- Config version tracking for update detection
CREATE TABLE public.copier_config_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  config_hash text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS on all new tables
ALTER TABLE public.copier_symbol_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copier_receiver_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copier_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copier_config_versions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for copier_symbol_mappings
CREATE POLICY "Users can view own symbol mappings" ON public.copier_symbol_mappings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own symbol mappings" ON public.copier_symbol_mappings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own symbol mappings" ON public.copier_symbol_mappings
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own symbol mappings" ON public.copier_symbol_mappings
  FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for copier_receiver_settings
CREATE POLICY "Users can view own receiver settings" ON public.copier_receiver_settings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own receiver settings" ON public.copier_receiver_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own receiver settings" ON public.copier_receiver_settings
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own receiver settings" ON public.copier_receiver_settings
  FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for copier_executions
CREATE POLICY "Users can view own executions" ON public.copier_executions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own executions" ON public.copier_executions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own executions" ON public.copier_executions
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own executions" ON public.copier_executions
  FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for copier_config_versions
CREATE POLICY "Users can view own config versions" ON public.copier_config_versions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own config versions" ON public.copier_config_versions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own config versions" ON public.copier_config_versions
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own config versions" ON public.copier_config_versions
  FOR DELETE USING (auth.uid() = user_id);

-- Enable realtime for executions (for live dashboard updates)
ALTER PUBLICATION supabase_realtime ADD TABLE public.copier_executions;