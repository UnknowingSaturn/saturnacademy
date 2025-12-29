-- Add equity_at_entry column to trades table
-- This stores the account equity at the time the trade was opened
-- Used for more accurate R% calculation (equity-based vs balance-based)

ALTER TABLE public.trades 
ADD COLUMN equity_at_entry NUMERIC;

-- Add comment explaining the column
COMMENT ON COLUMN public.trades.equity_at_entry IS 'Account equity at trade entry time. Used for R% calculation. Falls back to balance_at_entry if null.';