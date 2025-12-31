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

// Behavioral Analytics Computation
interface BehavioralAnalytics {
  checklist_correlation: {
    full_pass: { trades: number; win_rate: number; avg_r: number };
    partial_pass: { trades: number; win_rate: number; avg_r: number };
    no_checklist: { trades: number; win_rate: number; avg_r: number };
  };
  emotional_impact: { state: string; trades: number; win_rate: number; avg_r: number }[];
  winner_loser_comparison: {
    playbook_name: string;
    winners: { count: number; avg_duration_minutes: number; avg_risk_percent: number; checklist_pass_rate: number };
    losers: { count: number; avg_duration_minutes: number; avg_risk_percent: number; checklist_pass_rate: number };
    key_differences: string[];
  }[];
  regime_by_playbook: {
    playbook_name: string;
    rotational: { trades: number; win_rate: number; avg_r: number };
    transitional: { trades: number; win_rate: number; avg_r: number };
    no_regime: { trades: number; win_rate: number; avg_r: number };
  }[];
  risk_patterns: {
    winners_avg_risk: number;
    losers_avg_risk: number;
    risk_after_loss: number;
    risk_after_win: number;
    over_risking_on_losers: boolean;
  };
  sample_sizes: {
    total_trades: number;
    trades_with_checklist: number;
    trades_with_emotional_state: number;
    trades_with_regime: number;
  };
}

