import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { usePlaybooks } from './usePlaybooks';

export interface PlaybookStats {
  playbookId: string;
  playbookName: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgR: number;
  totalPnl: number;
  profitFactor: number;
  todayTrades: number;
  todayPnl: number;
  tradeIds: string[];
}

export function usePlaybookStats() {
  const { data: playbooks } = usePlaybooks();
  
  return useQuery({
    queryKey: ['playbook-stats', playbooks?.map(p => p.id).join(',')],
    queryFn: async (): Promise<Record<string, PlaybookStats>> => {
      if (!playbooks || playbooks.length === 0) return {};
      
      // Get all closed trades with their model field (playbook name)
      const { data: trades, error: tradesError } = await supabase
        .from('trades')
        .select('id, net_pnl, r_multiple_actual, entry_time, model')
        .eq('is_open', false);

      if (tradesError) throw tradesError;

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const statsByPlaybook: Record<string, PlaybookStats> = {};

      // Initialize stats for each playbook
      for (const playbook of playbooks) {
        statsByPlaybook[playbook.id] = {
          playbookId: playbook.id,
          playbookName: playbook.name,
          totalTrades: 0,
          wins: 0,
          losses: 0,
          winRate: 0,
          avgR: 0,
          totalPnl: 0,
          profitFactor: 0,
          todayTrades: 0,
          todayPnl: 0,
          tradeIds: [],
        };
      }

      // Match trades to playbooks by model name
      for (const trade of trades || []) {
        if (!trade.model) continue;
        
        // Find playbook by name match
        const matchedPlaybook = playbooks.find(pb => pb.name === trade.model);
        if (!matchedPlaybook) continue;

        const stats = statsByPlaybook[matchedPlaybook.id];
        const pnl = Number(trade.net_pnl) || 0;
        const tradeDate = new Date(trade.entry_time);
        const isToday = tradeDate >= today;

        stats.totalTrades++;
        stats.totalPnl += pnl;
        stats.tradeIds.push(trade.id);

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
        
        // Calculate avgR from matched trades
        const playbookTradeData = (trades || []).filter(t => {
          const matchedPlaybook = playbooks.find(pb => pb.name === t.model);
          return matchedPlaybook?.id === playbookId;
        });
        
        const totalR = playbookTradeData.reduce((sum, t) => sum + (Number(t.r_multiple_actual) || 0), 0);
        stats.avgR = playbookTradeData.length > 0 ? totalR / playbookTradeData.length : 0;
        
        // Profit factor
        const grossProfit = playbookTradeData
          .filter(t => (Number(t.net_pnl) || 0) > 0)
          .reduce((sum, t) => sum + (Number(t.net_pnl) || 0), 0);
        const grossLoss = Math.abs(playbookTradeData
          .filter(t => (Number(t.net_pnl) || 0) < 0)
          .reduce((sum, t) => sum + (Number(t.net_pnl) || 0), 0));
        
        stats.profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
      }

      return statsByPlaybook;
    },
    enabled: !!playbooks && playbooks.length > 0,
    refetchInterval: 30000,
  });
}

export function usePlaybookStat(playbookId: string | undefined) {
  const { data: allStats, ...rest } = usePlaybookStats();
  
  return {
    ...rest,
    data: playbookId && allStats ? allStats[playbookId] : undefined,
  };
}

export function usePlaybookRecentTrades(playbookName: string | undefined, limit: number = 5) {
  return useQuery({
    queryKey: ['playbook-recent-trades', playbookName, limit],
    queryFn: async () => {
      if (!playbookName) return [];
      
      const { data, error } = await supabase
        .from('trades')
        .select('id, symbol, entry_time, net_pnl, r_multiple_actual, direction')
        .eq('model', playbookName)
        .eq('is_open', false)
        .order('entry_time', { ascending: false })
        .limit(limit);
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!playbookName,
  });
}
