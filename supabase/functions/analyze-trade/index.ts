import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get auth header
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { trade_id, analysis_type } = await req.json();
    console.log("AI Analysis request:", { trade_id, analysis_type });

    // Get trade data with review
    const { data: trade, error: tradeError } = await supabase
      .from("trades")
      .select(`
        *,
        trade_reviews (
          *,
          playbook:playbooks (name, checklist_questions)
        ),
        account:accounts (name, prop_firm)
      `)
      .eq("id", trade_id)
      .single();

    if (tradeError || !trade) {
      return new Response(
        JSON.stringify({ error: "Trade not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get recent trades for context
    const { data: recentTrades } = await supabase
      .from("trades")
      .select("net_pnl, r_multiple_actual, session")
      .eq("user_id", trade.user_id)
      .eq("is_open", false)
      .order("exit_time", { ascending: false })
      .limit(10);

    const review = trade.trade_reviews?.[0];
    const playbook = review?.playbook;

    // Calculate context stats
    const recentWins = recentTrades?.filter((t: any) => (t.net_pnl || 0) > 0).length || 0;
    const recentWinRate = recentTrades?.length ? (recentWins / recentTrades.length * 100).toFixed(1) : "0";

    // Get failed checklist questions
    const failedQuestions: string[] = [];
    if (playbook?.checklist_questions && review?.checklist_answers) {
      playbook.checklist_questions.forEach((q: any) => {
        if (!review.checklist_answers[q.id]) {
          failedQuestions.push(q.question);
        }
      });
    }

    // Build prompt
    const systemPrompt = `You are a trading coach with a blunt, analytical personality. No fluff. Give actionable feedback based on the structured data provided. Focus on what went wrong and provide a specific checklist for improvement. If rules were violated, call them out directly. Reference specific numbers and patterns.

Your tone is direct and analytical - like a mentor who respects the trader's time. Don't sugarcoat, but be constructive.`;

    const tradeResult = (trade.net_pnl || 0) >= 0 ? "WIN" : "LOSS";
    const pnlStr = trade.net_pnl ? `$${trade.net_pnl.toFixed(2)}` : "N/A";
    const rStr = trade.r_multiple_actual ? `${trade.r_multiple_actual.toFixed(2)}R` : "N/A";

    const userPrompt = `Analyze this trade:

TRADE DATA:
- Symbol: ${trade.symbol}
- Direction: ${trade.direction.toUpperCase()}
- Entry: ${trade.entry_price} @ ${trade.entry_time}
- Exit: ${trade.exit_price || "Open"} @ ${trade.exit_time || "N/A"}
- Result: ${tradeResult} (${pnlStr}, ${rStr})
- Session: ${trade.session || "Unknown"}

PLAYBOOK: ${playbook?.name || "None assigned"}
CHECKLIST SCORE: ${review?.score || 0}/5

FAILED CHECKLIST ITEMS:
${failedQuestions.length > 0 ? failedQuestions.map(q => `- ${q}`).join("\n") : "- None (all passed)"}

TRADE CONTEXT:
- Regime: ${review?.regime || "Not specified"}
- News Risk: ${review?.news_risk || "None"}
- Emotional State Before: ${review?.emotional_state_before || "Not recorded"}
- Emotional State After: ${review?.emotional_state_after || "Not recorded"}

RECENT PERFORMANCE:
- Last 10 trades win rate: ${recentWinRate}%

${review?.mistakes?.length ? `SELF-IDENTIFIED MISTAKES:\n${review.mistakes.map((m: string) => `- ${m}`).join("\n")}` : ""}

Provide your analysis in this format:

**VERDICT**: [One line summary]

**WHAT WENT WRONG**:
[Bullet points for each issue, referencing specific data]

**CHECKLIST FOR NEXT TRADE**:
[3-5 specific, actionable items as checkboxes]

**PATTERN DETECTED**:
[Any recurring patterns you notice, or "No concerning patterns detected"]`;

    console.log("Calling Lovable AI...");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add credits to your workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const analysis = data.choices?.[0]?.message?.content;

    if (!analysis) {
      throw new Error("No analysis returned from AI");
    }

    console.log("AI analysis complete");

    return new Response(
      JSON.stringify({ analysis }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("AI analysis error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});