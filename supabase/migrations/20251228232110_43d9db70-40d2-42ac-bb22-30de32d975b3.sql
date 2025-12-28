-- Add original_lots column to preserve original position size before partial closes
ALTER TABLE public.trades
ADD COLUMN original_lots numeric;