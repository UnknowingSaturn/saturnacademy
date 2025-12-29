import { useMemo } from 'react';
import { Trade } from '@/types/trading';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, isWithinInterval, format, parseISO } from 'date-fns';

export interface ReportMetrics {
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  totalPnl: number;
  avgRMultiple: number;
  bestTrade: Trade | null;
  worstTrade: Trade | null;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  consecutiveWins: number;
  consecutiveLosses: number;
  tradesBySymbol: Record<string, { count: number; pnl: number }>;
  tradesBySession: Record<string, { count: number; pnl: number }>;
  tradingDays: number;
  avgTradesPerDay: number;
}

export interface ReportPeriod {
  type: 'week' | 'month';
  start: Date;
  end: Date;
  label: string;
}

export function useReports(trades: Trade[], period: ReportPeriod) {
  const filteredTrades = useMemo(() => {
    return trades.filter(t => {
      if (t.is_open || t.net_pnl === null) return false;
      const entryDate = parseISO(t.entry_time);
      return isWithinInterval(entryDate, { start: period.start, end: period.end });
    });
  }, [trades, period]);

  const metrics: ReportMetrics = useMemo(() => {
    if (filteredTrades.length === 0) {
      return {
        totalTrades: 0,
        winRate: 0,
        profitFactor: 0,
        totalPnl: 0,
        avgRMultiple: 0,
        bestTrade: null,
        worstTrade: null,
        avgWin: 0,
        avgLoss: 0,
        largestWin: 0,
        largestLoss: 0,
        consecutiveWins: 0,
        consecutiveLosses: 0,
        tradesBySymbol: {},
        tradesBySession: {},
        tradingDays: 0,
        avgTradesPerDay: 0,
      };
    }

    const wins = filteredTrades.filter(t => (t.net_pnl || 0) > 0);
    const losses = filteredTrades.filter(t => (t.net_pnl || 0) < 0);

    const totalProfit = wins.reduce((sum, t) => sum + (t.net_pnl || 0), 0);
    const totalLoss = Math.abs(losses.reduce((sum, t) => sum + (t.net_pnl || 0), 0));

    const rMultiples = filteredTrades
      .filter(t => t.r_multiple_actual !== null)
      .map(t => t.r_multiple_actual!);

    // Find best and worst trades
    const sortedByPnl = [...filteredTrades].sort((a, b) => (b.net_pnl || 0) - (a.net_pnl || 0));
    const bestTrade = sortedByPnl[0] || null;
    const worstTrade = sortedByPnl[sortedByPnl.length - 1] || null;

    // Calculate consecutive wins/losses
    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;
    let currentWins = 0;
    let currentLosses = 0;

    filteredTrades.forEach(t => {
      if ((t.net_pnl || 0) > 0) {
        currentWins++;
        currentLosses = 0;
        maxConsecutiveWins = Math.max(maxConsecutiveWins, currentWins);
      } else {
        currentLosses++;
        currentWins = 0;
        maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLosses);
      }
    });

    // Group by symbol
    const tradesBySymbol: Record<string, { count: number; pnl: number }> = {};
    filteredTrades.forEach(t => {
      if (!tradesBySymbol[t.symbol]) {
        tradesBySymbol[t.symbol] = { count: 0, pnl: 0 };
      }
      tradesBySymbol[t.symbol].count++;
      tradesBySymbol[t.symbol].pnl += t.net_pnl || 0;
    });

    // Group by session
    const tradesBySession: Record<string, { count: number; pnl: number }> = {};
    filteredTrades.forEach(t => {
      const session = t.session || 'unknown';
      if (!tradesBySession[session]) {
        tradesBySession[session] = { count: 0, pnl: 0 };
      }
      tradesBySession[session].count++;
      tradesBySession[session].pnl += t.net_pnl || 0;
    });

    // Count unique trading days
    const uniqueDays = new Set(filteredTrades.map(t => format(parseISO(t.entry_time), 'yyyy-MM-dd')));

    return {
      totalTrades: filteredTrades.length,
      winRate: (wins.length / filteredTrades.length) * 100,
      profitFactor: totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0,
      totalPnl: filteredTrades.reduce((sum, t) => sum + (t.net_pnl || 0), 0),
      avgRMultiple: rMultiples.length > 0 ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length : 0,
      bestTrade,
      worstTrade,
      avgWin: wins.length > 0 ? totalProfit / wins.length : 0,
      avgLoss: losses.length > 0 ? totalLoss / losses.length : 0,
      largestWin: wins.length > 0 ? Math.max(...wins.map(t => t.net_pnl || 0)) : 0,
      largestLoss: losses.length > 0 ? Math.min(...losses.map(t => t.net_pnl || 0)) : 0,
      consecutiveWins: maxConsecutiveWins,
      consecutiveLosses: maxConsecutiveLosses,
      tradesBySymbol,
      tradesBySession,
      tradingDays: uniqueDays.size,
      avgTradesPerDay: uniqueDays.size > 0 ? filteredTrades.length / uniqueDays.size : 0,
    };
  }, [filteredTrades]);

  return { filteredTrades, metrics };
}

export function getWeekPeriod(date: Date): ReportPeriod {
  const start = startOfWeek(date, { weekStartsOn: 1 });
  const end = endOfWeek(date, { weekStartsOn: 1 });
  return {
    type: 'week',
    start,
    end,
    label: `Week of ${format(start, 'MMM d')} - ${format(end, 'MMM d, yyyy')}`,
  };
}

export function getMonthPeriod(date: Date): ReportPeriod {
  const start = startOfMonth(date);
  const end = endOfMonth(date);
  return {
    type: 'month',
    start,
    end,
    label: format(start, 'MMMM yyyy'),
  };
}

export function getPreviousPeriod(period: ReportPeriod): ReportPeriod {
  if (period.type === 'week') {
    const prevDate = new Date(period.start);
    prevDate.setDate(prevDate.getDate() - 7);
    return getWeekPeriod(prevDate);
  } else {
    const prevDate = new Date(period.start);
    prevDate.setMonth(prevDate.getMonth() - 1);
    return getMonthPeriod(prevDate);
  }
}
