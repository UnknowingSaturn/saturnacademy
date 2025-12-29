import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { usePlaybooks } from './usePlaybooks';

export interface StreakStats {
  currentStreak: number;
  currentStreakType: 'win' | 'loss' | 'none';
  longestWinStreak: number;
  longestLossStreak: number;
}

export interface ComplianceStatus {
  tradesUsed: number;
  tradesLimit: number | null;
  rUsed: number;
  rLimit: number | null;
  isWithinLimits: boolean;
  warnings: string[];
}

export interface EquityPoint {
  date: string;
  balance: number;
  tradeIndex: number;
}

export interface RDistributionBucket {
  range: string;
  count: number;
  isPositive: boolean;
}

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
  todayRUsed: number;
  tradeIds: string[];
  streakStats: StreakStats;
  complianceStatus: ComplianceStatus;
  equityCurve: EquityPoint[];
  rDistribution: RDistributionBucket[];
}

function calculateStreakStats(trades: { net_pnl: number | null; entry_time: string }[]): StreakStats {
  if (trades.length === 0) {
    return { currentStreak: 0, currentStreakType: 'none', longestWinStreak: 0, longestLossStreak: 0 };
  }

  // Sort by entry_time descending (most recent first)
  const sorted = [...trades].sort((a, b) => 
    new Date(b.entry_time).getTime() - new Date(a.entry_time).getTime()
  );

  let currentStreak = 0;
  let currentStreakType: 'win' | 'loss' | 'none' = 'none';
  let longestWinStreak = 0;
  let longestLossStreak = 0;
  let tempWinStreak = 0;
  let tempLossStreak = 0;

  // Calculate current streak (from most recent trade)
  const firstPnl = Number(sorted[0]?.net_pnl) || 0;
  if (firstPnl > 0) {
    currentStreakType = 'win';
    for (const trade of sorted) {
      if ((Number(trade.net_pnl) || 0) > 0) {
        currentStreak++;
      } else {
        break;
      }
    }
  } else if (firstPnl < 0) {
    currentStreakType = 'loss';
    for (const trade of sorted) {
      if ((Number(trade.net_pnl) || 0) < 0) {
        currentStreak++;
      } else {
        break;
      }
    }
  }

  // Calculate longest streaks (chronological order)
  const chronological = [...trades].sort((a, b) => 
    new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime()
  );

  for (const trade of chronological) {
    const pnl = Number(trade.net_pnl) || 0;
    if (pnl > 0) {
      tempWinStreak++;
      tempLossStreak = 0;
      longestWinStreak = Math.max(longestWinStreak, tempWinStreak);
    } else if (pnl < 0) {
      tempLossStreak++;
      tempWinStreak = 0;
      longestLossStreak = Math.max(longestLossStreak, tempLossStreak);
    }
  }

  return { currentStreak, currentStreakType, longestWinStreak, longestLossStreak };
}

function calculateRDistribution(trades: { r_multiple_actual: number | null }[]): RDistributionBucket[] {
  const buckets: Record<string, { count: number; isPositive: boolean }> = {
    '<-2R': { count: 0, isPositive: false },
    '-2R to -1R': { count: 0, isPositive: false },
    '-1R to 0': { count: 0, isPositive: false },
    '0 to 1R': { count: 0, isPositive: true },
    '1R to 2R': { count: 0, isPositive: true },
    '>2R': { count: 0, isPositive: true },
  };

  for (const trade of trades) {
    const r = Number(trade.r_multiple_actual) || 0;
    if (r < -2) buckets['<-2R'].count++;
    else if (r < -1) buckets['-2R to -1R'].count++;
    else if (r < 0) buckets['-1R to 0'].count++;
    else if (r < 1) buckets['0 to 1R'].count++;
    else if (r < 2) buckets['1R to 2R'].count++;
    else buckets['>2R'].count++;
  }

  return Object.entries(buckets).map(([range, data]) => ({
    range,
    count: data.count,
    isPositive: data.isPositive,
  }));
}

