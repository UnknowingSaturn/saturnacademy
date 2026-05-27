import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Trade, Playbook } from "@/types/trading";
import { usePlaybooks } from "./usePlaybooks";
import { detectSessionFromBrokerTime } from "@/lib/time";
import { transformTrade } from "@/lib/tradeTransform";

export interface OpenTradeWithCompliance extends Trade {
  matchedPlaybook?: Playbook;
  complianceStatus: 'pending' | 'compliant' | 'violations';
  detectedSession?: string;
}


export function useOpenTrades() {
  const { data: playbooks = [] } = usePlaybooks();
  const queryClient = useQueryClient();

  // Subscribe to realtime updates for open trades
  useEffect(() => {
    const channel = supabase
      .channel('open-trades-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'trades',
        },
        (payload) => {
          // Only invalidate if the trade is open or just became closed
          const newRecord = payload.new as { is_open?: boolean } | undefined;
          const oldRecord = payload.old as { is_open?: boolean } | undefined;
          
          if (newRecord?.is_open || oldRecord?.is_open) {
            queryClient.invalidateQueries({ queryKey: ['open-trades'] });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return useQuery<OpenTradeWithCompliance[]>({
    queryKey: ["open-trades"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trades")
        .select(`
          *,
          playbook:playbooks!trades_playbook_id_fkey (*),
          actual_playbook:playbooks!trades_actual_playbook_id_fkey (id, name, color),
          trade_reviews(*),
          accounts(*),
          trade_partial_fills(*),
          trade_repair_events(*)
        `)
        .eq("is_open", true)
        .eq("is_archived", false)
        .order("entry_time", { ascending: false });

      if (error) throw error;

      const trades = (data || []).map(transformTrade);
      
      // Enrich with playbook matching and session detection
      return trades.map((trade): OpenTradeWithCompliance => {
        // Find matched playbook by playbook_id (or from joined data)
        const matchedPlaybook = trade.playbook 
          || (trade.playbook_id ? playbooks.find(p => p.id === trade.playbook_id) : undefined);

        // Detect session using broker time offset
        const brokerOffset = trade.account?.broker_utc_offset ?? 0;
        const detectedSession = detectSessionFromBrokerTime(trade.entry_time, brokerOffset);

        // Determine compliance status
        let complianceStatus: 'pending' | 'compliant' | 'violations' = 'pending';
        
        if (!matchedPlaybook) {
          complianceStatus = 'pending'; // No model selected yet
        } else {
          // Check auto-verified rules
          const violations: string[] = [];
          
          // Session filter check - use detected session from broker time
          if (matchedPlaybook.session_filter && matchedPlaybook.session_filter.length > 0) {
            if (!matchedPlaybook.session_filter.includes(detectedSession)) {
              violations.push('session');
            }
          }
          
          // Symbol filter check
          if (matchedPlaybook.symbol_filter && matchedPlaybook.symbol_filter.length > 0) {
            const normalizedSymbol = trade.symbol.replace(/[^A-Za-z]/g, '').toUpperCase();
            const symbolMatch = matchedPlaybook.symbol_filter.some(s => 
              normalizedSymbol.includes(s.replace(/[^A-Za-z]/g, '').toUpperCase())
            );
            if (!symbolMatch) {
              violations.push('symbol');
            }
          }

          complianceStatus = violations.length > 0 ? 'violations' : 'compliant';
        }

        return {
          ...trade,
          matchedPlaybook,
          complianceStatus,
          detectedSession,
        };
      });
    },
    refetchInterval: 15000, // 15s for faster stale-trade detection
  });
}

export function useOpenTradesCount() {
  const { data: trades = [] } = useOpenTrades();
  return trades.length;
}
