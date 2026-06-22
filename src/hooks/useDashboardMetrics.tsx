import { useMemo } from 'react';
import { Trade, DashboardMetrics, SessionMetrics, SessionType } from '@/types/trading';

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

export function useDashboardMetrics(trades: Trade[]): DashboardMetrics {
  return useMemo(() => {
    const closedTrades = trades.filter(t =>
      !t.is_open &&
      t.net_pnl !== null &&
      (!t.trade_type || t.trade_type === 'executed')
    );

    const empty: DashboardMetrics = {
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
      perTradeEdgeRatio: null,
      recoveryFactor: null,
      maxConsecutiveWins: 0,
      maxConsecutiveLosses: 0,
      maxDrawdownDollars: 0,
      rMultiples: [],
      monthlyPnl: {},
    };
    if (closedTrades.length === 0) return empty;

    // Sort by entry time for streak / drawdown calculations.
    const sorted = [...closedTrades].sort(
      (a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime()
    );

    const wins = closedTrades.filter(t => (t.net_pnl || 0) > 0);
    const losses = closedTrades.filter(t => (t.net_pnl || 0) < 0);
    const totalProfit = wins.reduce((sum, t) => sum + (t.net_pnl || 0), 0);
    const totalLoss = Math.abs(losses.reduce((sum, t) => sum + (t.net_pnl || 0), 0));
    const pnls = closedTrades.map(t => t.net_pnl || 0);
    const rMultiples = closedTrades.filter(t => t.r_multiple_actual !== null).map(t => t.r_multiple_actual!);

    // Current streak (most-recent trades backwards).
    let currentStreak = { type: 'win' as 'win' | 'loss', count: 0 };
    for (let i = 0; i < sorted.length; i++) {
      const pnl = sorted[i].net_pnl || 0;
      const isWin = pnl > 0;
      if (i === 0) currentStreak = { type: isWin ? 'win' : 'loss', count: 1 };
      else if ((isWin && currentStreak.type === 'win') || (!isWin && currentStreak.type === 'loss')) currentStreak.count++;
      else break;
    }

    // Max consecutive wins / losses across full sample, in chronological order.
    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;
    let runW = 0;
    let runL = 0;
    let equity = 0;
    let peak = 0;
    let maxDD = 0;
    const monthlyPnl: Record<string, number> = {};
    for (const t of sorted) {
      const pnl = t.net_pnl || 0;
      if (pnl > 0) { runW += 1; runL = 0; if (runW > maxConsecutiveWins) maxConsecutiveWins = runW; }
      else if (pnl < 0) { runL += 1; runW = 0; if (runL > maxConsecutiveLosses) maxConsecutiveLosses = runL; }
      else { runW = 0; runL = 0; }
      equity += pnl;
      if (equity > peak) peak = equity;
      const dd = equity - peak;
      if (dd < maxDD) maxDD = dd;
      const month = (t.entry_time ?? '').slice(0, 7); // YYYY-MM
      if (month) monthlyPnl[month] = (monthlyPnl[month] ?? 0) + pnl;
    }

    const totalPnl = pnls.reduce((a, b) => a + b, 0);
    const sdR = stddev(rMultiples);
    const meanR = rMultiples.length > 0 ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length : 0;
    const perTradeEdgeRatio = sdR > 0 ? meanR / sdR : null;
    const recoveryFactor = maxDD < 0 ? totalPnl / Math.abs(maxDD) : null;

    // By session.
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
      expectancy: totalPnl / closedTrades.length,
      avgRMultiple: meanR,
      totalPnl,
      bestTrade: Math.max(...pnls),
      worstTrade: Math.min(...pnls),
      currentStreak,
      bySession,
      perTradeEdgeRatio,
      recoveryFactor,
      maxConsecutiveWins,
      maxConsecutiveLosses,
      maxDrawdownDollars: maxDD,
      rMultiples,
      monthlyPnl,
    };
  }, [trades]);
}
