import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PlaybookSuggestion {
  name?: string;
  description?: string;
  session_filter?: string[];
  symbol_filter?: string[];
  valid_regimes?: string[];
  entry_zone_rules?: {
    min_percentile?: number;
    max_percentile?: number;
    require_htf_alignment?: boolean;
  };
  confirmation_rules?: string[];
  invalidation_rules?: string[];
  management_rules?: string[];
  failure_modes?: string[];
  checklist_questions?: string[];
  max_r_per_trade?: number;
  max_daily_loss_r?: number;
  max_trades_per_session?: number;
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { message, currentPlaybook, conversationHistory } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    const systemPrompt = `You are an expert trading coach helping traders define their playbooks (trading strategies/setups).

Your job is to extract structured trading strategy information from the user's natural language description.

When the user describes their setup, extract and suggest:
1. **Name**: A short descriptive name for the playbook
2. **Description**: A 1-2 sentence description
3. **Session Filter**: Which trading sessions (tokyo, london, new_york_am, new_york_pm, off_hours)
4. **Symbol Filter**: Which instruments/pairs this applies to
5. **Valid Regimes**: Market conditions (rotational, transitional)
6. **Entry Zone Rules**: Where in the range entries should occur (percentiles 0-100, HTF alignment requirement)
7. **Confirmation Rules**: What confirmations are needed before entry
8. **Invalidation Rules**: What conditions invalidate the setup
9. **Management Rules**: How to manage the trade (SL moves, partials, etc.)
10. **Failure Modes**: Common ways this setup fails
11. **Checklist Questions**: Yes/No questions for pre-trade checklist
12. **Risk Limits**: Max R per trade, max daily loss in R, max trades per session

Be conversational and helpful. Ask clarifying questions when needed. When you have enough information, provide structured suggestions.

IMPORTANT: If the user's message is short or unclear, ask follow-up questions to gather more details. Suggest what information would help complete the playbook.

Respond in JSON format with two keys:
- "message": Your conversational response to the user (be encouraging and ask follow-up questions)
- "suggestions": An object with any playbook fields you can extract (only include fields you have information for)
- "followUpPrompts": An optional array of 2-3 short follow-up question suggestions the user can click

Example response:
{
  "message": "Great! I understand you trade rotation setups during London session. A few clarifying questions: Do you have specific entry zones within the range? What confirmations do you wait for?",
  "suggestions": {
    "name": "London Rotation",
    "session_filter": ["london"],
    "valid_regimes": ["rotational"],
    "description": "Rotation trade at London session open"
  },
  "followUpPrompts": ["Add entry confirmations", "Define failure modes", "Set risk limits"]
}

Current playbook state (if any): ${JSON.stringify(currentPlaybook || {})}`;

    // Build messages array with conversation history
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt }
    ];

    // Add conversation history if provided
    if (conversationHistory && Array.isArray(conversationHistory)) {
      for (const msg of conversationHistory) {
        if (msg.role && msg.content) {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
    }

    // Add current user message
    messages.push({ role: 'user', content: message });

    console.log('Sending request with', messages.length, 'messages');

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: messages,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: 'Payment required. Please add credits to your workspace.' }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const errorText = await response.text();
      console.error('AI gateway error:', response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    // Try to parse as JSON
    let result: { message: string; suggestions: PlaybookSuggestion; followUpPrompts?: string[] } = { 
      message: content, 
      suggestions: {} as PlaybookSuggestion,
      followUpPrompts: []
    };
    try {
      // Find JSON in the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        result = {
          message: parsed.message || content,
          suggestions: parsed.suggestions || {},
          followUpPrompts: parsed.followUpPrompts || []
        };
      }
    } catch (e) {
      console.log('Could not parse JSON from response, using raw content');
      result.message = content;
    }

    console.log('Returning result with suggestions:', Object.keys(result.suggestions));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in playbook-assistant:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'Sorry, I encountered an error. Please try again.',
      suggestions: {}
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
