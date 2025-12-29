-- Add unique constraint on ai_reviews.trade_id for upsert operations to work correctly
ALTER TABLE public.ai_reviews ADD CONSTRAINT ai_reviews_trade_id_unique UNIQUE (trade_id);