import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PatternMiningResult } from "@/types/trading";

export function usePatternInsights(accountId?: string) {
  return useQuery({
    queryKey: ['pattern-insights', accountId],
    queryFn: async (): Promise<PatternMiningResult> => {
      const { data, error } = await supabase.functions.invoke('mine-trade-patterns', {
        body: { account_id: accountId, min_trades: 3 }
      });
      
      if (error) throw new Error(error.message);
      return data;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
  });
}
