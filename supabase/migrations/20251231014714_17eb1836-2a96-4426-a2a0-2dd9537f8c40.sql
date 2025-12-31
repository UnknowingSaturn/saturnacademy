-- Remove trade grouping feature completely

-- 1. Drop the foreign key constraint first
ALTER TABLE public.trades DROP CONSTRAINT IF EXISTS trades_trade_group_id_fkey;

-- 2. Drop the trade_group_id column from trades
ALTER TABLE public.trades DROP COLUMN IF EXISTS trade_group_id;

-- 3. Drop the trade_groups table (RLS policies will be dropped automatically)
DROP TABLE IF EXISTS public.trade_groups;