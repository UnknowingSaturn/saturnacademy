import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Trade, Account } from "@/types/trading";
import { toast } from "sonner";

export interface TradeGroup {
  id: string;
  symbol: string;
  direction: "buy" | "sell";
  first_entry_time: string;
  playbook_id: string | null;
  name: string | null;
  // Aggregated data
  trades: Trade[];
  combined_net_pnl: number;
  combined_r_multiple: number | null;
  account_ids: string[];
  is_open: boolean;
}

// Transform raw group data with trades into TradeGroup
function transformTradeGroup(
  group: any,
  trades: Trade[]
): TradeGroup {
  const groupTrades = trades.filter(t => t.trade_group_id === group.id);
  
  const combinedNetPnl = groupTrades.reduce((sum, t) => sum + (t.net_pnl || 0), 0);
  
  // Calculate weighted average R-multiple
  const tradesWithR = groupTrades.filter(t => t.r_multiple_actual !== null);
  const combinedR = tradesWithR.length > 0
    ? tradesWithR.reduce((sum, t) => sum + (t.r_multiple_actual || 0), 0) / tradesWithR.length
    : null;
  
  const accountIds = [...new Set(groupTrades.map(t => t.account_id).filter(Boolean))] as string[];
  const isOpen = groupTrades.some(t => t.is_open);

  return {
    id: group.id,
    symbol: group.symbol,
    direction: group.direction,
    first_entry_time: group.first_entry_time,
    playbook_id: group.playbook_id,
    name: group.name,
    trades: groupTrades,
    combined_net_pnl: combinedNetPnl,
    combined_r_multiple: combinedR,
    account_ids: accountIds,
    is_open: isOpen,
  };
}

export function useTradeGroups() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["trade-groups", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      // Fetch all trade groups
      const { data: groups, error: groupsError } = await supabase
        .from("trade_groups")
        .select("*")
        .eq("user_id", user.id)
        .order("first_entry_time", { ascending: false });

      if (groupsError) throw groupsError;

      // Fetch all grouped trades
      const { data: trades, error: tradesError } = await supabase
        .from("trades")
        .select(`
          *,
          account:accounts(*),
          playbook:playbooks(*),
          review:trade_reviews(*)
        `)
        .eq("user_id", user.id)
        .not("trade_group_id", "is", null)
        .eq("is_archived", false);

      if (tradesError) throw tradesError;

      // Transform trades
      const transformedTrades = (trades || []).map((row: any) => ({
        ...row,
        review: row.review?.[0] || null,
        trade_group_id: row.trade_group_id,
      }));

      // Transform groups with their trades
      return (groups || []).map((group: any) => 
        transformTradeGroup(group, transformedTrades)
      ).filter(g => g.trades.length > 0); // Only return groups with trades
    },
    enabled: !!user?.id,
  });
}

// Get ungrouped trades (trades without a trade_group_id)
export function useUngroupedTrades() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["ungrouped-trades", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      const { data, error } = await supabase
        .from("trades")
        .select(`
          *,
          account:accounts(*),
          playbook:playbooks(*),
          review:trade_reviews(*)
        `)
        .eq("user_id", user.id)
        .is("trade_group_id", null)
        .eq("is_archived", false)
        .order("entry_time", { ascending: false });

      if (error) throw error;

      return (data || []).map((row: any) => ({
        ...row,
        review: row.review?.[0] || null,
      }));
    },
    enabled: !!user?.id,
  });
}

// Combined hook that returns both grouped and ungrouped trades
export function useGroupedTradesView() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["grouped-trades-view", user?.id],
    queryFn: async () => {
      if (!user?.id) return { groups: [], ungrouped: [] };

      // Fetch all non-archived trades with their groups
      const { data: allTrades, error: tradesError } = await supabase
        .from("trades")
        .select(`
          *,
          account:accounts(*),
          playbook:playbooks(*),
          review:trade_reviews(*)
        `)
        .eq("user_id", user.id)
        .eq("is_archived", false)
        .order("entry_time", { ascending: false });

      if (tradesError) throw tradesError;

      // Fetch all trade groups
      const { data: groups, error: groupsError } = await supabase
        .from("trade_groups")
        .select("*")
        .eq("user_id", user.id)
        .order("first_entry_time", { ascending: false });

      if (groupsError) throw groupsError;

      // Transform trades
      const transformedTrades = (allTrades || []).map((row: any) => ({
        ...row,
        review: row.review?.[0] || null,
        trade_group_id: row.trade_group_id,
      }));

      // Separate grouped and ungrouped
      const ungrouped = transformedTrades.filter(t => !t.trade_group_id);
      
      // Transform groups with their trades
      const groupedItems = (groups || [])
        .map((group: any) => transformTradeGroup(group, transformedTrades))
        .filter(g => g.trades.length > 0);

      return {
        groups: groupedItems,
        ungrouped: ungrouped as Trade[],
      };
    },
    enabled: !!user?.id,
  });
}

// Trigger auto-grouping for all trades
export function useAutoGroupTrades() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (windowSeconds: number = 60) => {
      if (!user?.id) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke("auto-group-trades", {
        body: { user_id: user.id, window_seconds: windowSeconds },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["trade-groups"] });
      queryClient.invalidateQueries({ queryKey: ["ungrouped-trades"] });
      queryClient.invalidateQueries({ queryKey: ["grouped-trades-view"] });
      queryClient.invalidateQueries({ queryKey: ["trades"] });
      toast.success(`Grouped ${data.trades_grouped} trades into ${data.groups_created} new groups`);
    },
    onError: (error) => {
      console.error("Auto-group error:", error);
      toast.error("Failed to auto-group trades");
    },
  });
}

// Ungroup trades (remove from group)
export function useUngroupTrades() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (tradeIds: string[]) => {
      const { error } = await supabase
        .from("trades")
        .update({ trade_group_id: null })
        .in("id", tradeIds);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trade-groups"] });
      queryClient.invalidateQueries({ queryKey: ["ungrouped-trades"] });
      queryClient.invalidateQueries({ queryKey: ["grouped-trades-view"] });
      queryClient.invalidateQueries({ queryKey: ["trades"] });
      toast.success("Trades ungrouped");
    },
    onError: (error) => {
      console.error("Ungroup error:", error);
      toast.error("Failed to ungroup trades");
    },
  });
}
