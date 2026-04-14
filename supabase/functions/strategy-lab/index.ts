import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AMT_KNOWLEDGE = `
# Auction Market Theory (AMT) Knowledge Base

You are a senior quantitative trader and strategist with deep expertise in Auction Market Theory, Market Profile, and Volume Profile analysis. You help traders refine their playbooks into mechanical or semi-mechanical trading strategies, and you can generate MQL5 Expert Advisor code.

## Core Auction Theory Principles

**Two-Way Auction Process**: Markets facilitate trade between buyers and sellers. Price moves directionally to find levels where two-sided trade occurs (balance). When one side dominates, price trends until it finds new balance.

**Value Area (VA)**: The price range where approximately 70% of trading activity occurred. Defined by Value Area High (VAH) and Value Area Low (VAL). The Point of Control (POC) is the price level with the highest volume/TPO count within the value area.

**Balance vs Imbalance**: 
- Balance (rotation): Price oscillates within a range, VA is relatively narrow, two-sided trade dominates. Favor mean-reversion entries at VA extremes.
- Imbalance (trend): One-timeframe directional movement, VA expanding in one direction. Favor continuation entries on pullbacks.

**Initiative vs Responsive Activity**:
- Initiative: Activity that moves price away from value (breakouts beyond VA). Indicates conviction.
- Responsive: Activity that returns price to value (rejections at VA extremes). Indicates fair value acceptance.

## Market Profile Concepts

**TPO (Time Price Opportunity)**: Each 30-minute period's price range printed as a letter. Building blocks of the profile.

**Initial Balance (IB)**: The range established in the first hour of trading (first two TPO periods). 
- Wide IB suggests range-bound day.
- Narrow IB suggests potential for range extension.
- IB extensions: Price breaking above/below IB signals directional conviction.

**Day Types**:
- Normal Day: 85% of range within IB. Rare, very balanced.
- Normal Variation: Range extends slightly beyond IB (1x IB range). Most common.
- Trend Day: Continuous one-directional movement, narrow profiles, little overlap between periods. Strong conviction.
- Double Distribution: Two separate value areas within one session. Indicates a shift in value.
- P-Shape Profile: Long liquidation or short covering rally. High volume at upper end. Often exhaustion.
- b-Shape Profile: Long accumulation at lows or selling climax. High volume at lower end.

**Single Prints (Poor Structure)**: TPOs that appear only once in a period, creating thin areas in the profile. These represent fast, initiative-driven moves and often act as support/resistance.

**Poor Highs/Lows**: Session extremes with wide, flat TPO prints (no tailing/excess). Indicate unfinished business — price likely to revisit these levels.

**Excess**: Sharp, aggressive tails at session extremes with single TPOs. Indicate strong rejection and completed auction. Less likely to be revisited.

## Volume Profile Concepts

**VPOC (Volume Point of Control)**: The price with the highest traded volume. Strongest magnet for price.

**High Volume Nodes (HVN)**: Price levels with significant volume accumulation. Act as magnets — price tends to consolidate around HVNs. Represent acceptance/fair value.

**Low Volume Nodes (LVN)**: Price levels with minimal volume. Act as barriers — price moves quickly through LVNs. Represent rejection/unfair value. Good entry/exit zones.

**Developing vs Composite Profiles**:
- Developing: Built intraday, shows current session's value.
- Composite: Multiple sessions combined, shows longer-term value areas.
- Naked POC: A previous session's POC that hasn't been revisited. Acts as a magnet.

**Value Area Migration**: Track how the value area shifts day-to-day:
- Higher VA = bullish sentiment shift
- Lower VA = bearish sentiment shift
- Overlapping VA = balance continuation

## Practical Trading Applications

**Rotation Entries (Mean Reversion)**:
1. Identify balance area using composite VA
2. Wait for price to reach VAH or VAL
3. Look for responsive activity (rejection candles, volume climax)
4. Enter toward POC with stop beyond VA extreme
5. Target: POC or opposing VA boundary

**Breakout Entries (Trend Following)**:
1. Identify balance area and IB
2. Wait for IB extension with conviction (volume, single prints forming)
3. Enter on pullback to broken level (old VAH/VAL becomes support/resistance)
4. Stop below the pullback low (buy) or above pullback high (sell)
5. Target: Next composite VA or measured move

**Naked POC Plays**:
1. Identify unfilled POCs from previous sessions
2. As price approaches, watch for acceptance vs rejection
3. If accepted (price consolidates at POC level) = value shift
4. If rejected = continuation away from that level

## MQL5 Code Generation Guidelines

When generating MQL5 Expert Advisors:
- Use Session Volume Profile calculated from tick volume on the chart timeframe
- Implement proper money management (risk per trade as % of balance)
- Include session time filters matching the playbook's session_filter
- Add safety guards: max trades per session, max daily loss, max drawdown
- Use pending orders or market orders based on entry zone type
- Implement trailing stops and partial close logic per management_rules
- Add proper logging via Print() for debugging
- Structure code with clear OnInit(), OnTick(), and helper functions
- Include input parameters for all tunable values
- Handle partial closes correctly with position sizing

Always explain your reasoning using AMT concepts. Reference specific profile structures, day types, and auction dynamics when analyzing setups or suggesting improvements.
`;

