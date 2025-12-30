-- Create trade_groups table for grouping related trades across accounts
CREATE TABLE public.trade_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text,
  playbook_id uuid REFERENCES public.playbooks(id) ON DELETE SET NULL,
  symbol text NOT NULL,
  direction public.trade_direction NOT NULL,
  first_entry_time timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add trade_group_id to trades table
ALTER TABLE public.trades ADD COLUMN trade_group_id uuid REFERENCES public.trade_groups(id) ON DELETE SET NULL;

-- Enable RLS on trade_groups
ALTER TABLE public.trade_groups ENABLE ROW LEVEL SECURITY;

-- RLS policies for trade_groups
CREATE POLICY "Users can view own trade groups"
  ON public.trade_groups FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own trade groups"
  ON public.trade_groups FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own trade groups"
  ON public.trade_groups FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own trade groups"
  ON public.trade_groups FOR DELETE
  USING (auth.uid() = user_id);

-- Create index for faster lookups
CREATE INDEX idx_trades_trade_group_id ON public.trades(trade_group_id);
CREATE INDEX idx_trade_groups_user_id ON public.trade_groups(user_id);
CREATE INDEX idx_trade_groups_symbol_direction ON public.trade_groups(symbol, direction);

-- Create trigger for updating updated_at
CREATE TRIGGER update_trade_groups_updated_at
  BEFORE UPDATE ON public.trade_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();