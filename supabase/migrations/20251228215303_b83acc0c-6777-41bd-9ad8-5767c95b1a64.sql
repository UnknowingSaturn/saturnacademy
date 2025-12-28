-- Add new columns to trades table for Notion-style journal
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS alignment TEXT[];
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS entry_timeframes TEXT[];
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS profile TEXT;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS place TEXT;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS trade_number INTEGER;

-- Create a function to auto-increment trade_number per user
CREATE OR REPLACE FUNCTION public.set_trade_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.trade_number IS NULL THEN
    SELECT COALESCE(MAX(trade_number), 0) + 1 INTO NEW.trade_number
    FROM public.trades
    WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for auto trade number
DROP TRIGGER IF EXISTS set_trade_number_trigger ON public.trades;
CREATE TRIGGER set_trade_number_trigger
BEFORE INSERT ON public.trades
FOR EACH ROW
EXECUTE FUNCTION public.set_trade_number();