const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "update_playbook_rules",
      description: "Update specific rule arrays on the active playbook. Use this when the user agrees to a rule change or asks you to add/remove/modify rules. Supported fields: confirmation_rules, invalidation_rules, management_rules, failure_modes.",
      parameters: {
        type: "object",
        properties: {
          field: {
            type: "string",
            enum: ["confirmation_rules", "invalidation_rules", "management_rules", "failure_modes"],
            description: "Which rule array to update",
          },
          action: {
            type: "string",
            enum: ["add", "remove", "replace"],
            description: "Whether to add a new rule, remove an existing one, or replace the entire array",
          },
          value: {
            type: "string",
            description: "For 'add': the new rule text. For 'remove': the exact rule text to remove.",
          },
          values: {
            type: "array",
            items: { type: "string" },
            description: "For 'replace': the complete new array of rules.",
          },
        },
        required: ["field", "action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_risk_limits",
      description: "Update risk management limits on the active playbook.",
      parameters: {
        type: "object",
        properties: {
          max_r_per_trade: { type: "number", description: "Maximum R per trade" },
          max_daily_loss_r: { type: "number", description: "Maximum daily loss in R" },
          max_trades_per_session: { type: "integer", description: "Maximum trades per session" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_filters",
      description: "Update symbol, session, or regime filters on the active playbook.",
      parameters: {
        type: "object",
        properties: {
          symbol_filter: { type: "array", items: { type: "string" }, description: "Symbols to trade" },
          session_filter: { type: "array", items: { type: "string" }, description: "Sessions to trade in" },
          valid_regimes: { type: "array", items: { type: "string" }, description: "Valid market regimes" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_checklist_question",
      description: "Add a new pre-trade checklist question to the active playbook.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "The checklist question text" },
          category: { type: "string", description: "Category: entry, confirmation, risk, context" },
        },
        required: ["question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_playbook_description",
      description: "Update the playbook name or description.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "New playbook name" },
          description: { type: "string", description: "New playbook description" },
        },
      },
    },
  },
];

async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  playbookId: string,
  serviceClient: ReturnType<typeof createClient>
): Promise<{ success: boolean; message: string; change?: Record<string, unknown> }> {
  try {
    // Fetch current playbook
    const { data: playbook, error: fetchErr } = await serviceClient
      .from("playbooks")
      .select("*")
      .eq("id", playbookId)
      .single();

    if (fetchErr || !playbook) {
      return { success: false, message: "Could not find playbook" };
    }

    switch (toolName) {
      case "update_playbook_rules": {
        const field = args.field as string;
        const action = args.action as string;
        const currentRules = (playbook[field] as string[]) || [];
        let newRules: string[];
        let changeDesc: string;

        if (action === "add" && args.value) {
          newRules = [...currentRules, args.value as string];
          changeDesc = `Added to ${field}: "${args.value}"`;
        } else if (action === "remove" && args.value) {
          newRules = currentRules.filter((r) => r !== args.value);
          changeDesc = `Removed from ${field}: "${args.value}"`;
        } else if (action === "replace" && args.values) {
          newRules = args.values as string[];
          changeDesc = `Replaced ${field} with ${newRules.length} rules`;
        } else {
          return { success: false, message: "Invalid action/value combination" };
        }

        const { error } = await serviceClient
          .from("playbooks")
          .update({ [field]: newRules })
          .eq("id", playbookId);

        if (error) return { success: false, message: error.message };
        return {
          success: true,
          message: changeDesc,
          change: { field, action, old_value: currentRules, new_value: newRules },
        };
      }

      case "update_risk_limits": {
        const updates: Record<string, unknown> = {};
        const changes: string[] = [];

        if (args.max_r_per_trade !== undefined) {
          updates.max_r_per_trade = args.max_r_per_trade;
          changes.push(`max_r_per_trade: ${playbook.max_r_per_trade ?? "unset"} → ${args.max_r_per_trade}`);
        }
        if (args.max_daily_loss_r !== undefined) {
          updates.max_daily_loss_r = args.max_daily_loss_r;
          changes.push(`max_daily_loss_r: ${playbook.max_daily_loss_r ?? "unset"} → ${args.max_daily_loss_r}`);
        }
        if (args.max_trades_per_session !== undefined) {
          updates.max_trades_per_session = args.max_trades_per_session;
          changes.push(`max_trades_per_session: ${playbook.max_trades_per_session ?? "unset"} → ${args.max_trades_per_session}`);
        }

        const { error } = await serviceClient
          .from("playbooks")
          .update(updates)
          .eq("id", playbookId);

        if (error) return { success: false, message: error.message };
        return { success: true, message: `Updated: ${changes.join(", ")}`, change: { updates, old: { max_r_per_trade: playbook.max_r_per_trade, max_daily_loss_r: playbook.max_daily_loss_r, max_trades_per_session: playbook.max_trades_per_session } } };
      }

      case "update_filters": {
        const updates: Record<string, unknown> = {};
        const changes: string[] = [];

        if (args.symbol_filter) {
          updates.symbol_filter = args.symbol_filter;
          changes.push(`symbol_filter → [${(args.symbol_filter as string[]).join(", ")}]`);
        }
        if (args.session_filter) {
          updates.session_filter = args.session_filter;
          changes.push(`session_filter → [${(args.session_filter as string[]).join(", ")}]`);
        }
        if (args.valid_regimes) {
          updates.valid_regimes = args.valid_regimes;
          changes.push(`valid_regimes → [${(args.valid_regimes as string[]).join(", ")}]`);
        }

        const { error } = await serviceClient
          .from("playbooks")
          .update(updates)
          .eq("id", playbookId);

        if (error) return { success: false, message: error.message };
        return { success: true, message: `Updated filters: ${changes.join(", ")}`, change: { updates } };
      }

      case "add_checklist_question": {
        const currentChecklist = (playbook.checklist_questions as Array<Record<string, unknown>>) || [];
        const newQuestion = {
          id: crypto.randomUUID(),
          text: args.question as string,
          category: (args.category as string) || "general",
        };
        const newChecklist = [...currentChecklist, newQuestion];

        const { error } = await serviceClient
          .from("playbooks")
          .update({ checklist_questions: newChecklist })
          .eq("id", playbookId);

        if (error) return { success: false, message: error.message };
        return { success: true, message: `Added checklist question: "${args.question}"`, change: { question: newQuestion } };
      }

      case "update_playbook_description": {
        const updates: Record<string, unknown> = {};
        if (args.name) updates.name = args.name;
        if (args.description) updates.description = args.description;

        const { error } = await serviceClient
          .from("playbooks")
          .update(updates)
          .eq("id", playbookId);

        if (error) return { success: false, message: error.message };
        return { success: true, message: `Updated playbook: ${Object.keys(updates).join(", ")}`, change: updates };
      }

      default:
        return { success: false, message: `Unknown tool: ${toolName}` };
    }
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : "Tool execution failed" };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { messages, playbook_id, conversation_id, backtest_metrics } = await req.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "Messages required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch playbook context if selected
    let playbookContext = "";
    if (playbook_id) {
      const { data: playbook } = await supabase
        .from("playbooks")
        .select("*")
        .eq("id", playbook_id)
        .single();

      if (playbook) {
        playbookContext = `
## Active Playbook: "${playbook.name}"
${playbook.description ? `Description: ${playbook.description}` : ""}

### Entry Zone Rules
${JSON.stringify(playbook.entry_zone_rules || {}, null, 2)}

### Confirmation Rules
${(playbook.confirmation_rules || []).map((r: string, i: number) => `${i + 1}. ${r}`).join("\n")}

### Invalidation Rules
${(playbook.invalidation_rules || []).map((r: string, i: number) => `${i + 1}. ${r}`).join("\n")}

### Management Rules
${(playbook.management_rules || []).map((r: string, i: number) => `${i + 1}. ${r}`).join("\n")}

### Failure Modes
${(playbook.failure_modes || []).map((r: string, i: number) => `${i + 1}. ${r}`).join("\n")}

### Risk Limits
- Max R per trade: ${playbook.max_r_per_trade ?? "not set"}
- Max daily loss (R): ${playbook.max_daily_loss_r ?? "not set"}
- Max trades per session: ${playbook.max_trades_per_session ?? "not set"}

### Filters
- Symbols: ${(playbook.symbol_filter || []).join(", ") || "all"}
- Sessions: ${(playbook.session_filter || []).join(", ") || "all"}
- Valid regimes: ${(playbook.valid_regimes || []).join(", ") || "all"}

### Checklist Questions
${JSON.stringify(playbook.checklist_questions || [], null, 2)}
`;
      }
    }

    // Fetch recent trade stats
    let journalContext = "";
    try {
      const query = supabase
        .from("trades")
        .select("symbol, direction, session, net_pnl, r_multiple_actual, entry_time, exit_time, is_open, playbook_id")
        .eq("is_open", false)
        .order("exit_time", { ascending: false })
        .limit(30);

      if (playbook_id) {
        query.eq("playbook_id", playbook_id);
      }

      const { data: trades } = await query;

      if (trades && trades.length > 0) {
        const wins = trades.filter((t) => (t.net_pnl ?? 0) > 0).length;
        const losses = trades.filter((t) => (t.net_pnl ?? 0) < 0).length;
        const totalPnl = trades.reduce((s, t) => s + (t.net_pnl ?? 0), 0);
        const avgR = trades.filter((t) => t.r_multiple_actual != null).reduce((s, t) => s + (t.r_multiple_actual ?? 0), 0) / Math.max(1, trades.filter((t) => t.r_multiple_actual != null).length);

        const sessionStats: Record<string, { wins: number; total: number }> = {};
        for (const t of trades) {
          const s = t.session || "unknown";
          if (!sessionStats[s]) sessionStats[s] = { wins: 0, total: 0 };
          sessionStats[s].total++;
          if ((t.net_pnl ?? 0) > 0) sessionStats[s].wins++;
        }

        const symbolStats: Record<string, { wins: number; total: number }> = {};
        for (const t of trades) {
          if (!symbolStats[t.symbol]) symbolStats[t.symbol] = { wins: 0, total: 0 };
          symbolStats[t.symbol].total++;
          if ((t.net_pnl ?? 0) > 0) symbolStats[t.symbol].wins++;
        }

        journalContext = `
## Recent Trading Performance (Last ${trades.length} closed trades${playbook_id ? " for this playbook" : ""})

- Win rate: ${((wins / trades.length) * 100).toFixed(1)}% (${wins}W / ${losses}L)
- Total P&L: ${totalPnl.toFixed(2)}
- Average R-multiple: ${avgR.toFixed(2)}R

### By Session
${Object.entries(sessionStats).map(([s, v]) => `- ${s}: ${((v.wins / v.total) * 100).toFixed(0)}% win rate (${v.total} trades)`).join("\n")}

### By Symbol
${Object.entries(symbolStats).map(([s, v]) => `- ${s}: ${((v.wins / v.total) * 100).toFixed(0)}% win rate (${v.total} trades)`).join("\n")}
`;
      }
    } catch (e) {
      console.error("Failed to fetch journal context:", e);
    }

    // Fetch recent trade review insights
    let reviewContext = "";
    try {
      const { data: reviews } = await supabase
        .from("trade_reviews")
        .select("mistakes, did_well, thoughts, playbook_id")
        .order("created_at", { ascending: false })
        .limit(10);

      if (reviews && reviews.length > 0) {
        const allMistakes = reviews.flatMap((r) => (Array.isArray(r.mistakes) ? r.mistakes : [])).filter(Boolean);
        const allDidWell = reviews.flatMap((r) => (Array.isArray(r.did_well) ? r.did_well : [])).filter(Boolean);

        if (allMistakes.length > 0 || allDidWell.length > 0) {
          reviewContext = `
## Journal Review Insights (Recent)

### Common Mistakes
${allMistakes.slice(0, 8).map((m) => `- ${m}`).join("\n") || "None recorded"}

### What's Working Well
${allDidWell.slice(0, 8).map((m) => `- ${m}`).join("\n") || "None recorded"}
`;
        }
      }
    } catch (e) {
      console.error("Failed to fetch review context:", e);
    }

    // Backtest metrics context
    let backtestContext = "";
    if (backtest_metrics) {
      backtestContext = `
## Backtest Report Metrics (uploaded by user)
${backtest_metrics}
`;
    }

    const toolInstructions = playbook_id
      ? `
## Tool Usage Instructions

You have tools to directly modify the active playbook. Use them when:
- The user explicitly asks you to update, add, or remove rules
- The user agrees to a suggestion you've made
- You're running a gap analysis and the user wants you to fix issues

When you use a tool, also explain what you changed and why in your response text. The user will see an inline confirmation card.

DO NOT use tools speculatively — only when the user has confirmed or explicitly requested a change. If you're suggesting changes, describe them first and ask the user if they want you to apply them.

After using a tool, include a marker in your response: [PLAYBOOK_UPDATED] so the frontend knows to refresh.
`
      : `
## Note
No playbook is currently selected, so you cannot use playbook modification tools. You can still discuss AMT theory, analyze general performance, and help design new strategies.
`;

    const systemPrompt = `${AMT_KNOWLEDGE}

${playbookContext}

${journalContext}

${reviewContext}

${backtestContext}

${toolInstructions}

## Your Behavior

1. When the user asks to generate an EA, produce complete, compilable MQL5 code in a single code block with language tag \`\`\`mql5.
2. When analyzing performance, reference the journal data above and identify patterns using AMT concepts.
3. When refining strategies, suggest specific rule changes with AMT reasoning. If the user agrees, use the tools to apply them.
4. Always be specific — reference actual numbers from the journal data, actual rules from the playbook.
5. If no playbook is selected, you can still discuss AMT theory and help design new strategies.
6. Format responses with clear headers and bullet points for readability.
7. When asked to analyze gaps, systematically check: entry rules have confirmations, confirmations have invalidations, failure modes cover journal mistakes, risk limits are set, checklist covers all categories.
`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI service not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // First call: may return tool calls or content
    const aiPayload: Record<string, unknown> = {
      model: "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
      stream: true,
      reasoning: { effort: "high" },
    };

    if (playbook_id) {
      aiPayload.tools = TOOL_DEFINITIONS;
    }

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(aiPayload),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please wait a moment and try again." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds in Settings → Workspace → Usage." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const text = await aiResponse.text();
      console.error("AI gateway error:", status, text);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // We need to handle tool calls. Since we're streaming, we need to collect the full
    // response first to check for tool calls, then either stream through or handle tools.
    // Strategy: read the stream, detect tool_calls in finish_reason, execute them,
    // then make a follow-up call with tool results.

    const reader = aiResponse.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let collectedContent = "";
    let toolCalls: Array<{ id: string; function: { name: string; arguments: string } }> = [];
    let hasToolCalls = false;
    const toolCallBuffers: Record<number, { id: string; name: string; args: string }> = {};

    // Read through the stream to detect tool calls
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") continue;

        try {
          const parsed = JSON.parse(jsonStr);
          const choice = parsed.choices?.[0];
          if (choice?.delta?.content) {
            collectedContent += choice.delta.content;
          }
          if (choice?.delta?.tool_calls) {
            hasToolCalls = true;
            for (const tc of choice.delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallBuffers[idx]) {
                toolCallBuffers[idx] = { id: tc.id || "", name: tc.function?.name || "", args: "" };
              }
              if (tc.id) toolCallBuffers[idx].id = tc.id;
              if (tc.function?.name) toolCallBuffers[idx].name = tc.function.name;
              if (tc.function?.arguments) toolCallBuffers[idx].args += tc.function.arguments;
            }
          }
        } catch {
          // ignore partial JSON
        }
      }
    }

    if (hasToolCalls && playbook_id) {
      // Execute all tool calls
      toolCalls = Object.values(toolCallBuffers).map((tc) => ({
        id: tc.id,
        function: { name: tc.name, arguments: tc.args },
      }));

      const toolResults: Array<{ tool_call_id: string; role: string; content: string }> = [];
      const appliedChanges: Array<{ tool: string; result: Record<string, unknown> }> = [];

      for (const tc of toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          args = {};
        }

        const result = await executeToolCall(tc.function.name, args, playbook_id, serviceClient);
        toolResults.push({
          tool_call_id: tc.id,
          role: "tool",
          content: JSON.stringify(result),
        });
        appliedChanges.push({ tool: tc.function.name, result });
      }

      // Follow-up call with tool results
      const followUpMessages = [
        { role: "system", content: systemPrompt },
        ...messages,
        {
          role: "assistant",
          content: collectedContent || null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: tc.function,
          })),
        },
        ...toolResults,
      ];

      const followUpResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-pro",
          messages: followUpMessages,
          stream: true,
        }),
      });

      if (!followUpResponse.ok) {
        // Fall back to returning the tool results as text
        const changesSummary = appliedChanges
          .map((c) => `[TOOL_RESULT:${JSON.stringify({ tool: c.tool, ...c.result })}]`)
          .join("\n");
        const fallbackContent = `${collectedContent}\n\n${changesSummary}\n\n[PLAYBOOK_UPDATED]`;
        
        const encoder = new TextEncoder();
        const sseData = `data: ${JSON.stringify({ choices: [{ delta: { content: fallbackContent }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
        
        return new Response(encoder.encode(sseData), {
          headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
        });
      }

      // Prepend tool result markers to the stream
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const enc = new TextEncoder();

      // Send tool result markers first
      for (const change of appliedChanges) {
        const marker = `data: ${JSON.stringify({
          choices: [{
            delta: { content: `\n[TOOL_RESULT:${JSON.stringify({ tool: change.tool, ...change.result })}]\n` },
            finish_reason: null,
          }],
        })}\n\n`;
        await writer.write(enc.encode(marker));
      }

      // Then pipe the follow-up stream
      const followUpReader = followUpResponse.body!.getReader();
      (async () => {
        try {
          while (true) {
            const { done, value } = await followUpReader.read();
            if (done) break;
            await writer.write(value);
          }
        } finally {
          await writer.close();
        }
      })();

      return new Response(readable, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    // No tool calls — reconstruct the stream from collected content
    const encoder = new TextEncoder();
    const chunks: string[] = [];
    // Split content into smaller chunks for streaming feel
    const chunkSize = 20;
    for (let i = 0; i < collectedContent.length; i += chunkSize) {
      const chunk = collectedContent.slice(i, i + chunkSize);
      chunks.push(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk }, finish_reason: null }] })}\n\n`);
    }
    chunks.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
    chunks.push("data: [DONE]\n\n");

    return new Response(encoder.encode(chunks.join("")), {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("strategy-lab error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
