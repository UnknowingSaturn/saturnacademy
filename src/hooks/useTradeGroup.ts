// Load a trade together with all its sibling legs (rows sharing group_key).
// Returns an aggregated view for headline metrics plus the individual legs.
// For non-grouped trades the hook is a passthrough that mirrors useTrade.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { transformTrade } from "@/lib/tradeTransform";
import { TRADE_SELECT } from "./_shared/tradeQueries";
import { useTrade } from "./useTrades";
import { groupTrades, type GroupedTrade } from "./useGroupedTrades";
import type { Trade } from "@/types/trading";

export interface TradeGroupResult {
  leader: Trade;
  legs: Trade[];
  aggregate: GroupedTrade;
  isGroup: boolean;
}

export function useTradeGroup(tradeId: string | undefined) {
  const { data: base, isLoading: isLoadingBase } = useTrade(tradeId);
  const groupKey = base?.group_key ?? null;

  const siblingsQuery = useQuery({
    queryKey: ["trade-group", groupKey, base?.user_id],
    enabled: !!groupKey && !!base?.user_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trades")
        .select(TRADE_SELECT)
        .eq("user_id", base!.user_id)
        .eq("group_key", groupKey!)
        .order("entry_time", { ascending: true });
      if (error) throw error;
      return (data ?? []).map(transformTrade);
    },
  });

  const isLoading = isLoadingBase || (!!groupKey && siblingsQuery.isLoading);

  if (!base) {
    return { data: null as TradeGroupResult | null, isLoading };
  }

  let legs: Trade[] = [base];
  if (groupKey && siblingsQuery.data && siblingsQuery.data.length > 0) {
    legs = siblingsQuery.data;
  }

  const aggregate = groupTrades(legs)[0];
  const leader = legs.find((l) => l.group_role === "leader") ?? legs[0] ?? base;

  const result: TradeGroupResult = {
    leader,
    legs,
    aggregate,
    isGroup: legs.length > 1,
  };
  return { data: result, isLoading };
}
