-- Phase 4: add has_trade_access(uuid) SECURITY DEFINER helper.
-- This replaces the repeated `trade_id IN (SELECT id FROM trades WHERE user_id = auth.uid())`
-- subqueries that appear in RLS policies on trade_features, trade_reviews, etc.
-- Policies aren't rewritten in this migration (to avoid surprise behavior changes);
-- new policies can adopt it immediately.
CREATE OR REPLACE FUNCTION public.has_trade_access(_trade_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.trades
    WHERE id = _trade_id
      AND user_id = auth.uid()
  )
$$;

GRANT EXECUTE ON FUNCTION public.has_trade_access(uuid) TO authenticated;