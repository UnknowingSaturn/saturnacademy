import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authorization required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { message, conversationHistory, account_id, includeContext } = await req.json();

    // Only fetch context on first message or when explicitly requested
    let context = null;
    if (includeContext !== false || !conversationHistory?.length) {
      context = await prepareTradeContext(supabase, user.id, account_id);
    }

    const systemPrompt = buildSystemPrompt(context);
    const messages = buildMessages(systemPrompt, conversationHistory || [], message, context);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages,
        stream: false,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please wait a moment and try again.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: 'Payment required. Please add credits to continue.' }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const errorText = await response.text();
      console.error('AI gateway error:', response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const aiResponse = await response.json();
    const assistantMessage = aiResponse.choices?.[0]?.message?.content || 'I encountered an issue processing your request.';

    return new Response(JSON.stringify({
      message: assistantMessage,
      context_summary: context ? {
        total_trades: context.stats.total_trades,
        reviewed_trades: context.stats.reviewed_trades,
        playbook_count: context.playbooks.length,
      } : null
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Analytics chat error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'An error occurred' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function prepareTradeContext(supabase: any, userId: string, accountId?: string) {
  // Fetch trades with optional account filter
  let tradesQuery = supabase
    .from('trades')
    .select('*')
    .eq('user_id', userId)
    .eq('is_open', false)
    .eq('is_archived', false)
    .order('entry_time', { ascending: false })
    .limit(200);

  if (accountId) {
    tradesQuery = tradesQuery.eq('account_id', accountId);
  }

  const { data: trades, error: tradesError } = await tradesQuery;
  if (tradesError) {
    console.error('Error fetching trades:', tradesError);
    throw new Error('Failed to fetch trades');
  }

  // Fetch playbooks
  const { data: playbooks, error: playbooksError } = await supabase
    .from('playbooks')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true);

  if (playbooksError) {
    console.error('Error fetching playbooks:', playbooksError);
  }

  // Fetch trade reviews
  const tradeIds = (trades || []).map((t: any) => t.id);
  let reviews: any[] = [];
  if (tradeIds.length > 0) {
    const { data: reviewsData, error: reviewsError } = await supabase
      .from('trade_reviews')
      .select('*')
      .in('trade_id', tradeIds);

    if (reviewsError) {
      console.error('Error fetching reviews:', reviewsError);
    } else {
      reviews = reviewsData || [];
    }
  }

  // Build playbook map
  const playbookMap = new Map((playbooks || []).map((p: any) => [p.id, p]));
  const reviewMap = new Map((reviews || []).map((r: any) => [r.trade_id, r]));

  // Enrich trades with context
  const enrichedTrades = (trades || []).map((trade: any) => {
    const playbook = playbookMap.get(trade.playbook_id) as any;
    const review = reviewMap.get(trade.id) as any;
    
    return {
      trade_number: trade.trade_number,
      date: trade.entry_time?.split('T')[0],
      time: trade.entry_time?.split('T')[1]?.substring(0, 5),
      symbol: trade.symbol,
      direction: trade.direction,
      playbook_name: playbook?.name || 'No playbook',
      net_pnl: trade.net_pnl,
      r_multiple: trade.r_multiple_actual,
      session: trade.session,
      duration_minutes: trade.duration_seconds ? Math.round(trade.duration_seconds / 60) : null,
      risk_percent: trade.risk_percent,
      is_winner: trade.net_pnl > 0,
      // Review data
      review: review ? {
        score: review.score,
        emotional_state_before: review.emotional_state_before,
        emotional_state_after: review.emotional_state_after,
        regime: review.regime,
        news_risk: review.news_risk,
        checklist_answers: review.checklist_answers,
        mistakes: review.mistakes,
        did_well: review.did_well,
        to_improve: review.to_improve,
        thoughts: review.thoughts,
        psychology_notes: review.psychology_notes,
      } : null
    };
  });

  // Compute stats
  const winners = enrichedTrades.filter((t: any) => t.net_pnl > 0);
  const losers = enrichedTrades.filter((t: any) => t.net_pnl < 0);
  const reviewedTrades = enrichedTrades.filter((t: any) => t.review !== null);

  // Aggregate journal entries
  const allMistakes: string[] = [];
  const allDidWell: string[] = [];
  const allToImprove: string[] = [];
  const allThoughts: string[] = [];

  reviewedTrades.forEach((t: any) => {
    if (t.review.mistakes && Array.isArray(t.review.mistakes)) {
      allMistakes.push(...t.review.mistakes.filter((m: any) => m && typeof m === 'string'));
    }
    if (t.review.did_well && Array.isArray(t.review.did_well)) {
      allDidWell.push(...t.review.did_well.filter((d: any) => d && typeof d === 'string'));
    }
    if (t.review.to_improve && Array.isArray(t.review.to_improve)) {
      allToImprove.push(...t.review.to_improve.filter((i: any) => i && typeof i === 'string'));
    }
    if (t.review.thoughts && typeof t.review.thoughts === 'string' && t.review.thoughts.trim()) {
      allThoughts.push(t.review.thoughts);
    }
    if (t.review.psychology_notes && typeof t.review.psychology_notes === 'string' && t.review.psychology_notes.trim()) {
      allThoughts.push(t.review.psychology_notes);
    }
  });

  // Playbook performance stats
  const playbookStats = new Map();
  enrichedTrades.forEach((trade: any) => {
    const key = trade.playbook_name;
    if (!playbookStats.has(key)) {
      playbookStats.set(key, { trades: 0, wins: 0, totalR: 0, totalPnl: 0 });
    }
    const stats = playbookStats.get(key);
    stats.trades++;
    if (trade.is_winner) stats.wins++;
    stats.totalR += trade.r_multiple || 0;
    stats.totalPnl += trade.net_pnl || 0;
  });

  const playbookPerformance = Array.from(playbookStats.entries()).map(([name, stats]: [string, any]) => ({
    name,
    trades: stats.trades,
    wins: stats.wins,
    win_rate: stats.trades > 0 ? (stats.wins / stats.trades * 100).toFixed(1) : '0',
    avg_r: stats.trades > 0 ? (stats.totalR / stats.trades).toFixed(2) : '0',
    total_pnl: stats.totalPnl.toFixed(2),
  }));

  // Build playbook definitions for context
  const playbookDefinitions = (playbooks || []).map((p: any) => ({
    name: p.name,
    description: p.description,
    checklist_questions: p.checklist_questions,
    confirmation_rules: p.confirmation_rules,
    invalidation_rules: p.invalidation_rules,
    management_rules: p.management_rules,
    failure_modes: p.failure_modes,
    valid_regimes: p.valid_regimes,
    session_filter: p.session_filter,
    symbol_filter: p.symbol_filter,
    max_r_per_trade: p.max_r_per_trade,
    max_daily_loss_r: p.max_daily_loss_r,
  }));

  return {
    trades: enrichedTrades,
    playbooks: playbookDefinitions,
    stats: {
      total_trades: enrichedTrades.length,
      winners: winners.length,
      losers: losers.length,
      win_rate: enrichedTrades.length > 0 ? (winners.length / enrichedTrades.length * 100).toFixed(1) : '0',
      avg_r: enrichedTrades.length > 0 
        ? (enrichedTrades.reduce((sum: number, t: any) => sum + (t.r_multiple || 0), 0) / enrichedTrades.length).toFixed(2)
        : '0',
      total_pnl: enrichedTrades.reduce((sum: number, t: any) => sum + (t.net_pnl || 0), 0).toFixed(2),
      reviewed_trades: reviewedTrades.length,
      unreviewed_trades: enrichedTrades.length - reviewedTrades.length,
    },
    playbook_performance: playbookPerformance,
    journal_aggregates: {
      mistakes: allMistakes.slice(0, 50),
      did_well: allDidWell.slice(0, 50),
      to_improve: allToImprove.slice(0, 50),
      thoughts: allThoughts.slice(0, 20),
    }
  };
}

function buildSystemPrompt(context: any) {
  return `You are TradeGPT, an expert AI trading journal analyst. You have access to the trader's complete trade history, playbook definitions, and journal entries.

CORE PRINCIPLES:
1. BE SPECIFIC - Always cite trade numbers, dates, symbols, and exact data when making claims
2. ACKNOWLEDGE LIMITS - If data is insufficient (<10 trades for a pattern), say so clearly
3. ASK QUESTIONS - If you need more context or the user's journal is incomplete, ask them
4. VALIDATE BEFORE ADVISING - Check playbook rules against actual trade execution
5. NO GENERIC ADVICE - Only insights grounded in this specific trader's data
6. CONVERSATIONAL - You're having a dialogue, not generating a report

CAPABILITIES:
- Analyze playbook performance with statistical significance awareness
- Compare winners vs losers within same setup to find execution differences  
- Read and interpret journal entries (mistakes, did_well, psychology_notes)
- Validate if trades followed playbook rules using checklist_answers
- Identify recurring patterns in journal text
- Calculate and explain expectancy, R-multiples, profit factor
- Identify risk sizing patterns and emotional trading signals

RESPONSE GUIDELINES:
- Use natural conversational language with markdown formatting
- When citing data, reference specific trades: "Trade #5 on Dec 15 (XAUUSD buy, -1.02R)..."
- When data is limited: "You only have X trades with this playbook - more data needed for confident conclusions"
- When journal entries are empty: "I notice most trades don't have mistakes/did_well entries filled in - this limits what I can analyze about your execution patterns"
- Ask follow-up questions when relevant to dig deeper

FORBIDDEN:
- Making up patterns not supported by data
- Recommending "avoid playbook X" with <10 trades
- Generic trading advice not grounded in user's specific history
- Pretending to see data that doesn't exist

${context ? `
TRADER'S DATA CONTEXT:
---
Stats: ${context.stats.total_trades} trades | Win rate: ${context.stats.win_rate}% | Avg R: ${context.stats.avg_r} | Total P&L: $${context.stats.total_pnl}
Reviewed: ${context.stats.reviewed_trades} of ${context.stats.total_trades} trades have journal entries

Playbook Performance:
${context.playbook_performance.map((p: any) => `- ${p.name}: ${p.trades} trades, ${p.win_rate}% win rate, ${p.avg_r}R avg, $${p.total_pnl}`).join('\n')}

Journal Entries Found:
- Mistakes logged: ${context.journal_aggregates.mistakes.length}
- Did well logged: ${context.journal_aggregates.did_well.length}  
- To improve logged: ${context.journal_aggregates.to_improve.length}
- Thoughts/notes: ${context.journal_aggregates.thoughts.length}

${context.journal_aggregates.mistakes.length > 0 ? `Common mistakes mentioned: ${context.journal_aggregates.mistakes.slice(0, 10).join('; ')}` : 'No mistakes entries found in journals'}
${context.journal_aggregates.did_well.length > 0 ? `Things done well: ${context.journal_aggregates.did_well.slice(0, 10).join('; ')}` : ''}
${context.journal_aggregates.to_improve.length > 0 ? `Areas to improve: ${context.journal_aggregates.to_improve.slice(0, 10).join('; ')}` : ''}

Playbook Definitions:
${context.playbooks.map((p: any) => `
${p.name}:
- Checklist: ${JSON.stringify(p.checklist_questions || [])}
- Confirmations: ${JSON.stringify(p.confirmation_rules || [])}
- Invalidations: ${JSON.stringify(p.invalidation_rules || [])}
- Management: ${JSON.stringify(p.management_rules || [])}
- Failure Modes: ${JSON.stringify(p.failure_modes || [])}
- Valid Regimes: ${JSON.stringify(p.valid_regimes || [])}
- Sessions: ${JSON.stringify(p.session_filter || [])}
`).join('\n')}

Recent Trades (most recent first):
${context.trades.slice(0, 30).map((t: any) => {
  const reviewInfo = t.review 
    ? `| Score: ${t.review.score || '-'} | Emotion: ${t.review.emotional_state_before || '-'} | ${t.review.mistakes?.length ? 'Mistakes: ' + t.review.mistakes.join(', ') : ''}`
    : '| No review';
  return `#${t.trade_number} ${t.date} ${t.symbol} ${t.direction} ${t.playbook_name} | ${t.r_multiple?.toFixed(2) || '-'}R $${t.net_pnl?.toFixed(2) || '-'} ${reviewInfo}`;
}).join('\n')}
---
` : 'No trade data available yet.'}`;
}

function buildMessages(systemPrompt: string, conversationHistory: Message[], userMessage: string, context: any) {
  const messages: any[] = [
    { role: 'system', content: systemPrompt }
  ];

  // Add conversation history
  for (const msg of conversationHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }

  // Add current user message
  messages.push({ role: 'user', content: userMessage });

  return messages;
}
