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

// Step machine types
type JournalStep = 'emotion' | 'screenshot' | 'regime' | 'setup' | 'concerns' | 'wrapup';

interface StepProgress {
  completedSteps: Set<JournalStep>;
  awaitingStep: JournalStep | null;
  currentStep: JournalStep;
  lastAssistantQuestion: string | null;
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

    // Use step machine to analyze progress
    const stepProgress = analyzeStepProgress(conversationHistory || []);
    console.log('Step progress:', {
      completedSteps: Array.from(stepProgress.completedSteps),
      awaitingStep: stepProgress.awaitingStep,
      currentStep: stepProgress.currentStep,
    });

    const systemPrompt = buildSystemPrompt(trade, playbook, recentTrades, stepProgress);
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

    // Server-side heuristic extraction for short answers
    if (message && stepProgress.awaitingStep) {
      const userAnswer = message.trim().toLowerCase();
      
      // Extract regime from short answers
      if (stepProgress.awaitingStep === 'regime' && !extractedData?.regime) {
        if (userAnswer.includes('rotational') || userAnswer.includes('ranging') || userAnswer.includes('range')) {
          extractedData = { ...(extractedData || {}), regime: 'rotational' };
          console.log('Server-side regime extraction: rotational');
        } else if (userAnswer.includes('transitional') || userAnswer.includes('trending') || userAnswer.includes('trend')) {
          extractedData = { ...(extractedData || {}), regime: 'transitional' };
          console.log('Server-side regime extraction: transitional');
        }
      }
      
      // Extract setup notes from short answers
      if (stepProgress.awaitingStep === 'setup' && !extractedData?.thoughts) {
        extractedData = { ...(extractedData || {}), thoughts: message.trim() };
        console.log('Server-side setup notes extraction:', message.trim());
      }
      
      // Extract concerns from short answers
      if (stepProgress.awaitingStep === 'concerns' && !extractedData?.psychology_notes) {
        if (userAnswer.includes('no concern') || userAnswer.includes('all good') || userAnswer.includes('none')) {
          extractedData = { ...(extractedData || {}), psychology_notes: 'No concerns noted.' };
        } else {
          extractedData = { ...(extractedData || {}), psychology_notes: message.trim() };
        }
        console.log('Server-side concerns extraction');
      }
    }

    // Update progress after this message (user just replied to awaitingStep)
    const updatedProgress = { ...stepProgress };
    if (stepProgress.awaitingStep && message) {
      updatedProgress.completedSteps.add(stepProgress.awaitingStep);
    }
    
    // Determine next step
    const nextStep = getNextStep(updatedProgress.completedSteps);
    console.log('Next step determined:', nextStep);

    // CRITICAL FALLBACK: Ensure response has proper follow-up
    const hasQuestion = assistantMessage.includes('?');
    const isShortResponse = assistantMessage.length < 100;

    if ((isShortResponse || !hasQuestion) && nextStep !== 'wrapup') {
      console.log('Short/no-question response detected, appending follow-up');
      const nextQ = getStepQuestion(nextStep, trade, playbook);
      
      if (!hasQuestion) {
        assistantMessage = assistantMessage.trim() + ' ' + nextQ.question;
      }
      
      if (quickResponses.length === 0) {
        quickResponses = nextQ.quickResponses;
      }
      if (nextQ.shouldUploadScreenshot) {
        shouldUploadScreenshot = true;
      }
    }

    // REPEAT GUARD: If assistant is asking about a step already completed, override
    const askedStep = classifyAssistantQuestion(assistantMessage);
    if (askedStep && updatedProgress.completedSteps.has(askedStep) && nextStep !== 'wrapup') {
      console.log('Repeat guard activated: AI asked about completed step', askedStep, '-> forcing', nextStep);
      const nextQ = getStepQuestion(nextStep, trade, playbook);
      
      // Replace the repeated question with next step's question
      assistantMessage = assistantMessage.replace(/\?[^?]*$/, '').trim() + ' ' + nextQ.question;
      quickResponses = nextQ.quickResponses;
      shouldUploadScreenshot = nextQ.shouldUploadScreenshot;
    }

