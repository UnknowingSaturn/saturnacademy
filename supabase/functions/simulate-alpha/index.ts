import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { playbook_id, parameters } = await req.json();

    if (!playbook_id) {
      return new Response(JSON.stringify({ error: "playbook_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch playbook
    const { data: playbook } = await supabase
      .from("playbooks")
      .select("*")
      .eq("id", playbook_id)
      .single();

    if (!playbook) {
      return new Response(JSON.stringify({ error: "Playbook not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch closed trades for this playbook (or all if no filter)
    const query = supabase
      .from("trades")
      .select("id, symbol, direction, session, entry_price, exit_price, entry_time, exit_time, net_pnl, r_multiple_actual, sl_initial, tp_initial, total_lots, playbook_id, balance_at_entry, equity_at_entry, duration_seconds")
      .eq("is_open", false)
      .order("entry_time", { ascending: true })
      .limit(500);

    const { data: trades } = await query;
    if (!trades || trades.length === 0) {
      return new Response(JSON.stringify({ error: "No closed trades found to simulate against" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build playbook context for AI
    const playbookRules = {
      name: playbook.name,
      description: playbook.description,
      confirmation_rules: playbook.confirmation_rules || [],
      invalidation_rules: playbook.invalidation_rules || [],
      management_rules: playbook.management_rules || [],
      failure_modes: playbook.failure_modes || [],
      entry_zone_rules: playbook.entry_zone_rules || {},
      symbol_filter: playbook.symbol_filter || [],
      session_filter: playbook.session_filter || [],
      valid_regimes: playbook.valid_regimes || [],
      max_r_per_trade: playbook.max_r_per_trade,
      max_daily_loss_r: playbook.max_daily_loss_r,
      max_trades_per_session: playbook.max_trades_per_session,
    };

    const tradesSummary = trades.map((t) => ({
      id: t.id,
      symbol: t.symbol,
      direction: t.direction,
      session: t.session,
      entry_price: t.entry_price,
      exit_price: t.exit_price,
      entry_time: t.entry_time,
      exit_time: t.exit_time,
      net_pnl: t.net_pnl,
      r_multiple: t.r_multiple_actual,
      sl: t.sl_initial,
      tp: t.tp_initial,
      lots: t.total_lots,
      playbook_id: t.playbook_id,
      duration_seconds: t.duration_seconds,
    }));

    // Create simulation run record
    const { data: simRun, error: insertErr } = await supabase
      .from("simulation_runs")
      .insert({
        user_id: user.id,
        playbook_id,
        alpha_code: "",
        parameters: parameters || {},
        status: "running",
      })
      .select("id")
      .single();

    if (insertErr || !simRun) {
      return new Response(JSON.stringify({ error: "Failed to create simulation run" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI service not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userParams = parameters || {};
    const minRMultiple = userParams.min_r_multiple ?? 1.5;
    const requireSL = userParams.require_sl !== false;
    const sessionFilterEnabled = userParams.session_filter !== false;
    const symbolFilterEnabled = userParams.symbol_filter !== false;

    // Ask AI to generate alpha evaluation for each trade
    const systemPrompt = `You are a quantitative trading alpha evaluator. Given a playbook's rules and a list of historical trades, you must evaluate EACH trade and determine whether the alpha (playbook rules) would have TAKEN or SKIPPED the trade.

## Playbook Rules
${JSON.stringify(playbookRules, null, 2)}

## Simulation Parameters
- Minimum R:R required: ${minRMultiple}
- Require stop loss: ${requireSL}
- Apply session filter: ${sessionFilterEnabled}
- Apply symbol filter: ${symbolFilterEnabled}

## Your Task
For each trade, evaluate:
1. Does the symbol match the playbook's symbol filter? (if filter exists and enabled)
2. Does the session match the playbook's session filter? (if filter exists and enabled)
3. Would the entry zone rules have triggered?
4. Are confirmation rules likely met based on direction and context?
5. Are there invalidation conditions that would prevent entry?
6. Does the risk:reward (based on SL/TP) meet the minimum requirement?

Return a JSON object with this exact structure:
{
  "alpha_code": "A textual description of the deterministic alpha logic you applied",
  "trade_signals": [
    {
      "trade_id": "uuid",
      "signal": "take" | "skip",
      "reason": "brief explanation",
      "confidence": 0.0-1.0
    }
  ]
}

Be deterministic and consistent. If a trade clearly violates a filter (wrong symbol, wrong session), always skip it. For subjective rules (like "price reclaims VAL"), use the available data (direction, entry price vs SL/TP levels) to make a reasonable judgment.

IMPORTANT: Return ONLY valid JSON, no markdown formatting, no code blocks.`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Evaluate these ${tradesSummary.length} trades:\n${JSON.stringify(tradesSummary)}` },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI error:", errText);
      await serviceClient
        .from("simulation_runs")
        .update({ status: "failed", error_message: "AI evaluation failed" })
        .eq("id", simRun.id);

      return new Response(JSON.stringify({ error: "AI evaluation failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResult = await aiResponse.json();
    const content = aiResult.choices?.[0]?.message?.content || "{}";
    
    let alphaResult: { alpha_code?: string; trade_signals?: Array<{ trade_id: string; signal: string; reason: string; confidence: number }> };
    try {
      alphaResult = JSON.parse(content);
    } catch {
      await serviceClient
        .from("simulation_runs")
        .update({ status: "failed", error_message: "Failed to parse AI response" })
        .eq("id", simRun.id);

      return new Response(JSON.stringify({ error: "Failed to parse simulation results" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const signals = alphaResult.trade_signals || [];
    const signalMap = new Map(signals.map((s) => [s.trade_id, s]));

    // Compute metrics
    let alphaWins = 0;
    let alphaLosses = 0;
    let alphaTotalPnl = 0;
    let alphaGrossProfits = 0;
    let alphaGrossLosses = 0;
    let alphaTotalR = 0;
    let alphaRCount = 0;
    let agreements = 0;
    let alphaTaken = 0;
    let maxEquity = 0;
    let maxDrawdown = 0;
    let runningEquity = 0;
    let actualRunningEquity = 0;

    const equityCurve: Array<{ date: string; alpha_equity: number; actual_equity: number }> = [];
    const tradeLog: Array<{
      trade_id: string;
      symbol: string;
      direction: string;
      session: string | null;
      signal: string;
      reason: string;
      confidence: number;
      actual_pnl: number;
      r_multiple: number | null;
      entry_time: string;
      agreed: boolean;
    }> = [];

    for (const trade of trades) {
      const sig = signalMap.get(trade.id);
      const signal = sig?.signal || "skip";
      const reason = sig?.reason || "No signal generated";
      const confidence = sig?.confidence || 0;
      const pnl = trade.net_pnl || 0;
      const isPlaybookTrade = trade.playbook_id === playbook_id;

      actualRunningEquity += pnl;

      if (signal === "take") {
        alphaTaken++;
        alphaTotalPnl += pnl;
        runningEquity += pnl;

        if (pnl > 0) {
          alphaWins++;
          alphaGrossProfits += pnl;
        } else {
          alphaLosses++;
          alphaGrossLosses += Math.abs(pnl);
        }

        if (trade.r_multiple_actual != null) {
          alphaTotalR += trade.r_multiple_actual;
          alphaRCount++;
        }
      }

      // Agreement: alpha takes it AND trader tagged it to this playbook, OR alpha skips AND trader didn't tag
      const agreed = (signal === "take" && isPlaybookTrade) || (signal === "skip" && !isPlaybookTrade);
      if (agreed) agreements++;

      if (runningEquity > maxEquity) maxEquity = runningEquity;
      const dd = maxEquity - runningEquity;
      if (dd > maxDrawdown) maxDrawdown = dd;

      equityCurve.push({
        date: trade.entry_time,
        alpha_equity: Math.round(runningEquity * 100) / 100,
        actual_equity: Math.round(actualRunningEquity * 100) / 100,
      });

      tradeLog.push({
        trade_id: trade.id,
        symbol: trade.symbol,
        direction: trade.direction,
        session: trade.session,
        signal,
        reason,
        confidence,
        actual_pnl: pnl,
        r_multiple: trade.r_multiple_actual,
        entry_time: trade.entry_time,
        agreed,
      });
    }

    const winRate = alphaTaken > 0 ? (alphaWins / alphaTaken) * 100 : 0;
    const profitFactor = alphaGrossLosses > 0 ? alphaGrossProfits / alphaGrossLosses : alphaGrossProfits > 0 ? Infinity : 0;
    const avgR = alphaRCount > 0 ? alphaTotalR / alphaRCount : 0;
    const agreementScore = trades.length > 0 ? (agreements / trades.length) * 100 : 0;

    // Simple Sharpe approximation
    const returns = tradeLog.filter((t) => t.signal === "take").map((t) => t.actual_pnl);
    const meanReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdDev = returns.length > 1
      ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (returns.length - 1))
      : 0;
    const sharpe = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(252) : 0;

    const results = {
      metrics: {
        total_trades: trades.length,
        alpha_taken: alphaTaken,
        alpha_skipped: trades.length - alphaTaken,
        win_rate: Math.round(winRate * 10) / 10,
        profit_factor: Math.round(profitFactor * 100) / 100,
        total_pnl: Math.round(alphaTotalPnl * 100) / 100,
        max_drawdown: Math.round(maxDrawdown * 100) / 100,
        avg_r: Math.round(avgR * 100) / 100,
        sharpe: Math.round(sharpe * 100) / 100,
        agreement_score: Math.round(agreementScore * 10) / 10,
      },
      equity_curve: equityCurve,
      trade_log: tradeLog,
    };

    // Update simulation run
    await serviceClient
      .from("simulation_runs")
      .update({
        status: "completed",
        alpha_code: alphaResult.alpha_code || "AI-generated alpha evaluation",
        results,
      })
      .eq("id", simRun.id);

    return new Response(JSON.stringify({ id: simRun.id, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Simulation error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
