-- Add journal_conversation column to trade_reviews for persisting chat history
ALTER TABLE public.trade_reviews 
ADD COLUMN IF NOT EXISTS journal_conversation JSONB DEFAULT NULL;