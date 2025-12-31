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

interface TradeContext {
  id: string;
  symbol: string;
  direction: string;
  entry_price: number;
  total_lots: number;
  sl_initial: number | null;
  tp_initial: number | null;
  entry_time: string;
  playbook_name: string;
  playbook_id: string;
}

interface RecentTradeInfo {
  result: 'win' | 'loss';
  r_multiple: number;
  symbol: string;
  time_ago: string;
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

    const { 
      message, 
      conversationHistory, 
      trade, 
      playbook,
      isFirstMessage 
    } = await req.json();

    // Fetch recent trades for context on first message
    let recentTrades: RecentTradeInfo[] = [];
    if (isFirstMessage) {
      const { data: trades } = await supabase
        .from('trades')
        .select('net_pnl, r_multiple_actual, symbol, exit_time')
        .eq('user_id', user.id)
        .eq('is_open', false)
        .order('exit_time', { ascending: false })
        .limit(5);

      if (trades) {
        const now = new Date();
        recentTrades = trades.map((t: any) => {
          const exitTime = new Date(t.exit_time);
          const hoursAgo = Math.round((now.getTime() - exitTime.getTime()) / (1000 * 60 * 60));
          return {
            result: t.net_pnl > 0 ? 'win' : 'loss',
            r_multiple: t.r_multiple_actual || 0,
            symbol: t.symbol,
            time_ago: hoursAgo < 1 ? 'just now' : hoursAgo < 24 ? `${hoursAgo}h ago` : `${Math.round(hoursAgo / 24)}d ago`
          };
        });
      }
    }

