-- Add balance_at_entry column to trades table for accurate R% calculation
ALTER TABLE public.trades 
ADD COLUMN balance_at_entry numeric NULL;