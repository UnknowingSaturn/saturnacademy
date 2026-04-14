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
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

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

    const { messages, playbook_id, conversation_id } = await req.json();

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

        // Session breakdown
        const sessionStats: Record<string, { wins: number; total: number }> = {};
        for (const t of trades) {
          const s = t.session || "unknown";
          if (!sessionStats[s]) sessionStats[s] = { wins: 0, total: 0 };
          sessionStats[s].total++;
          if ((t.net_pnl ?? 0) > 0) sessionStats[s].wins++;
        }

        // Symbol breakdown
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

    const systemPrompt = `${AMT_KNOWLEDGE}

${playbookContext}

${journalContext}

${reviewContext}

## Your Behavior

1. When the user asks to generate an EA, produce complete, compilable MQL5 code in a single code block with language tag \`\`\`mql5.
2. When analyzing performance, reference the journal data above and identify patterns using AMT concepts.
3. When refining strategies, suggest specific rule changes with AMT reasoning.
4. Always be specific — reference actual numbers from the journal data, actual rules from the playbook.
5. If no playbook is selected, you can still discuss AMT theory and help design new strategies.
6. Format responses with clear headers and bullet points for readability.
`;

    // Call Lovable AI Gateway
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI service not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
        reasoning: { effort: "high" },
      }),
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

    return new Response(aiResponse.body, {
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