    const systemPrompt = buildSystemPrompt(trade, playbook, recentTrades);
    const messages = buildMessages(systemPrompt, conversationHistory || [], message);

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
        tools: [
          {
            type: "function",
            function: {
              name: "extract_journal_data",
              description: "Extract structured journal data from the conversation to save to the trade review",
              parameters: {
                type: "object",
                properties: {
                  emotional_state_before: {
                    type: "string",
                    enum: ["great", "good", "calm", "confident", "focused", "alright", "okay", "normal", "rough", "anxious", "fomo", "revenge", "tilted", "exhausted"],
                    description: "The trader's emotional state before entering the trade"
                  },
                  regime: {
                    type: "string",
                    enum: ["rotational", "transitional"],
                    description: "The market regime - rotational (range-bound) or transitional (trending)"
                  },
                  psychology_notes: {
                    type: "string",
                    description: "Notes about the trader's psychology and mindset"
                  },
                  thoughts: {
                    type: "string",
                    description: "General thoughts and notes about the trade setup"
                  },
                  screenshot_description: {
                    type: "string",
                    description: "Description of what the screenshot shows"
                  },
                  screenshot_timeframe: {
                    type: "string",
                    description: "The timeframe shown in the screenshot"
                  }
                },
                additionalProperties: false
              }
            }
          }
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please wait a moment.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: 'Payment required. Please add credits.' }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const errorText = await response.text();
      console.error('AI gateway error:', response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const aiResponse = await response.json();
    const choice = aiResponse.choices?.[0];
    
    let assistantMessage = choice?.message?.content || '';
    let extractedData: any = null;
    let quickResponses: string[] = [];
    let shouldUploadScreenshot = false;

    // Check for tool calls
    if (choice?.message?.tool_calls) {
      for (const toolCall of choice.message.tool_calls) {
        if (toolCall.function?.name === 'extract_journal_data') {
          try {
            extractedData = JSON.parse(toolCall.function.arguments);
          } catch (e) {
            console.error('Failed to parse extracted data:', e);
          }
        }
      }
    }

    // Determine quick responses and next action based on message content
    const lowerMessage = assistantMessage.toLowerCase();
    
    if (lowerMessage.includes('how are you feeling') || lowerMessage.includes('emotional state')) {
      quickResponses = ['Focused', 'Calm', 'Confident', 'Anxious', 'FOMO'];
    } else if (lowerMessage.includes('rotational') || lowerMessage.includes('transitional') || lowerMessage.includes('regime')) {
      quickResponses = ['Rotational', 'Transitional'];
    } else if (lowerMessage.includes('screenshot') || lowerMessage.includes('upload')) {
      shouldUploadScreenshot = true;
      quickResponses = ['15m', '1H', '4H', 'Daily'];
    } else if (lowerMessage.includes('pressure') || lowerMessage.includes('revenge') || lowerMessage.includes('make it back')) {
      quickResponses = ['No pressure', 'A little', 'Yes, feeling pressure'];
    }

    return new Response(JSON.stringify({
      message: assistantMessage,
      extractedData,
      quickResponses,
      shouldUploadScreenshot,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Live journal chat error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'An error occurred' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function buildSystemPrompt(trade: TradeContext, playbook: any, recentTrades: RecentTradeInfo[]) {
  const recentTradesSummary = recentTrades.length > 0
    ? recentTrades.map(t => `${t.result === 'win' ? '✓' : '✗'} ${t.r_multiple >= 0 ? '+' : ''}${t.r_multiple.toFixed(1)}R ${t.symbol} (${t.time_ago})`).join(', ')
    : 'No recent closed trades';

  const lastTrade = recentTrades[0];
  const recentLossContext = lastTrade && lastTrade.result === 'loss' 
    ? `\nIMPORTANT: Their last trade was a loss of ${lastTrade.r_multiple.toFixed(1)}R on ${lastTrade.symbol}. Gently check if they're feeling pressure to recover.`
    : '';

  return `You are a live trade journaling assistant helping a trader document their active position in real-time.

CURRENT TRADE:
- Symbol: ${trade.symbol}
- Direction: ${trade.direction.toUpperCase()}
- Entry: ${trade.entry_price}
- Lots: ${trade.total_lots}
- SL: ${trade.sl_initial || 'Not set'}
- TP: ${trade.tp_initial || 'Not set'}
- Playbook: ${trade.playbook_name}

RECENT TRADES: ${recentTradesSummary}${recentLossContext}

PLAYBOOK RULES (${playbook.name}):
${playbook.confirmation_rules?.length ? `- Confirmations: ${playbook.confirmation_rules.join('; ')}` : ''}
${playbook.invalidation_rules?.length ? `- Invalidations: ${playbook.invalidation_rules.join('; ')}` : ''}
${playbook.management_rules?.length ? `- Management: ${playbook.management_rules.join('; ')}` : ''}
${playbook.failure_modes?.length ? `- Watch out for: ${playbook.failure_modes.join('; ')}` : ''}
${playbook.session_filter?.length ? `- Sessions: ${playbook.session_filter.join(', ')}` : ''}

YOUR ROLE:
1. Guide the trader through documenting this trade BEFORE they need to manage it
2. Ask ONE question at a time, keeping it conversational
3. Extract structured data from their responses (use the extract_journal_data tool)
4. Be supportive, not interrogating
5. If they mention anxiety, FOMO, or revenge - explore it gently

QUESTION FLOW (adapt based on conversation):
1. Screenshot - "Can you upload a screenshot? Which timeframe best shows your setup?"
2. Emotion - "How are you feeling going into this trade?" (offer: Focused, Calm, Confident, Anxious, FOMO)
3. Recent context - If recent loss, ask about pressure to recover
4. Regime - "Is the market rotational or transitional right now?"
5. Setup notes - "What made this a valid entry for your ${playbook.name} setup?"
6. Anything else - "Any other notes before we save this?"

STYLE:
- Short, focused messages (2-3 sentences max)
- Acknowledge their responses briefly before asking next question
- Use their playbook terminology when relevant
- End with a clear question or action

When you identify emotional states, regimes, or other structured data, use the extract_journal_data function to save it.`;
}

function buildMessages(systemPrompt: string, conversationHistory: Message[], userMessage: string) {
  const messages: any[] = [
    { role: 'system', content: systemPrompt }
  ];

  for (const msg of conversationHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }

  messages.push({ role: 'user', content: userMessage });

  return messages;
}
