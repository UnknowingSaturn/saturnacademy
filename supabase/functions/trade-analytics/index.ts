import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TradeStats {
  trades: number;
  wins: number;
  total_pnl: number;
  total_r: number;
  winners_r: number[];
  losers_r: number[];
}

interface PlaybookPerformance {
  id: string;
  name: string;
  color: string;
  trades: number;
  wins: number;
  win_rate: number;
  avg_r: number;
  total_pnl: number;
  expectancy: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

interface SymbolPerformance {
  symbol: string;
  trades: number;
  wins: number;
  win_rate: number;
  avg_r: number;
  total_pnl: number;
  recommendation: 'focus' | 'neutral' | 'avoid';
}

interface SessionMatrixEntry {
  session: string;
  direction: string;
  trades: number;
  wins: number;
  win_rate: number;
  avg_r: number;
  total_pnl: number;
  avg_winner: number;
  avg_loser: number;
  rr_warning: boolean;
}

interface JournalInsight {
  text: string;
  count: number;
}

interface JournalInsights {
  common_mistakes: JournalInsight[];
  common_improvements: JournalInsight[];
  common_strengths: JournalInsight[];
  reviewed_trades: number;
  unreviewed_trades: number;
}

interface DayPerformance {
  day: string;
  day_number: number;
  trades: number;
  wins: number;
  win_rate: number;
  avg_r: number;
  total_pnl: number;
}

interface RiskAnalysis {
  avg_risk_percent: number;
  risk_consistency: number;
  largest_loss_r: number;
  largest_win_r: number;
  trades_with_risk_data: number;
  risk_distribution: { bucket: string; count: number }[];
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SESSION_NAMES: Record<string, string> = {
  'tokyo': 'Tokyo',
  'london': 'London',
  'new_york': 'New York',
  'new_york_am': 'NY AM',
  'new_york_pm': 'NY PM',
  'overlap_london_ny': 'LDN/NY Overlap',
  'off_hours': 'Off Hours',
};

function calculateStats(trades: any[]): TradeStats {
  const wins = trades.filter(t => (t.net_pnl || 0) > 0).length;
  const total_pnl = trades.reduce((sum, t) => sum + (t.net_pnl || 0), 0);
  const total_r = trades.reduce((sum, t) => sum + (t.r_multiple_actual || 0), 0);
  const winners_r = trades.filter(t => (t.r_multiple_actual || 0) > 0).map(t => t.r_multiple_actual || 0);
  const losers_r = trades.filter(t => (t.r_multiple_actual || 0) < 0).map(t => Math.abs(t.r_multiple_actual || 0));
  
  return { trades: trades.length, wins, total_pnl, total_r, winners_r, losers_r };
}

function calculateExpectancy(stats: TradeStats): number {
  if (stats.trades === 0) return 0;
  const winRate = stats.wins / stats.trades;
  const avgWinner = stats.winners_r.length > 0 
    ? stats.winners_r.reduce((a, b) => a + b, 0) / stats.winners_r.length 
    : 0;
  const avgLoser = stats.losers_r.length > 0 
    ? stats.losers_r.reduce((a, b) => a + b, 0) / stats.losers_r.length 
    : 0;
  return (winRate * avgWinner) - ((1 - winRate) * avgLoser);
}

function getGrade(expectancy: number, trades: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (trades < 5) return 'C'; // Insufficient data
  if (expectancy >= 0.5) return 'A';
  if (expectancy >= 0.25) return 'B';
  if (expectancy >= 0) return 'C';
  if (expectancy >= -0.25) return 'D';
  return 'F';
}

function getRecommendation(avgR: number, winRate: number, trades: number): 'focus' | 'neutral' | 'avoid' {
  if (trades < 3) return 'neutral';
  if (avgR >= 0.3 && winRate >= 0.4) return 'focus';
  if (avgR < -0.2 || winRate < 0.3) return 'avoid';
  return 'neutral';
}

function aggregateTextItems(items: (string | null | undefined)[]): JournalInsight[] {
  const counts = new Map<string, number>();
  
  items.forEach(item => {
    if (item && typeof item === 'string' && item.trim()) {
      const normalized = item.trim().toLowerCase();
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }
  });
  
  return Array.from(counts.entries())
    .map(([text, count]) => ({ text: text.charAt(0).toUpperCase() + text.slice(1), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

function calculateStdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const { account_id } = await req.json().catch(() => ({}));

    console.log(`[trade-analytics] Starting analysis for user ${user.id}, account: ${account_id || 'all'}`);

    // Fetch closed trades with optional account filter
    let tradesQuery = supabaseClient
      .from('trades')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_open', false)
      .eq('is_archived', false)
      .order('entry_time', { ascending: false });

    if (account_id && account_id !== 'all') {
      tradesQuery = tradesQuery.eq('account_id', account_id);
    }

    const { data: trades, error: tradesError } = await tradesQuery;
    if (tradesError) throw tradesError;

    // Fetch playbooks for names
    const { data: playbooks } = await supabaseClient
      .from('playbooks')
      .select('id, name, color')
      .eq('user_id', user.id);

    const playbookMap = new Map(playbooks?.map(p => [p.id, p]) || []);

    // Fetch trade reviews for journal insights
    const tradeIds = trades?.map(t => t.id) || [];
    let reviews: any[] = [];
    if (tradeIds.length > 0) {
      const { data: reviewData } = await supabaseClient
        .from('trade_reviews')
        .select('*')
        .in('trade_id', tradeIds);
      reviews = reviewData || [];
    }

    const reviewMap = new Map(reviews.map(r => [r.trade_id, r]));

    console.log(`[trade-analytics] Found ${trades?.length || 0} trades, ${reviews.length} reviews`);

    if (!trades || trades.length === 0) {
      return new Response(JSON.stringify({
        overview: { total_trades: 0, total_pnl: 0, win_rate: 0, avg_r: 0, profit_factor: 0 },
        playbook_comparison: [],
        symbol_performance: [],
        session_matrix: [],
        journal_insights: { common_mistakes: [], common_improvements: [], common_strengths: [], reviewed_trades: 0, unreviewed_trades: 0 },
        day_of_week: [],
        risk_analysis: { avg_risk_percent: 0, risk_consistency: 0, largest_loss_r: 0, largest_win_r: 0, trades_with_risk_data: 0, risk_distribution: [] },
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // === OVERVIEW ===
    const overallStats = calculateStats(trades);
    const grossProfits = trades.filter(t => (t.net_pnl || 0) > 0).reduce((sum, t) => sum + (t.net_pnl || 0), 0);
    const grossLosses = Math.abs(trades.filter(t => (t.net_pnl || 0) < 0).reduce((sum, t) => sum + (t.net_pnl || 0), 0));
    
    const overview = {
      total_trades: trades.length,
      total_pnl: overallStats.total_pnl,
      win_rate: trades.length > 0 ? (overallStats.wins / trades.length) * 100 : 0,
      avg_r: trades.length > 0 ? overallStats.total_r / trades.length : 0,
      profit_factor: grossLosses > 0 ? grossProfits / grossLosses : grossProfits > 0 ? Infinity : 0,
      date_range: {
        start: trades[trades.length - 1]?.entry_time,
        end: trades[0]?.entry_time,
      },
    };

    // === PLAYBOOK COMPARISON ===
    const tradesByPlaybook = new Map<string, any[]>();
    trades.forEach(t => {
      const key = t.playbook_id || 'unassigned';
      if (!tradesByPlaybook.has(key)) tradesByPlaybook.set(key, []);
      tradesByPlaybook.get(key)!.push(t);
    });

    const playbook_comparison: PlaybookPerformance[] = Array.from(tradesByPlaybook.entries())
      .map(([id, pbTrades]) => {
        const stats = calculateStats(pbTrades);
        const expectancy = calculateExpectancy(stats);
        const playbook = playbookMap.get(id);
        return {
          id,
          name: playbook?.name || (id === 'unassigned' ? 'Unassigned' : 'Unknown'),
          color: playbook?.color || '#6B7280',
          trades: stats.trades,
          wins: stats.wins,
          win_rate: stats.trades > 0 ? (stats.wins / stats.trades) * 100 : 0,
          avg_r: stats.trades > 0 ? stats.total_r / stats.trades : 0,
          total_pnl: stats.total_pnl,
          expectancy,
          grade: getGrade(expectancy, stats.trades),
        };
      })
      .sort((a, b) => b.expectancy - a.expectancy);

    // === SYMBOL PERFORMANCE ===
    const tradesBySymbol = new Map<string, any[]>();
    trades.forEach(t => {
      if (!tradesBySymbol.has(t.symbol)) tradesBySymbol.set(t.symbol, []);
      tradesBySymbol.get(t.symbol)!.push(t);
    });

    const symbol_performance: SymbolPerformance[] = Array.from(tradesBySymbol.entries())
      .map(([symbol, symTrades]) => {
        const stats = calculateStats(symTrades);
        const winRate = stats.trades > 0 ? stats.wins / stats.trades : 0;
        const avgR = stats.trades > 0 ? stats.total_r / stats.trades : 0;
        return {
          symbol,
          trades: stats.trades,
          wins: stats.wins,
          win_rate: winRate * 100,
          avg_r: avgR,
          total_pnl: stats.total_pnl,
          recommendation: getRecommendation(avgR, winRate, stats.trades),
        };
      })
      .sort((a, b) => b.total_pnl - a.total_pnl);

    // === SESSION MATRIX ===
    const sessionDirectionKey = (session: string, direction: string) => `${session}|${direction}`;
    const tradesBySessionDirection = new Map<string, any[]>();
    trades.forEach(t => {
      if (!t.session) return;
      const key = sessionDirectionKey(t.session, t.direction);
      if (!tradesBySessionDirection.has(key)) tradesBySessionDirection.set(key, []);
      tradesBySessionDirection.get(key)!.push(t);
    });

    const session_matrix: SessionMatrixEntry[] = Array.from(tradesBySessionDirection.entries())
      .map(([key, sdTrades]) => {
        const [session, direction] = key.split('|');
        const stats = calculateStats(sdTrades);
        const winRate = stats.trades > 0 ? stats.wins / stats.trades : 0;
        const avgR = stats.trades > 0 ? stats.total_r / stats.trades : 0;
        const avgWinner = stats.winners_r.length > 0 
          ? stats.winners_r.reduce((a, b) => a + b, 0) / stats.winners_r.length 
          : 0;
        const avgLoser = stats.losers_r.length > 0 
          ? stats.losers_r.reduce((a, b) => a + b, 0) / stats.losers_r.length 
          : 0;
        
        // Warning: winning more than 50% but overall negative R
        const rr_warning = winRate > 0.5 && avgR < 0;

        return {
          session: SESSION_NAMES[session] || session,
          direction: direction === 'buy' ? 'Long' : 'Short',
          trades: stats.trades,
          wins: stats.wins,
          win_rate: winRate * 100,
          avg_r: avgR,
          total_pnl: stats.total_pnl,
          avg_winner: avgWinner,
          avg_loser: avgLoser,
          rr_warning,
        };
      })
      .sort((a, b) => b.trades - a.trades);

    // === JOURNAL INSIGHTS ===
    const allMistakes: string[] = [];
    const allImprovements: string[] = [];
    const allStrengths: string[] = [];

    reviews.forEach(r => {
      if (Array.isArray(r.mistakes)) {
        allMistakes.push(...r.mistakes.filter((m: any) => typeof m === 'string'));
      }
      if (Array.isArray(r.to_improve)) {
        allImprovements.push(...r.to_improve.filter((m: any) => typeof m === 'string'));
      }
      if (Array.isArray(r.did_well)) {
        allStrengths.push(...r.did_well.filter((m: any) => typeof m === 'string'));
      }
    });

    const journal_insights: JournalInsights = {
      common_mistakes: aggregateTextItems(allMistakes),
      common_improvements: aggregateTextItems(allImprovements),
      common_strengths: aggregateTextItems(allStrengths),
      reviewed_trades: reviews.length,
      unreviewed_trades: trades.length - reviews.length,
    };

    // === DAY OF WEEK ===
    const tradesByDay = new Map<number, any[]>();
    trades.forEach(t => {
      const day = new Date(t.entry_time).getDay();
      if (!tradesByDay.has(day)) tradesByDay.set(day, []);
      tradesByDay.get(day)!.push(t);
    });

    const day_of_week: DayPerformance[] = [1, 2, 3, 4, 5].map(dayNum => {
      const dayTrades = tradesByDay.get(dayNum) || [];
      const stats = calculateStats(dayTrades);
      return {
        day: DAY_NAMES[dayNum],
        day_number: dayNum,
        trades: stats.trades,
        wins: stats.wins,
        win_rate: stats.trades > 0 ? (stats.wins / stats.trades) * 100 : 0,
        avg_r: stats.trades > 0 ? stats.total_r / stats.trades : 0,
        total_pnl: stats.total_pnl,
      };
    });

    // === RISK ANALYSIS ===
    const tradesWithRisk = trades.filter(t => t.risk_percent !== null && t.risk_percent !== undefined);
    const riskPercents = tradesWithRisk.map(t => t.risk_percent);
    const rMultiples = trades.map(t => t.r_multiple_actual || 0).filter(r => r !== 0);

    const riskBuckets = [
      { bucket: '< 0.5%', min: 0, max: 0.5 },
      { bucket: '0.5% - 1%', min: 0.5, max: 1 },
      { bucket: '1% - 1.5%', min: 1, max: 1.5 },
      { bucket: '1.5% - 2%', min: 1.5, max: 2 },
      { bucket: '> 2%', min: 2, max: Infinity },
    ];

    const risk_distribution = riskBuckets.map(({ bucket, min, max }) => ({
      bucket,
      count: tradesWithRisk.filter(t => t.risk_percent >= min && t.risk_percent < max).length,
    }));

    const risk_analysis: RiskAnalysis = {
      avg_risk_percent: riskPercents.length > 0 
        ? riskPercents.reduce((a, b) => a + b, 0) / riskPercents.length 
        : 0,
      risk_consistency: calculateStdDev(riskPercents),
      largest_loss_r: rMultiples.length > 0 ? Math.min(...rMultiples) : 0,
      largest_win_r: rMultiples.length > 0 ? Math.max(...rMultiples) : 0,
      trades_with_risk_data: tradesWithRisk.length,
      risk_distribution,
    };

    console.log(`[trade-analytics] Analysis complete`);

    return new Response(JSON.stringify({
      overview,
      playbook_comparison,
      symbol_performance,
      session_matrix,
      journal_insights,
      day_of_week,
      risk_analysis,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[trade-analytics] Error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
