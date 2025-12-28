-- Phase 1: Enhanced Data Model for Post-Trade AI Analysis System

-- 1.1 Extend playbooks table with strategy rules
ALTER TABLE public.playbooks 
ADD COLUMN IF NOT EXISTS valid_regimes text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS entry_zone_rules jsonb DEFAULT '{}',
ADD COLUMN IF NOT EXISTS confirmation_rules text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS invalidation_rules text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS management_rules text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS failure_modes text[] DEFAULT '{}';

-- 1.2 Create trade_features table for computed features
CREATE TABLE public.trade_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL REFERENCES public.trades(id) ON DELETE CASCADE UNIQUE,
  -- Context Features
  day_of_week integer,
  time_since_session_open_mins integer,
  volatility_regime text CHECK (volatility_regime IN ('low', 'normal', 'high')),
  -- Setup Geometry
  range_size_pips numeric,
  entry_percentile numeric CHECK (entry_percentile >= 0 AND entry_percentile <= 100),
  distance_to_mean_pips numeric,
  htf_bias text CHECK (htf_bias IN ('bull', 'bear', 'neutral')),
  -- Execution Quality
  entry_efficiency numeric CHECK (entry_efficiency >= 0 AND entry_efficiency <= 100),
  exit_efficiency numeric CHECK (exit_efficiency >= 0 AND exit_efficiency <= 100),
  stop_location_quality numeric CHECK (stop_location_quality >= 0 AND stop_location_quality <= 100),
  -- Timestamp
  computed_at timestamptz DEFAULT now()
);

-- Enable RLS on trade_features
ALTER TABLE public.trade_features ENABLE ROW LEVEL SECURITY;

-- RLS policies for trade_features (access via trades ownership)
CREATE POLICY "Users can view features for own trades"
ON public.trade_features FOR SELECT
USING (trade_id IN (SELECT id FROM public.trades WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert features for own trades"
ON public.trade_features FOR INSERT
WITH CHECK (trade_id IN (SELECT id FROM public.trades WHERE user_id = auth.uid()));

CREATE POLICY "Users can update features for own trades"
ON public.trade_features FOR UPDATE
USING (trade_id IN (SELECT id FROM public.trades WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete features for own trades"
ON public.trade_features FOR DELETE
USING (trade_id IN (SELECT id FROM public.trades WHERE user_id = auth.uid()));

-- 1.3 Create ai_reviews table for structured AI output
CREATE TABLE public.ai_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL REFERENCES public.trades(id) ON DELETE CASCADE,
  -- Structured AI Output
  technical_review jsonb DEFAULT '{}',
  mistake_attribution jsonb DEFAULT '{}',
  psychology_analysis jsonb DEFAULT '{}',
  comparison_to_past jsonb DEFAULT '{}',
  actionable_guidance jsonb DEFAULT '{}',
  confidence text CHECK (confidence IN ('low', 'medium', 'high')),
  -- Deterministic Scores (computed before AI)
  setup_compliance_score integer CHECK (setup_compliance_score >= 0 AND setup_compliance_score <= 100),
  rule_violations text[] DEFAULT '{}',
  context_alignment_score integer CHECK (context_alignment_score >= 0 AND context_alignment_score <= 100),
  -- Similar trades used for context
  similar_winners uuid[] DEFAULT '{}',
  similar_losers uuid[] DEFAULT '{}',
  -- Raw response for debugging
  raw_analysis text,
  -- Timestamps
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS on ai_reviews
ALTER TABLE public.ai_reviews ENABLE ROW LEVEL SECURITY;

-- RLS policies for ai_reviews
CREATE POLICY "Users can view AI reviews for own trades"
ON public.ai_reviews FOR SELECT
USING (trade_id IN (SELECT id FROM public.trades WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert AI reviews for own trades"
ON public.ai_reviews FOR INSERT
WITH CHECK (trade_id IN (SELECT id FROM public.trades WHERE user_id = auth.uid()));

CREATE POLICY "Users can update AI reviews for own trades"
ON public.ai_reviews FOR UPDATE
USING (trade_id IN (SELECT id FROM public.trades WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete AI reviews for own trades"
ON public.ai_reviews FOR DELETE
USING (trade_id IN (SELECT id FROM public.trades WHERE user_id = auth.uid()));

-- Trigger for updated_at on ai_reviews
CREATE TRIGGER update_ai_reviews_updated_at
BEFORE UPDATE ON public.ai_reviews
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- 1.4 Create ai_feedback table for learning loop
CREATE TABLE public.ai_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_review_id uuid NOT NULL REFERENCES public.ai_reviews(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  is_accurate boolean,
  is_useful boolean,
  feedback_notes text,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS on ai_feedback
ALTER TABLE public.ai_feedback ENABLE ROW LEVEL SECURITY;

-- RLS policies for ai_feedback
CREATE POLICY "Users can view own AI feedback"
ON public.ai_feedback FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Users can insert own AI feedback"
ON public.ai_feedback FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own AI feedback"
ON public.ai_feedback FOR UPDATE
USING (user_id = auth.uid());

CREATE POLICY "Users can delete own AI feedback"
ON public.ai_feedback FOR DELETE
USING (user_id = auth.uid());

-- Create indexes for performance
CREATE INDEX idx_trade_features_trade_id ON public.trade_features(trade_id);
CREATE INDEX idx_ai_reviews_trade_id ON public.ai_reviews(trade_id);
CREATE INDEX idx_ai_reviews_created_at ON public.ai_reviews(created_at DESC);
CREATE INDEX idx_ai_feedback_ai_review_id ON public.ai_feedback(ai_review_id);