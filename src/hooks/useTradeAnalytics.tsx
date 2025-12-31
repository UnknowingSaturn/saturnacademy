import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { TradeAnalytics } from "@/types/analytics";

export function useTradeAnalytics(accountId?: string) {
  return useQuery({
    queryKey: ['trade-analytics', accountId],
    queryFn: async (): Promise<TradeAnalytics> => {
      const { data, error } = await supabase.functions.invoke('trade-analytics', {
        body: { account_id: accountId }
      });
      
      if (error) throw new Error(error.message);
      return data;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
  });
}
