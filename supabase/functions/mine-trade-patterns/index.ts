import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TradeStats {
  trades: number;
  wins: number;
  totalPnl: number;
  totalR: number;
}

interface Pattern {
  type: string;
  category: string;
  insight: string;
  severity: 'positive' | 'negative' | 'neutral';
  recommendation: string;
  stats: {
    trades: number;
    winRate: number;
    avgR: number;
    totalPnl: number;
  };
}

// Day names for readable output
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Session display names
const SESSION_NAMES: Record<string, string> = {
  'tokyo': 'Tokyo',
  'london': 'London',
  'new_york': 'New York',
  'new_york_am': 'NY AM',
  'new_york_pm': 'NY PM',
  'overlap_london_ny': 'London/NY Overlap',
  'off_hours': 'Off Hours',
};

function calculateStats(trades: any[]): TradeStats {
  const wins = trades.filter(t => (t.net_pnl || 0) > 0).length;
  const totalPnl = trades.reduce((sum, t) => sum + (t.net_pnl || 0), 0);
  const totalR = trades.reduce((sum, t) => sum + (t.r_multiple_actual || 0), 0);
  
  return {
    trades: trades.length,
    wins,
    totalPnl,
    totalR,
  };
}

function statsToPattern(
  type: string, 
  category: string, 
  stats: TradeStats,
  minTrades: number = 3
): Pattern | null {
  if (stats.trades < minTrades) return null;
  
  const winRate = (stats.wins / stats.trades) * 100;
  const avgR = stats.totalR / stats.trades;
  
  // Determine severity based on average R
  let severity: 'positive' | 'negative' | 'neutral';
  if (avgR > 0.3) severity = 'positive';
  else if (avgR < -0.3) severity = 'negative';
  else severity = 'neutral';
  
  // Generate insight text
  const pnlText = stats.totalPnl >= 0 ? `+$${stats.totalPnl.toFixed(0)}` : `-$${Math.abs(stats.totalPnl).toFixed(0)}`;
  const rText = avgR >= 0 ? `+${avgR.toFixed(2)}R` : `${avgR.toFixed(2)}R`;
  const insight = `${category}: ${winRate.toFixed(1)}% WR, ${rText} avg, ${pnlText}`;
  
  // Generate recommendation based on severity
  let recommendation = '';
  if (severity === 'positive') {
    recommendation = `Your edge is strong with ${category}. Consider increasing focus here.`;
  } else if (severity === 'negative') {
    recommendation = `Consider avoiding or reducing size for ${category} trades.`;
  } else {
    recommendation = `${category} shows neutral performance. Monitor for pattern changes.`;
  }
  
  return {
    type,
    category,
    insight,
    severity,
    recommendation,
    stats: {
      trades: stats.trades,
      winRate,
      avgR,
      totalPnl: stats.totalPnl,
    },
  };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get auth token from header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client with user's auth
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Get authenticated user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Mining patterns for user: ${user.id}`);

    // Parse request body for optional filters
    let accountId: string | null = null;
    let minTrades = 3;
    
    try {
      const body = await req.json();
      accountId = body.account_id || null;
      minTrades = body.min_trades || 3;
    } catch {
      // Body is optional
    }

    // Fetch all closed trades for the user
    let query = supabase
      .from('trades')
      .select('id, symbol, direction, session, entry_time, net_pnl, r_multiple_actual, playbook_id')
      .eq('user_id', user.id)
      .eq('is_open', false)
      .not('net_pnl', 'is', null);

    if (accountId && accountId !== 'all') {
      query = query.eq('account_id', accountId);
    }

    const { data: trades, error: tradesError } = await query;

    if (tradesError) {
      console.error('Error fetching trades:', tradesError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch trades' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!trades || trades.length < minTrades) {
      return new Response(
        JSON.stringify({ 
          patterns: [],
          summary: {
            bestConditions: [],
            worstConditions: [],
            totalTradesAnalyzed: trades?.length || 0,
            dataRange: { start: null, end: null },
            message: `Need at least ${minTrades} trades to analyze patterns`
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Analyzing ${trades.length} trades`);

    const patterns: Pattern[] = [];

    // 1. Day of Week Analysis
    const byDayOfWeek: Record<number, any[]> = {};
    trades.forEach(trade => {
      const day = new Date(trade.entry_time).getUTCDay();
      if (!byDayOfWeek[day]) byDayOfWeek[day] = [];
      byDayOfWeek[day].push(trade);
    });

    for (const [day, dayTrades] of Object.entries(byDayOfWeek)) {
      const stats = calculateStats(dayTrades);
      const pattern = statsToPattern('day_of_week', DAY_NAMES[parseInt(day)], stats, minTrades);
      if (pattern) patterns.push(pattern);
    }

    // 2. Session Analysis
    const bySession: Record<string, any[]> = {};
    trades.forEach(trade => {
      if (trade.session) {
        if (!bySession[trade.session]) bySession[trade.session] = [];
        bySession[trade.session].push(trade);
      }
    });

    for (const [session, sessionTrades] of Object.entries(bySession)) {
      const stats = calculateStats(sessionTrades);
      const displayName = SESSION_NAMES[session] || session;
      const pattern = statsToPattern('session', displayName, stats, minTrades);
      if (pattern) patterns.push(pattern);
    }

    // 3. Session + Direction Analysis
    const bySessionDirection: Record<string, any[]> = {};
    trades.forEach(trade => {
      if (trade.session) {
        const key = `${trade.session}_${trade.direction}`;
        if (!bySessionDirection[key]) bySessionDirection[key] = [];
        bySessionDirection[key].push(trade);
      }
    });

    for (const [key, sdTrades] of Object.entries(bySessionDirection)) {
      const [session, direction] = key.split('_');
      const stats = calculateStats(sdTrades);
      const displayName = `${SESSION_NAMES[session] || session} ${direction === 'buy' ? 'Longs' : 'Shorts'}`;
      const pattern = statsToPattern('session_direction', displayName, stats, minTrades);
      if (pattern) patterns.push(pattern);
    }

    // 4. Symbol Analysis  
    const bySymbol: Record<string, any[]> = {};
    trades.forEach(trade => {
      // Normalize symbol (remove broker suffixes)
      const symbol = trade.symbol.replace(/[.#_].*$/, '').replace(/micro$/i, '').toUpperCase();
      if (!bySymbol[symbol]) bySymbol[symbol] = [];
      bySymbol[symbol].push(trade);
    });

    for (const [symbol, symbolTrades] of Object.entries(bySymbol)) {
      const stats = calculateStats(symbolTrades);
      const pattern = statsToPattern('symbol', symbol, stats, minTrades);
      if (pattern) patterns.push(pattern);
    }

    // 5. Time of Day Analysis (morning/afternoon/evening based on entry hour UTC)
    const byTimeOfDay: Record<string, any[]> = { 'Morning (4-11 UTC)': [], 'Afternoon (11-18 UTC)': [], 'Evening (18-4 UTC)': [] };
    trades.forEach(trade => {
      const hour = new Date(trade.entry_time).getUTCHours();
      if (hour >= 4 && hour < 11) {
        byTimeOfDay['Morning (4-11 UTC)'].push(trade);
      } else if (hour >= 11 && hour < 18) {
        byTimeOfDay['Afternoon (11-18 UTC)'].push(trade);
      } else {
        byTimeOfDay['Evening (18-4 UTC)'].push(trade);
      }
    });

    for (const [timeSlot, timeTrades] of Object.entries(byTimeOfDay)) {
      if (timeTrades.length > 0) {
        const stats = calculateStats(timeTrades);
        const pattern = statsToPattern('time_of_day', timeSlot, stats, minTrades);
        if (pattern) patterns.push(pattern);
      }
    }

    // Sort patterns by absolute avgR for impact
    patterns.sort((a, b) => Math.abs(b.stats.avgR) - Math.abs(a.stats.avgR));

    // Calculate summary
    const positivePatterns = patterns.filter(p => p.severity === 'positive');
    const negativePatterns = patterns.filter(p => p.severity === 'negative');

    // Get top 3 best and worst conditions
    const bestConditions = positivePatterns
      .slice(0, 3)
      .map(p => p.category);
    
    const worstConditions = negativePatterns
      .slice(0, 3)
      .map(p => p.category);

    // Data range
    const sortedByTime = [...trades].sort((a, b) => 
      new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime()
    );
    const dataRange = {
      start: sortedByTime[0]?.entry_time || null,
      end: sortedByTime[sortedByTime.length - 1]?.entry_time || null,
    };

    console.log(`Found ${patterns.length} patterns: ${positivePatterns.length} positive, ${negativePatterns.length} negative`);

    return new Response(
      JSON.stringify({
        patterns,
        summary: {
          bestConditions,
          worstConditions,
          totalTradesAnalyzed: trades.length,
          dataRange,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Pattern mining error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