    // Fallback: Determine quick responses based on message content if still empty
    if (quickResponses.length === 0) {
      const lowerMessage = assistantMessage.toLowerCase();
      
      if (lowerMessage.includes('how are you feeling') || lowerMessage.includes('emotional state') || lowerMessage.includes('mindset')) {
        quickResponses = ['Focused', 'Calm', 'Confident', 'Anxious', 'FOMO'];
      } else if (lowerMessage.includes('rotational') || lowerMessage.includes('transitional') || lowerMessage.includes('regime')) {
        quickResponses = ['Rotational', 'Transitional'];
      } else if (lowerMessage.includes('screenshot') || lowerMessage.includes('chart') || lowerMessage.includes('upload')) {
        shouldUploadScreenshot = true;
        quickResponses = ['15m', '1H', '4H', 'Daily'];
      } else if (lowerMessage.includes('concern') || lowerMessage.includes('notes to remember')) {
        quickResponses = ['No concerns', 'One thing...', 'All good'];
      } else if (lowerMessage.includes('valid') || lowerMessage.includes('entry') || lowerMessage.includes('setup')) {
        quickResponses = ['Clean setup', 'Took a chance', 'All confirmations hit'];
      } else if (lowerMessage.includes('all set') || lowerMessage.includes('anything else') || lowerMessage.includes('summarize')) {
        quickResponses = ['All set!', 'Add one more note'];
      }
    }