function calculateEquityCurve(trades: { net_pnl: number | null; entry_time: string }[]): EquityPoint[] {
  if (trades.length === 0) return [];

  const sorted = [...trades].sort((a, b) => 
    new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime()
  );

  let balance = 0;
  return sorted.map((trade, index) => {
    balance += Number(trade.net_pnl) || 0;
    return {
      date: trade.entry_time,
      balance,
      tradeIndex: index + 1,
    };
  });
}

export function usePlaybookStats() {
  const { data: playbooks } = usePlaybooks();
  
  return useQuery({
    queryKey: ['playbook-stats', playbooks?.map(p => p.id).join(',')],
    queryFn: async (): Promise<Record<string, PlaybookStats>> => {
      if (!playbooks || playbooks.length === 0) return {};
      
      // Get all closed trades with their playbook_id field
      const { data: trades, error: tradesError } = await supabase
        .from('trades')
        .select('id, net_pnl, r_multiple_actual, entry_time, playbook_id')
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
          todayRUsed: 0,
          tradeIds: [],
          streakStats: { currentStreak: 0, currentStreakType: 'none', longestWinStreak: 0, longestLossStreak: 0 },
          complianceStatus: { tradesUsed: 0, tradesLimit: null, rUsed: 0, rLimit: null, isWithinLimits: true, warnings: [] },
          equityCurve: [],
          rDistribution: [],
        };
      }

      // Match trades to playbooks by playbook_id
      const tradesByPlaybook: Record<string, typeof trades> = {};
      
      for (const trade of trades || []) {
        if (!trade.playbook_id) continue;
        
        // Find playbook by ID match
        const matchedPlaybook = playbooks.find(pb => pb.id === trade.playbook_id);
        if (!matchedPlaybook) continue;

        if (!tradesByPlaybook[matchedPlaybook.id]) {
          tradesByPlaybook[matchedPlaybook.id] = [];
        }
        tradesByPlaybook[matchedPlaybook.id].push(trade);

        const stats = statsByPlaybook[matchedPlaybook.id];
        const pnl = Number(trade.net_pnl) || 0;
        const rMultiple = Number(trade.r_multiple_actual) || 0;
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
          // Only count negative R for "R used" (losses count against daily limit)
          if (rMultiple < 0) {
            stats.todayRUsed += Math.abs(rMultiple);
          }
        }
      }

      // Calculate derived metrics for each playbook
      for (const playbook of playbooks) {
        const stats = statsByPlaybook[playbook.id];
        const playbookTrades = tradesByPlaybook[playbook.id] || [];
        
        stats.winRate = stats.totalTrades > 0 
          ? (stats.wins / stats.totalTrades) * 100 
          : 0;
        
        // Calculate avgR
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

        // Streak stats
        stats.streakStats = calculateStreakStats(playbookTrades);

        // Equity curve
        stats.equityCurve = calculateEquityCurve(playbookTrades);

        // R distribution
        stats.rDistribution = calculateRDistribution(playbookTrades);

        // Compliance status
        const warnings: string[] = [];
        const tradesLimit = playbook.max_trades_per_session ?? null;
        const rLimit = playbook.max_daily_loss_r ?? null;

        if (tradesLimit && stats.todayTrades >= tradesLimit) {
          warnings.push('Session trade limit reached');
        }
        if (rLimit && stats.todayRUsed >= rLimit) {
          warnings.push('Daily R loss limit reached');
        }

        stats.complianceStatus = {
          tradesUsed: stats.todayTrades,
          tradesLimit,
          rUsed: stats.todayRUsed,
          rLimit,
          isWithinLimits: warnings.length === 0,
          warnings,
        };
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

export function usePlaybookRecentTrades(playbookId: string | undefined, limit: number = 5) {
  return useQuery({
    queryKey: ['playbook-recent-trades', playbookId, limit],
    queryFn: async () => {
      if (!playbookId) return [];
      
      const { data, error } = await supabase
        .from('trades')
        .select('id, symbol, entry_time, net_pnl, r_multiple_actual, direction')
        .eq('playbook_id', playbookId)
        .eq('is_open', false)
        .order('entry_time', { ascending: false })
        .limit(limit);
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!playbookId,
  });
}
