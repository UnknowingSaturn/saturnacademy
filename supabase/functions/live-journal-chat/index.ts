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

    console.log('Received message:', message);
    console.log('Conversation history length:', conversationHistory?.length || 0);

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

    const systemPrompt = buildSystemPrompt(trade, playbook, recentTrades, conversationHistory || []);
    const messages = buildMessages(systemPrompt, conversationHistory || [], message);

    console.log('System prompt length:', systemPrompt.length);
    console.log('Total messages to send:', messages.length);

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
              description: "Extract structured journal data from the conversation. IMPORTANT: After calling this, you MUST still provide a follow-up question in your text response and call suggest_quick_responses or request_screenshot for the next step.",
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
                  }
                },
                additionalProperties: false
              }
            }
          },
          {
            type: "function",
            function: {
              name: "request_screenshot",
              description: "Request the trader to upload a chart screenshot. Call this when you want them to share their chart setup.",
              parameters: {
                type: "object",
                properties: {
                  timeframe_suggestions: {
                    type: "array",
                    items: { type: "string" },
                    description: "Suggested timeframes to show (e.g., ['15m', '1H', '4H'])"
                  },
                  reason: {
                    type: "string",
                    description: "Brief reason for requesting the screenshot"
                  }
                },
                additionalProperties: false
              }
            }
          },
          {
            type: "function",
            function: {
              name: "suggest_quick_responses",
              description: "ALWAYS call this tool to suggest quick response buttons after asking a question. This makes it easy for the trader to respond quickly.",
              parameters: {
                type: "object",
                properties: {
                  responses: {
                    type: "array",
                    items: { type: "string" },
                    description: "List of 3-5 quick response options relevant to your question"
                  }
                },
                required: ["responses"],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: "auto",
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

    console.log('AI response received, tool_calls:', choice?.message?.tool_calls?.length || 0);

    // Check for tool calls
    if (choice?.message?.tool_calls) {
      for (const toolCall of choice.message.tool_calls) {
        console.log('Processing tool call:', toolCall.function?.name);
        
        if (toolCall.function?.name === 'extract_journal_data') {
          try {
            extractedData = JSON.parse(toolCall.function.arguments);
            console.log('Extracted data:', extractedData);
          } catch (e) {
            console.error('Failed to parse extracted data:', e);
          }
        }
        
        if (toolCall.function?.name === 'request_screenshot') {
          shouldUploadScreenshot = true;
          try {
            const args = JSON.parse(toolCall.function.arguments);
            if (args.timeframe_suggestions?.length) {
              quickResponses = args.timeframe_suggestions;
            }
            console.log('Screenshot requested with timeframes:', quickResponses);
          } catch (e) {
            console.error('Failed to parse screenshot request:', e);
          }
        }
        
        if (toolCall.function?.name === 'suggest_quick_responses') {
          try {
            const args = JSON.parse(toolCall.function.arguments);
            if (args.responses?.length) {
              quickResponses = args.responses;
            }
            console.log('Quick responses suggested:', quickResponses);
          } catch (e) {
            console.error('Failed to parse quick responses:', e);
          }
        }
      }
    }

    // Analyze current progress
    const progress = analyzeConversationProgress(conversationHistory || []);

    // CRITICAL FALLBACK: If AI gave a short response after extracting data, append follow-up
    if (extractedData && assistantMessage.length < 100 && !assistantMessage.includes('?')) {
      console.log('Short response detected after data extraction, appending follow-up question');
      const nextStep = getNextQuestion(progress, trade, playbook);
      assistantMessage = assistantMessage.trim() + ' ' + nextStep.question;
      
      if (quickResponses.length === 0) {
        quickResponses = nextStep.quickResponses;
      }
      if (nextStep.shouldUploadScreenshot) {
        shouldUploadScreenshot = true;
      }
    }

    // Fallback: Determine quick responses based on message content if no tool was called
    if (quickResponses.length === 0) {
      const lowerMessage = assistantMessage.toLowerCase();
      
      if (lowerMessage.includes('how are you feeling') || lowerMessage.includes('emotional state') || lowerMessage.includes('mindset')) {
        quickResponses = ['Focused', 'Calm', 'Confident', 'Anxious', 'FOMO'];
      } else if (lowerMessage.includes('rotational') || lowerMessage.includes('transitional') || lowerMessage.includes('regime')) {
        quickResponses = ['Rotational', 'Transitional'];
      } else if (lowerMessage.includes('screenshot') || lowerMessage.includes('chart') || lowerMessage.includes('upload')) {
        shouldUploadScreenshot = true;
        quickResponses = ['15m', '1H', '4H', 'Daily'];
      } else if (lowerMessage.includes('pressure') || lowerMessage.includes('revenge') || lowerMessage.includes('make it back')) {
        quickResponses = ['No pressure', 'A little', 'Yes, feeling pressure'];
      } else if (lowerMessage.includes('anything else') || lowerMessage.includes('notes')) {
        quickResponses = ['No, that covers it', 'One more thing...'];
      }
    }

    // FINAL SAFETY: If still no quick responses after all processing, use next step
    if (quickResponses.length === 0) {
      console.log('No quick responses after all processing, using next step fallback');
      const nextStep = getNextQuestion(progress, trade, playbook);
      quickResponses = nextStep.quickResponses;
      
      if (nextStep.shouldUploadScreenshot && !shouldUploadScreenshot) {
        shouldUploadScreenshot = true;
      }
    }

    console.log('Final response - message length:', assistantMessage.length, 'quickResponses:', quickResponses.length, 'shouldUploadScreenshot:', shouldUploadScreenshot);

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

interface ConversationProgress {
  hasEmotion: boolean; 
  hasScreenshot: boolean; 
  hasRegime: boolean; 
  hasSetupNotes: boolean;
  messageCount: number;
}

function analyzeConversationProgress(history: Message[]): ConversationProgress {
  const userMessages = history.filter(m => m.role === 'user').map(m => m.content.toLowerCase());
  const allContent = userMessages.join(' ');
  
  return {
    hasEmotion: /focused|calm|confident|anxious|fomo|great|good|nervous|excited|normal|okay|rough|tilted|exhausted|alright/i.test(allContent),
    hasScreenshot: /screenshot|uploaded|chart|image|here's|attached/i.test(allContent),
    hasRegime: /rotational|transitional|ranging|trending|sideways/i.test(allContent),
    hasSetupNotes: userMessages.some(m => m.length > 50),
    messageCount: userMessages.length,
  };
}

function getNextQuestion(progress: ConversationProgress, trade: TradeContext, playbook: any): {
  question: string;
  quickResponses: string[];
  shouldUploadScreenshot: boolean;
} {
  if (!progress.hasEmotion) {
    return {
      question: "How are you feeling going into this position?",
      quickResponses: ['Focused', 'Calm', 'Confident', 'Anxious', 'FOMO'],
      shouldUploadScreenshot: false
    };
  }
  if (!progress.hasScreenshot) {
    return {
      question: "Can you share a screenshot of your entry setup?",
      quickResponses: ['15m', '1H', '4H', 'Daily'],
      shouldUploadScreenshot: true
    };
  }
  if (!progress.hasRegime) {
    return {
      question: "Is the market currently rotational or transitional?",
      quickResponses: ['Rotational', 'Transitional'],
      shouldUploadScreenshot: false
    };
  }
  if (!progress.hasSetupNotes) {
    return {
      question: `What made this a valid ${playbook?.name || 'playbook'} entry for you?`,
      quickResponses: ['Clean setup', 'Took a chance', 'All confirmations hit'],
      shouldUploadScreenshot: false
    };
  }
  return {
    question: "Any concerns or notes to remember for this trade?",
    quickResponses: ['No concerns', 'One thing...', 'All good'],
    shouldUploadScreenshot: false
  };
}

function buildSystemPrompt(trade: TradeContext, playbook: any, recentTrades: RecentTradeInfo[], conversationHistory: Message[]) {
  const recentTradesSummary = recentTrades.length > 0
    ? recentTrades.map(t => `${t.result === 'win' ? '✓' : '✗'} ${t.r_multiple >= 0 ? '+' : ''}${t.r_multiple.toFixed(1)}R ${t.symbol} (${t.time_ago})`).join(', ')
    : 'No recent closed trades';

  const lastTrade = recentTrades[0];
  const recentLossContext = lastTrade && lastTrade.result === 'loss' 
    ? `\nIMPORTANT: Their last trade was a loss of ${lastTrade.r_multiple.toFixed(1)}R on ${lastTrade.symbol}. Gently check if they're feeling pressure to recover.`
    : '';

  // Analyze what's been discussed
  const progress = analyzeConversationProgress(conversationHistory);
  
  let progressNote = '';
  if (progress.messageCount > 0) {
    const discussed = [];
    const notDiscussed = [];
    
    if (progress.hasEmotion) discussed.push('emotion'); else notDiscussed.push('emotion');
    if (progress.hasScreenshot) discussed.push('screenshot'); else notDiscussed.push('screenshot');
    if (progress.hasRegime) discussed.push('regime'); else notDiscussed.push('regime');
    if (progress.hasSetupNotes) discussed.push('setup notes'); else notDiscussed.push('setup notes');
    
    progressNote = `
CONVERSATION PROGRESS:
- Already covered: ${discussed.length > 0 ? discussed.join(', ') : 'nothing yet'}
- Still need to cover: ${notDiscussed.length > 0 ? notDiscussed.join(', ') : 'all done!'}
- Total user messages: ${progress.messageCount}

DO NOT ask about topics already covered. Move to the next uncovered topic.`;
  }

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
${progressNote}

YOUR ROLE:
1. Guide the trader through documenting this trade ONE QUESTION at a time
2. ALWAYS acknowledge their response briefly before asking the next question
3. Extract structured data using the extract_journal_data tool when you identify relevant info
4. Use suggest_quick_responses tool to provide easy tap-to-respond options
5. Use request_screenshot tool when you want them to share their chart
6. Be supportive and conversational, not interrogating
7. If they mention anxiety, FOMO, or revenge trading - explore it gently

STRICT QUESTION FLOW (follow in order, skip already-covered topics):
1. EMOTION: "How are you feeling going into this trade?" (use suggest_quick_responses with emotions)
2. SCREENSHOT: "Can you share a screenshot of your setup?" (use request_screenshot tool)
3. REGIME: "Is the market rotational or transitional?" (use suggest_quick_responses)
4. SETUP NOTES: "What made this a valid ${playbook.name} entry?"
5. CONCERNS: "Any concerns or notes to remember?"
6. WRAP UP: Summarize what was captured and wish them well

CRITICAL RULES:
- Ask ONE question at a time - wait for their response
- NEVER repeat a question that's already been answered
- ALWAYS use the tools to extract data and suggest responses
- Keep messages short (2-3 sentences max)
- End each message with a clear question or action

RESPONSE FORMAT (REQUIRED):
- After calling extract_journal_data, you MUST still provide a substantive text response
- EVERY response MUST end with a question about the NEXT topic in the flow
- Your text response should be: "Brief acknowledgment + follow-up question"
- Example: "Great, you're feeling focused - that's a solid mindset for this trade! Can you share a screenshot of your entry setup so I can see the context?"
- IMPORTANT: Just calling a tool is NOT enough. You must ALWAYS include the next question in your text response.

When you identify emotional states, regimes, or other structured data in their responses, ALWAYS call extract_journal_data to save it AND ask about the next topic.`;
}

function buildMessages(systemPrompt: string, conversationHistory: Message[], userMessage: string) {
  const messages: any[] = [
    { role: 'system', content: systemPrompt }
  ];

  // Add all conversation history (which already includes the current user message from the client)
  for (const msg of conversationHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }

  // Only add the user message if it's not already the last message in history
  const lastHistoryMessage = conversationHistory[conversationHistory.length - 1];
  if (!lastHistoryMessage || lastHistoryMessage.content !== userMessage || lastHistoryMessage.role !== 'user') {
    messages.push({ role: 'user', content: userMessage });
  }

  return messages;
}