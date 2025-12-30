-- Create trade_type enum
CREATE TYPE public.trade_type AS ENUM ('executed', 'idea', 'paper', 'missed');

-- Add trade_type column with default 'executed' for existing trades
ALTER TABLE public.trades 
ADD COLUMN trade_type public.trade_type NOT NULL DEFAULT 'executed';