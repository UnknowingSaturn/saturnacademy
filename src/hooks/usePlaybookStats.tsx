import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Trade } from '@/types/trading';

export interface PlaybookStats {
  playbookId: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgR: number;
  totalPnl: number;
  profitFactor: number;
  todayTrades: number;
  todayPnl: number;
}

export function usePlaybookStats() {
  return useQuery({
    queryKey: ['playbook-stats'],
    queryFn: async (): Promise<Record<string, PlaybookStats>> => {
      // Get all trades with their reviews (which contain playbook_id)
      const { data: trades, error: tradesError } = await supabase
        .from('trades')
        .select(`
          id,
          net_pnl,
          r_multiple_actual,
          entry_time,
          is_open,
          trade_reviews (
            playbook_id
          )
        `)
        .eq('is_open', false);

      if (tradesError) throw tradesError;

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const statsByPlaybook: Record<string, PlaybookStats> = {};

      for (const trade of trades || []) {
        const reviews = trade.trade_reviews as { playbook_id: string | null }[] | null;
        const playbookId = reviews?.[0]?.playbook_id;
        
        if (!playbookId) continue;

        if (!statsByPlaybook[playbookId]) {
          statsByPlaybook[playbookId] = {
            playbookId,
            totalTrades: 0,
            wins: 0,
            losses: 0,
            winRate: 0,
            avgR: 0,
            totalPnl: 0,
            profitFactor: 0,
            todayTrades: 0,
            todayPnl: 0,
          };
        }

        const stats = statsByPlaybook[playbookId];
        const pnl = Number(trade.net_pnl) || 0;
        const rMultiple = Number(trade.r_multiple_actual) || 0;
        const tradeDate = new Date(trade.entry_time);
        const isToday = tradeDate >= today;

        stats.totalTrades++;
        stats.totalPnl += pnl;

        if (pnl > 0) {
          stats.wins++;
        } else if (pnl < 0) {
          stats.losses++;
        }

        if (isToday) {
          stats.todayTrades++;
          stats.todayPnl += pnl;
        }
      }

      // Calculate derived metrics
      for (const playbookId of Object.keys(statsByPlaybook)) {
        const stats = statsByPlaybook[playbookId];
        
        stats.winRate = stats.totalTrades > 0 
          ? (stats.wins / stats.totalTrades) * 100 
          : 0;
        
        // Calculate avgR from trades
        const playbookTrades = (trades || []).filter(t => {
          const reviews = t.trade_reviews as { playbook_id: string | null }[] | null;
          return reviews?.[0]?.playbook_id === playbookId;
        });
        
        const totalR = playbookTrades.reduce((sum, t) => sum + (Number(t.r_multiple_actual) || 0), 0);
        stats.avgR = playbookTrades.length > 0 ? totalR / playbookTrades.length : 0;
        
        // Profit factor
        const grossProfit = playbookTrades
          .filter(t => (Number(t.net_pnl) || 0) > 0)
          .reduce((sum, t) => sum + (Number(t.net_pnl) || 0), 0);
        const grossLoss = Math.abs(playbookTrades
          .filter(t => (Number(t.net_pnl) || 0) < 0)
          .reduce((sum, t) => sum + (Number(t.net_pnl) || 0), 0));
        
        stats.profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
      }

      return statsByPlaybook;
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });
}

export function usePlaybookStat(playbookId: string | undefined) {
  const { data: allStats, ...rest } = usePlaybookStats();
  
  return {
    ...rest,
    data: playbookId && allStats ? allStats[playbookId] : undefined,
  };
}
