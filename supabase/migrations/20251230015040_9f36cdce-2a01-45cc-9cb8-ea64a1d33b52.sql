-- Add user_id column to ai_reviews for simpler RLS and better performance
ALTER TABLE public.ai_reviews ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);

-- Backfill user_id from trades table
UPDATE public.ai_reviews ar
SET user_id = t.user_id
FROM trades t
WHERE ar.trade_id = t.id AND ar.user_id IS NULL;

-- Create unique constraint on trade_id to ensure one review per trade
CREATE UNIQUE INDEX IF NOT EXISTS ai_reviews_trade_id_unique ON public.ai_reviews(trade_id);

-- Drop existing RLS policies
DROP POLICY IF EXISTS "Users can view AI reviews for own trades" ON public.ai_reviews;
DROP POLICY IF EXISTS "Users can insert AI reviews for own trades" ON public.ai_reviews;
DROP POLICY IF EXISTS "Users can update AI reviews for own trades" ON public.ai_reviews;
DROP POLICY IF EXISTS "Users can delete AI reviews for own trades" ON public.ai_reviews;

-- Create new simpler RLS policies using user_id directly
CREATE POLICY "Users can view own AI reviews" ON public.ai_reviews
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert own AI reviews" ON public.ai_reviews
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own AI reviews" ON public.ai_reviews
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Users can delete own AI reviews" ON public.ai_reviews
  FOR DELETE USING (user_id = auth.uid());