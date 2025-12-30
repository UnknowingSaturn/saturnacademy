import { useMemo } from 'react';
import { Trade, DashboardMetrics, SessionMetrics, SessionType } from '@/types/trading';

export function useDashboardMetrics(trades: Trade[]): DashboardMetrics {
  return useMemo(() => {
    // Only include executed trades in P&L calculations (exclude ideas, paper, missed)
    const closedTrades = trades.filter(t => 
      !t.is_open && 
      t.net_pnl !== null &&
      (!t.trade_type || t.trade_type === 'executed')
    );
    
    if (closedTrades.length === 0) {
      return {
        totalTrades: 0,
        winRate: 0,
        profitFactor: 0,
        expectancy: 0,
        avgRMultiple: 0,
        totalPnl: 0,
        bestTrade: 0,
        worstTrade: 0,
        currentStreak: { type: 'win', count: 0 },
        bySession: {} as Record<SessionType, SessionMetrics>,
      };
    }

    const wins = closedTrades.filter(t => (t.net_pnl || 0) > 0);
    const losses = closedTrades.filter(t => (t.net_pnl || 0) < 0);
    
    const totalProfit = wins.reduce((sum, t) => sum + (t.net_pnl || 0), 0);
    const totalLoss = Math.abs(losses.reduce((sum, t) => sum + (t.net_pnl || 0), 0));
    
    const pnls = closedTrades.map(t => t.net_pnl || 0);
    const rMultiples = closedTrades.filter(t => t.r_multiple_actual !== null).map(t => t.r_multiple_actual!);

    // Calculate streak
    let currentStreak = { type: 'win' as 'win' | 'loss', count: 0 };
    for (let i = 0; i < closedTrades.length; i++) {
      const pnl = closedTrades[i].net_pnl || 0;
      const isWin = pnl > 0;
      if (i === 0) {
        currentStreak = { type: isWin ? 'win' : 'loss', count: 1 };
      } else if ((isWin && currentStreak.type === 'win') || (!isWin && currentStreak.type === 'loss')) {
        currentStreak.count++;
      } else {
        break;
      }
    }

    // Calculate by session - dynamically from actual trades
    const uniqueSessions = [...new Set(closedTrades.map(t => t.session).filter(Boolean))] as SessionType[];
    const bySession = uniqueSessions.reduce((acc, session) => {
      const sessionTrades = closedTrades.filter(t => t.session === session);
      const sessionWins = sessionTrades.filter(t => (t.net_pnl || 0) > 0);
      const sessionRs = sessionTrades.filter(t => t.r_multiple_actual !== null).map(t => t.r_multiple_actual!);
      
      acc[session] = {
        trades: sessionTrades.length,
        winRate: sessionTrades.length > 0 ? (sessionWins.length / sessionTrades.length) * 100 : 0,
        totalPnl: sessionTrades.reduce((sum, t) => sum + (t.net_pnl || 0), 0),
        avgR: sessionRs.length > 0 ? sessionRs.reduce((a, b) => a + b, 0) / sessionRs.length : 0,
      };
      return acc;
    }, {} as Record<SessionType, SessionMetrics>);

    return {
      totalTrades: closedTrades.length,
      winRate: (wins.length / closedTrades.length) * 100,
      profitFactor: totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0,
      expectancy: pnls.reduce((a, b) => a + b, 0) / closedTrades.length,
      avgRMultiple: rMultiples.length > 0 ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length : 0,
      totalPnl: pnls.reduce((a, b) => a + b, 0),
      bestTrade: Math.max(...pnls),
      worstTrade: Math.min(...pnls),
      currentStreak,
      bySession,
    };
  }, [trades]);
}