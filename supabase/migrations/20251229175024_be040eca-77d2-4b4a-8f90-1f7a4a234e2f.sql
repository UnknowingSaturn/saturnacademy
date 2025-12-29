-- Add is_archived column to trades table
ALTER TABLE public.trades ADD COLUMN is_archived BOOLEAN DEFAULT false;

-- Create index for faster filtering
CREATE INDEX idx_trades_is_archived ON public.trades(is_archived);

-- Add archived_at timestamp to track when it was archived
ALTER TABLE public.trades ADD COLUMN archived_at TIMESTAMP WITH TIME ZONE;