function computeBehavioralAnalytics(
  trades: any[],
  reviews: any[],
  playbookMap: Map<string, any>
): BehavioralAnalytics {
  const reviewMap = new Map(reviews.map(r => [r.trade_id, r]));
  
  // === CHECKLIST CORRELATION ===
  const tradesWithFullPass: any[] = [];
  const tradesWithPartialPass: any[] = [];
  const tradesNoChecklist: any[] = [];

  trades.forEach(t => {
    const review = reviewMap.get(t.id);
    if (!review?.checklist_answers) {
      tradesNoChecklist.push(t);
      return;
    }
    
    const answers = review.checklist_answers;
    const total = Object.keys(answers).length;
    const passed = Object.values(answers).filter(v => v === true).length;
    
    if (total === 0) {
      tradesNoChecklist.push(t);
    } else if (passed === total) {
      tradesWithFullPass.push(t);
    } else {
      tradesWithPartialPass.push(t);
    }
  });

  const calcGroupStats = (group: any[]) => {
    if (group.length === 0) return { trades: 0, win_rate: 0, avg_r: 0 };
    const wins = group.filter(t => (t.net_pnl || 0) > 0).length;
    const totalR = group.reduce((sum, t) => sum + (t.r_multiple_actual || 0), 0);
    return {
      trades: group.length,
      win_rate: (wins / group.length) * 100,
      avg_r: totalR / group.length,
    };
  };

  const checklist_correlation = {
    full_pass: calcGroupStats(tradesWithFullPass),
    partial_pass: calcGroupStats(tradesWithPartialPass),
    no_checklist: calcGroupStats(tradesNoChecklist),
  };

  // === EMOTIONAL STATE IMPACT ===
  const tradesByEmotionalState = new Map<string, any[]>();
  trades.forEach(t => {
    const review = reviewMap.get(t.id);
    const state = review?.emotional_state_before || 'unknown';
    if (!tradesByEmotionalState.has(state)) tradesByEmotionalState.set(state, []);
    tradesByEmotionalState.get(state)!.push(t);
  });

  const emotional_impact = Array.from(tradesByEmotionalState.entries())
    .filter(([state]) => state !== 'unknown')
    .map(([state, group]) => ({
      state,
      ...calcGroupStats(group),
    }))
    .sort((a, b) => b.trades - a.trades);

  // === WINNER VS LOSER COMPARISON (per playbook) ===
  const tradesByPlaybook = new Map<string, any[]>();
  trades.forEach(t => {
    const key = t.playbook_id || 'unassigned';
    if (!tradesByPlaybook.has(key)) tradesByPlaybook.set(key, []);
    tradesByPlaybook.get(key)!.push(t);
  });

  const winner_loser_comparison = Array.from(tradesByPlaybook.entries())
    .filter(([_, group]) => group.length >= 5) // Need minimum sample
    .map(([pbId, group]) => {
      const playbook = playbookMap.get(pbId);
      const winners = group.filter(t => (t.net_pnl || 0) > 0);
      const losers = group.filter(t => (t.net_pnl || 0) < 0);

      const calcGroupDetails = (subgroup: any[]) => {
        if (subgroup.length === 0) return { count: 0, avg_duration_minutes: 0, avg_risk_percent: 0, checklist_pass_rate: 0 };
        
        const durations = subgroup.filter(t => t.duration_seconds).map(t => t.duration_seconds / 60);
        const risks = subgroup.filter(t => t.risk_percent).map(t => t.risk_percent);
        
        let checklistPasses = 0;
        let checklistTotal = 0;
        subgroup.forEach(t => {
          const review = reviewMap.get(t.id);
          if (review?.checklist_answers) {
            const answers = review.checklist_answers;
            const total = Object.keys(answers).length;
            const passed = Object.values(answers).filter(v => v === true).length;
            if (total > 0) {
              checklistTotal++;
              if (passed === total) checklistPasses++;
            }
          }
        });

        return {
          count: subgroup.length,
          avg_duration_minutes: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
          avg_risk_percent: risks.length > 0 ? risks.reduce((a, b) => a + b, 0) / risks.length : 0,
          checklist_pass_rate: checklistTotal > 0 ? (checklistPasses / checklistTotal) * 100 : 0,
        };
      };

      const winnersDetails = calcGroupDetails(winners);
      const losersDetails = calcGroupDetails(losers);

      // Identify key differences
      const key_differences: string[] = [];
      if (winnersDetails.checklist_pass_rate > losersDetails.checklist_pass_rate + 20) {
        key_differences.push(`Winners have ${(winnersDetails.checklist_pass_rate - losersDetails.checklist_pass_rate).toFixed(0)}% higher checklist compliance`);
      }
      if (losersDetails.avg_risk_percent > winnersDetails.avg_risk_percent * 1.3 && losersDetails.avg_risk_percent > 0) {
        key_differences.push(`Losers use ${((losersDetails.avg_risk_percent / winnersDetails.avg_risk_percent - 1) * 100).toFixed(0)}% higher risk`);
      }
      if (losersDetails.avg_duration_minutes < winnersDetails.avg_duration_minutes * 0.5 && losersDetails.avg_duration_minutes > 0) {
        key_differences.push(`Losers exit ${((1 - losersDetails.avg_duration_minutes / winnersDetails.avg_duration_minutes) * 100).toFixed(0)}% earlier than winners`);
      }

      return {
        playbook_name: playbook?.name || (pbId === 'unassigned' ? 'Unassigned' : 'Unknown'),
        winners: winnersDetails,
        losers: losersDetails,
        key_differences,
      };
    });

  // === REGIME BY PLAYBOOK ===
  const regime_by_playbook = Array.from(tradesByPlaybook.entries())
    .filter(([_, group]) => group.length >= 5)
    .map(([pbId, group]) => {
      const playbook = playbookMap.get(pbId);
      const rotational = group.filter(t => reviewMap.get(t.id)?.regime === 'rotational');
      const transitional = group.filter(t => reviewMap.get(t.id)?.regime === 'transitional');
      const noRegime = group.filter(t => !reviewMap.get(t.id)?.regime);

      return {
        playbook_name: playbook?.name || (pbId === 'unassigned' ? 'Unassigned' : 'Unknown'),
        rotational: calcGroupStats(rotational),
        transitional: calcGroupStats(transitional),
        no_regime: calcGroupStats(noRegime),
      };
    });

  // === RISK PATTERNS ===
  const winners = trades.filter(t => (t.net_pnl || 0) > 0);
  const losers = trades.filter(t => (t.net_pnl || 0) < 0);
  
  const winnersWithRisk = winners.filter(t => t.risk_percent);
  const losersWithRisk = losers.filter(t => t.risk_percent);
  
  const winnersAvgRisk = winnersWithRisk.length > 0 
    ? winnersWithRisk.reduce((sum, t) => sum + t.risk_percent, 0) / winnersWithRisk.length 
    : 0;
  const losersAvgRisk = losersWithRisk.length > 0 
    ? losersWithRisk.reduce((sum, t) => sum + t.risk_percent, 0) / losersWithRisk.length 
    : 0;

  // Risk after previous trade result
  let riskAfterLoss = 0;
  let riskAfterWin = 0;
  let afterLossCount = 0;
  let afterWinCount = 0;

  const sortedTrades = [...trades].sort((a, b) => 
    new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime()
  );

  for (let i = 1; i < sortedTrades.length; i++) {
    const current = sortedTrades[i];
    const previous = sortedTrades[i - 1];
    
    if (current.risk_percent && previous.net_pnl !== null) {
      if (previous.net_pnl < 0) {
        riskAfterLoss += current.risk_percent;
        afterLossCount++;
      } else if (previous.net_pnl > 0) {
        riskAfterWin += current.risk_percent;
        afterWinCount++;
      }
    }
  }

  const risk_patterns = {
    winners_avg_risk: winnersAvgRisk,
    losers_avg_risk: losersAvgRisk,
    risk_after_loss: afterLossCount > 0 ? riskAfterLoss / afterLossCount : 0,
    risk_after_win: afterWinCount > 0 ? riskAfterWin / afterWinCount : 0,
    over_risking_on_losers: losersAvgRisk > winnersAvgRisk * 1.2,
  };

  // === SAMPLE SIZES ===
  const sample_sizes = {
    total_trades: trades.length,
    trades_with_checklist: tradesWithFullPass.length + tradesWithPartialPass.length,
    trades_with_emotional_state: Array.from(tradesByEmotionalState.entries())
      .filter(([state]) => state !== 'unknown')
      .reduce((sum, [_, group]) => sum + group.length, 0),
    trades_with_regime: regime_by_playbook.reduce((sum, r) => sum + r.rotational.trades + r.transitional.trades, 0),
  };

  return {
    checklist_correlation,
    emotional_impact,
    winner_loser_comparison,
    regime_by_playbook,
    risk_patterns,
    sample_sizes,
  };
}