    // FINAL SAFETY: If still no quick responses, use next step
    if (quickResponses.length === 0 && nextStep !== 'wrapup') {
      console.log('No quick responses, using next step fallback');
      const nextQ = getStepQuestion(nextStep, trade, playbook);
      quickResponses = nextQ.quickResponses;
      shouldUploadScreenshot = nextQ.shouldUploadScreenshot || shouldUploadScreenshot;
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

// Classify what step an assistant message is asking about
function classifyAssistantQuestion(text: string): JournalStep | null {
  const lower = text.toLowerCase();
  
  if (/how.*feeling|emotion|mindset|going into/i.test(lower)) return 'emotion';
  if (/screenshot|upload.*chart|share.*setup|share.*chart/i.test(lower)) return 'screenshot';
  if (/rotational|transitional|regime|market.*condition/i.test(lower)) return 'regime';
  if (/what made.*valid|why.*valid|setup|entry.*reason/i.test(lower)) return 'setup';
  if (/concern|notes to remember|anything else.*add|one more/i.test(lower)) return 'concerns';
  if (/all set|summarize|recap|good luck/i.test(lower)) return 'wrapup';
  
  return null;
}

// Analyze conversation to determine step progress using step machine
function analyzeStepProgress(history: Message[]): StepProgress {
  const completedSteps = new Set<JournalStep>();
  let awaitingStep: JournalStep | null = null;
  let lastAssistantQuestion: string | null = null;

  // Walk through conversation in order
  for (let i = 0; i < history.length; i++) {
    const msg = history[i];
    
    if (msg.role === 'assistant') {
      // Classify what step this assistant message is asking about
      const step = classifyAssistantQuestion(msg.content);
      if (step) {
        awaitingStep = step;
        lastAssistantQuestion = msg.content;
      }
    } else if (msg.role === 'user' && awaitingStep) {
      // User replied to an awaited step - mark it complete
      completedSteps.add(awaitingStep);
      awaitingStep = null; // Clear until next assistant question
    }
  }

  // Determine current step (next uncompleted)
  const currentStep = getNextStep(completedSteps);

  return {
    completedSteps,
    awaitingStep,
    currentStep,
    lastAssistantQuestion,
  };
}

// Get next uncompleted step
function getNextStep(completedSteps: Set<JournalStep>): JournalStep {
  const stepOrder: JournalStep[] = ['emotion', 'screenshot', 'regime', 'setup', 'concerns', 'wrapup'];
  
  for (const step of stepOrder) {
    if (!completedSteps.has(step)) {
      return step;
    }
  }
  
  return 'wrapup';
}

// Get question and quick responses for a specific step
function getStepQuestion(step: JournalStep, trade: TradeContext, playbook: any): {
  question: string;
  quickResponses: string[];
  shouldUploadScreenshot: boolean;
} {
  switch (step) {
    case 'emotion':
      return {
        question: "How are you feeling going into this position?",
        quickResponses: ['Focused', 'Calm', 'Confident', 'Anxious', 'FOMO'],
        shouldUploadScreenshot: false
      };
    case 'screenshot':
      return {
        question: "Can you share a screenshot of your entry setup?",
        quickResponses: ['15m', '1H', '4H', 'Daily'],
        shouldUploadScreenshot: true
      };
    case 'regime':
      return {
        question: "Is the market currently rotational or transitional?",
        quickResponses: ['Rotational', 'Transitional'],
        shouldUploadScreenshot: false
      };
    case 'setup':
      return {
        question: `What made this a valid ${playbook?.name || 'playbook'} entry for you?`,
        quickResponses: ['Clean setup', 'Took a chance', 'All confirmations hit'],
        shouldUploadScreenshot: false
      };
    case 'concerns':
      return {
        question: "Any concerns or notes to remember for this trade?",
        quickResponses: ['No concerns', 'One thing...', 'All good'],
        shouldUploadScreenshot: false
      };
    case 'wrapup':
      return {
        question: "Great, I've captured everything! Want a quick summary, or are you all set?",
        quickResponses: ['Summarize', 'Add one more note', 'All set!'],
        shouldUploadScreenshot: false
      };
    default:
      return {
        question: "Anything else you'd like to add?",
        quickResponses: ['No, that covers it', 'One more thing...'],
        shouldUploadScreenshot: false
      };
  }
}

function buildSystemPrompt(trade: TradeContext, playbook: any, recentTrades: RecentTradeInfo[], stepProgress: StepProgress) {
  const recentTradesSummary = recentTrades.length > 0
    ? recentTrades.map(t => `${t.result === 'win' ? '✓' : '✗'} ${t.r_multiple >= 0 ? '+' : ''}${t.r_multiple.toFixed(1)}R ${t.symbol} (${t.time_ago})`).join(', ')
    : 'No recent closed trades';

  const lastTrade = recentTrades[0];
  const recentLossContext = lastTrade && lastTrade.result === 'loss' 
    ? `\nIMPORTANT: Their last trade was a loss of ${lastTrade.r_multiple.toFixed(1)}R on ${lastTrade.symbol}. Gently check if they're feeling pressure to recover.`
    : '';

  // Build progress note from step machine
  const completedList = Array.from(stepProgress.completedSteps);
  const allSteps: JournalStep[] = ['emotion', 'screenshot', 'regime', 'setup', 'concerns'];
  const remainingSteps = allSteps.filter(s => !stepProgress.completedSteps.has(s));

  const progressNote = `
CONVERSATION PROGRESS (CRITICAL - READ THIS):
- COMPLETED: ${completedList.length > 0 ? completedList.join(', ') : 'nothing yet'}
- REMAINING: ${remainingSteps.length > 0 ? remainingSteps.join(', ') : 'all done - wrap up!'}
- NEXT STEP: ${stepProgress.currentStep}

DO NOT ask about completed topics. The user already answered those. Move to: ${stepProgress.currentStep}`;

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

STRICT QUESTION FLOW (follow in order, SKIP completed topics):
1. EMOTION: "How are you feeling going into this trade?" (use suggest_quick_responses with emotions)
2. SCREENSHOT: "Can you share a screenshot of your setup?" (use request_screenshot tool)
3. REGIME: "Is the market rotational or transitional?" (use suggest_quick_responses)
4. SETUP NOTES: "What made this a valid ${playbook.name} entry?"
5. CONCERNS: "Any concerns or notes to remember?"
6. WRAP UP: Summarize what was captured and wish them well

CRITICAL RULES:
- Ask ONE question at a time - wait for their response
- NEVER repeat a question that's already been answered (check COMPLETED list above)
- ALWAYS use the tools to extract data and suggest responses
- Keep messages short (2-3 sentences max)
- End each message with a clear question about the NEXT topic
- The user's short answers like "Focused", "Rotational", "All confirmations hit" ARE valid answers - accept them and move on

RESPONSE FORMAT (REQUIRED):
- After calling extract_journal_data, you MUST still provide a substantive text response
- EVERY response MUST end with a question about the NEXT topic in the flow
- Your text response should be: "Brief acknowledgment + follow-up question"
- Example: "Great, you're feeling focused - solid mindset! Can you share a screenshot of your entry setup?"
- IMPORTANT: Just calling a tool is NOT enough. You must ALWAYS include the next question.

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