async function generateAIAnalysis(
  playbooks: any[],
  playbookComparison: PlaybookPerformance[],
  symbolPerformance: SymbolPerformance[],
  sessionMatrix: SessionMatrixEntry[],
  journalInsights: JournalInsights,
  dayOfWeek: DayPerformance[],
  riskAnalysis: RiskAnalysis,
  behavioralAnalytics: BehavioralAnalytics,
  recentTrades: any[],
  reviews: any[]
): Promise<any> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    console.log('[trade-analytics] LOVABLE_API_KEY not configured, skipping AI analysis');
    return null;
  }

  // Minimum sample sizes for different types of advice
  const MIN_TRADES_PLAYBOOK_ADVICE = 10;
  const MIN_TRADES_CONFIDENT = 20;

  // Filter playbooks with sufficient data
  const playbooksWithSufficientData = playbookComparison.filter(p => p.trades >= MIN_TRADES_PLAYBOOK_ADVICE);
  const playbooksWithLimitedData = playbookComparison.filter(p => p.trades < MIN_TRADES_PLAYBOOK_ADVICE && p.trades > 0);

  // Prepare context for AI
  const aiContext = {
    // Sample size thresholds (tell AI what's reliable)
    thresholds: {
      playbook_advice: MIN_TRADES_PLAYBOOK_ADVICE,
      confident_recommendation: MIN_TRADES_CONFIDENT,
    },

    // Flag low-sample playbooks
    low_sample_playbooks: playbooksWithLimitedData.map(p => `${p.name} (${p.trades} trades)`),

    // Pre-computed behavioral analytics (the good stuff!)
    behavioral_analytics: {
      checklist_correlation: behavioralAnalytics.checklist_correlation,
      emotional_impact: behavioralAnalytics.emotional_impact,
      winner_loser_comparison: behavioralAnalytics.winner_loser_comparison,
      regime_by_playbook: behavioralAnalytics.regime_by_playbook,
      risk_patterns: behavioralAnalytics.risk_patterns,
      sample_sizes: behavioralAnalytics.sample_sizes,
    },

    // Playbooks with sufficient data
    playbooks_with_data: playbooksWithSufficientData.map(p => ({
      id: p.id,
      name: p.name,
      trades: p.trades,
      win_rate: p.win_rate,
      avg_r: p.avg_r,
      expectancy: p.expectancy,
    })),

    // Playbook rules (for context)
    playbook_rules: playbooks.map(p => ({
      name: p.name,
      checklist_questions: p.checklist_questions,
      confirmation_rules: p.confirmation_rules,
      invalidation_rules: p.invalidation_rules,
      management_rules: p.management_rules,
      failure_modes: p.failure_modes,
    })),

    // Metrics
    metrics: {
      by_symbol: symbolPerformance.filter(s => s.trades >= 5),
      by_session_direction: sessionMatrix.filter(s => s.trades >= 5),
      by_day: dayOfWeek,
    },

    // Risk metrics
    risk_metrics: riskAnalysis,

    // Journal aggregates
    journal_aggregates: journalInsights,
  };

  const systemPrompt = `You are a trade execution analyst. Your goal is to find EXECUTION MISTAKES within the trader's approach, NOT to recommend avoiding setups.

CRITICAL RULES:
1. NEVER recommend "avoid playbook X" unless it has 20+ trades AND negative expectancy
2. For playbooks with <10 trades, DO NOT judge the playbook itself - focus on execution issues
3. Always compare WINNERS vs LOSERS within the same playbook using the behavioral_analytics.winner_loser_comparison data
4. Prioritize insights from behavioral data: checklist compliance, emotional state, risk sizing
5. If checklist_correlation shows partial_pass has worse outcomes than full_pass, that's a key insight
6. If risk_patterns shows over_risking_on_losers is true, that's a key insight
7. Check emotional_impact for states that correlate with losses

ANALYSIS HIERARCHY (in order of importance):
1. Checklist Compliance - Are losses correlated with skipped checklist items? (use behavioral_analytics.checklist_correlation)
2. Risk Management - Are losses larger because of over-sizing? (use behavioral_analytics.risk_patterns)
3. Emotional State - Do certain emotional states predict losses? (use behavioral_analytics.emotional_impact)
4. Winner vs Loser Patterns - What differs between winning and losing trades in same setup? (use behavioral_analytics.winner_loser_comparison)
5. Regime Match - Is the playbook being used in wrong regimes? (use behavioral_analytics.regime_by_playbook)

For each insight, CITE THE SPECIFIC NUMBERS from the behavioral data.

FORBIDDEN OUTPUTS:
- "Avoid [playbook]" with <20 trades
- "Skip [session]" without regime-specific breakdown
- Generic advice not grounded in the user's specific behavioral data
- Advice that ignores the sample sizes provided

OUTPUT FORMAT (strict JSON only):
{
  "mistake_mining": [
    {
      "definition": "string - specific, measurable execution mistake from behavioral data",
      "frequency": number,
      "total_r_lost": number,
      "expectancy_impact": number,
      "rule_change": "string - specific rule change",
      "skip_condition": "string - binary, testable condition",
      "sample_size": number,
      "confidence_level": "high|medium|low"
    }
  ],
  "recommendations": {
    "rule_updates": [
      {
        "trigger_condition": "string",
        "action": "string",
        "avoid": "string",
        "success_metric": "string"
      }
    ],
    "execution_updates": [
      {
        "trigger_condition": "string",
        "action": "string",
        "avoid": "string",
        "success_metric": "string"
      }
    ]
  },
  "playbook_grades": [
    {
      "playbook_id": "string",
      "playbook_name": "string",
      "grade": "A|B|C|D|F",
      "key_strength": "string - from winner_loser_comparison data",
      "key_weakness": "string - from winner_loser_comparison data",
      "focus_rule": "string - specific rule from the playbook",
      "sample_size": number
    }
  ],
  "edge_summary": {
    "what_works": ["string - specific conditions with numbers"],
    "what_fails": ["string - specific conditions with numbers"],
    "primary_leak": "string - biggest execution leak with numbers",
    "primary_edge": "string - strongest edge with numbers"
  },
  "insufficient_data": ["string - areas where more data is needed"]
}`;

  const userPrompt = `Analyze this trading behavioral data and provide execution-focused insights:

${JSON.stringify(aiContext, null, 2)}`;

  try {
    console.log('[trade-analytics] Calling Lovable AI for behavioral analysis...');
    
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[trade-analytics] AI Gateway error:', response.status, errorText);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      console.error('[trade-analytics] No content in AI response');
      return null;
    }

    // Parse the JSON response
    try {
      // Remove markdown code blocks if present
      let jsonContent = content.trim();
      if (jsonContent.startsWith('```json')) {
        jsonContent = jsonContent.slice(7);
      }
      if (jsonContent.startsWith('```')) {
        jsonContent = jsonContent.slice(3);
      }
      if (jsonContent.endsWith('```')) {
        jsonContent = jsonContent.slice(0, -3);
      }
      
      const parsed = JSON.parse(jsonContent.trim());
      console.log('[trade-analytics] AI analysis parsed successfully');
      return parsed;
    } catch (parseError) {
      console.error('[trade-analytics] Failed to parse AI response:', parseError);
      console.error('[trade-analytics] Raw content:', content.substring(0, 500));
      return null;
    }
  } catch (error) {
    console.error('[trade-analytics] AI analysis error:', error);
    return null;
  }
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

    // Fetch playbooks for names and rules
    const { data: playbooks } = await supabaseClient
      .from('playbooks')
      .select('*')
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

    // === BEHAVIORAL ANALYTICS ===
    const behavioral_analytics = computeBehavioralAnalytics(trades, reviews, playbookMap);
    console.log(`[trade-analytics] Behavioral analytics computed:`, {
      checklist_trades: behavioral_analytics.sample_sizes.trades_with_checklist,
      emotional_trades: behavioral_analytics.sample_sizes.trades_with_emotional_state,
    });

    // === AI ANALYSIS ===
    const ai_analysis = await generateAIAnalysis(
      playbooks || [],
      playbook_comparison,
      symbol_performance,
      session_matrix,
      journal_insights,
      day_of_week,
      risk_analysis,
      behavioral_analytics,
      trades,
      reviews
    );

    console.log(`[trade-analytics] Analysis complete, AI analysis: ${ai_analysis ? 'success' : 'skipped/failed'}`);

    return new Response(JSON.stringify({
      overview,
      playbook_comparison,
      symbol_performance,
      session_matrix,
      journal_insights,
      day_of_week,
      risk_analysis,
      behavioral_analytics,
      ai_analysis,
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
