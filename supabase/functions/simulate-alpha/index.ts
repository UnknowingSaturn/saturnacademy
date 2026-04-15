import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Missing authorization" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const mode = body.mode || "run_backtest";

    // ─── MODE: build_alpha (streaming chat) ───
    if (mode === "build_alpha") {
      return await handleBuildAlpha(body, supabase, user, authHeader);
    }

    // ─── MODE: run_backtest (deterministic) ───
    return await handleRunBacktest(body, supabase, serviceClient, user);
  } catch (e) {
    console.error("Backtest error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

// ─────────────────────────────────────────────
// BUILD ALPHA — Streaming chat with AI
// ─────────────────────────────────────────────
async function handleBuildAlpha(
  body: any,
  supabase: any,
  user: any,
  authHeader: string,
) {
  const { messages, playbook_id } = body;

  let playbookContext = "";
  if (playbook_id) {
    const { data: pb } = await supabase
      .from("playbooks")
      .select("*")
      .eq("id", playbook_id)
      .single();
    if (pb) {
      playbookContext = `
## Current Playbook: "${pb.name}"
${pb.description ? `Description: ${pb.description}` : ""}
- Confirmation rules: ${JSON.stringify(pb.confirmation_rules || [])}
- Invalidation rules: ${JSON.stringify(pb.invalidation_rules || [])}
- Management rules: ${JSON.stringify(pb.management_rules || [])}
- Failure modes: ${JSON.stringify(pb.failure_modes || [])}
- Entry zone rules: ${JSON.stringify(pb.entry_zone_rules || {})}
- Symbol filter: ${JSON.stringify(pb.symbol_filter || [])}
- Session filter: ${JSON.stringify(pb.session_filter || [])}
- Max R per trade: ${pb.max_r_per_trade ?? "not set"}
- Max daily loss R: ${pb.max_daily_loss_r ?? "not set"}
- Max trades per session: ${pb.max_trades_per_session ?? "not set"}
`;
    }
  }

  const systemPrompt = `You are a quantitative trading alpha builder. Your job is to help the trader convert their playbook rules into a structured, deterministic alpha definition that can be backtested against their trade history.

${playbookContext}

## Your Process
1. Read the playbook rules carefully
2. Ask the trader clarifying questions about each rule — one or two at a time, not all at once
3. For rules that can be checked with trade metadata (symbol, session, R:R, SL presence, time-of-day, daily trade count), define them precisely
4. For rules that require chart data (e.g. "price reclaims VAL", "volume above average"), explain that these cannot be verified from trade data alone and will be marked as "assumed_met"
5. Once all rules are clarified, generate the final alpha definition as a JSON code block

## Alpha Definition Format
When you're ready, output a JSON code block tagged \`\`\`alpha-json with this structure:
\`\`\`alpha-json
{
  "name": "Alpha name",
  "filters": {
    "symbols": ["NAS100", "EURUSD"],
    "sessions": ["london", "new_york_am"],
    "min_rr": 2.0,
    "require_sl": true,
    "max_trades_per_day": 3,
    "max_daily_loss_r": null,
    "allowed_directions": null,
    "min_duration_minutes": null,
    "max_duration_minutes": null
  },
  "unverifiable_rules": [
    {"rule": "Price reclaims VAL on M5", "assumed": "met", "note": "Cannot verify without chart data"}
  ]
}
\`\`\`

## Important Rules
- Be conversational and helpful, not robotic
- Ask about 1-2 rules at a time, don't overwhelm
- When the trader says they're ready or confirms all rules, generate the alpha JSON
- If the trader wants to modify the alpha after seeing results, update the JSON accordingly
- Always explain which rules are verifiable vs unverifiable
- Use the playbook's existing filters (symbol_filter, session_filter) as defaults in the alpha`;

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return new Response(JSON.stringify({ error: "AI service not configured" }), {
    status: 500,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

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
        ...(messages || []),
      ],
      stream: true,
    }),
  });

  if (!aiResponse.ok) {
    const errText = await aiResponse.text();
    console.error("AI error:", errText);
    const status = aiResponse.status === 429 ? 429 : aiResponse.status === 402 ? 402 : 500;
    return new Response(JSON.stringify({ error: status === 429 ? "Rate limited, try again later" : status === 402 ? "Credits exhausted" : "AI error" }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(aiResponse.body, {
    headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
  });
}

// ─────────────────────────────────────────────
// RUN BACKTEST — Deterministic filtering
// ─────────────────────────────────────────────
async function handleRunBacktest(
  body: any,
  supabase: any,
  serviceClient: any,
  user: any,
) {
  const { playbook_id, alpha } = body;

  if (!playbook_id) return new Response(JSON.stringify({ error: "playbook_id is required" }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

  if (!alpha || !alpha.filters) return new Response(JSON.stringify({ error: "alpha definition is required" }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

  // Fetch closed trades
  const { data: trades } = await supabase
    .from("trades")
    .select("id, symbol, direction, session, entry_price, exit_price, entry_time, exit_time, net_pnl, r_multiple_actual, sl_initial, tp_initial, total_lots, playbook_id, balance_at_entry, equity_at_entry, duration_seconds")
    .eq("is_open", false)
    .order("entry_time", { ascending: true })
    .limit(500);

  if (!trades || trades.length === 0) {
    return new Response(JSON.stringify({ error: "No closed trades found" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const filters = alpha.filters;

  // Create simulation run record
  const { data: simRun, error: insertErr } = await supabase
    .from("simulation_runs")
    .insert({
      user_id: user.id,
      playbook_id,
      alpha_code: JSON.stringify(alpha),
      parameters: filters,
      status: "running",
    })
    .select("id")
    .single();

  if (insertErr || !simRun) {
    return new Response(JSON.stringify({ error: "Failed to create backtest run" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Deterministic filtering ──
  const tradeLog: any[] = [];
  let alphaWins = 0, alphaLosses = 0, alphaTotalPnl = 0;
  let alphaGrossProfits = 0, alphaGrossLosses = 0;
  let alphaTotalR = 0, alphaRCount = 0, alphaTaken = 0;
  let maxEquity = 0, maxDrawdown = 0, runningEquity = 0, actualRunningEquity = 0;
  const equityCurve: any[] = [];
  const dailyTradeCounts: Record<string, number> = {};
  const dailyPnl: Record<string, number> = {};

  for (const trade of trades) {
    const pnl = trade.net_pnl || 0;
    actualRunningEquity += pnl;

    const reasons: string[] = [];
    let skip = false;

    // 1. Symbol filter
    if (filters.symbols && filters.symbols.length > 0) {
      const normalizedSymbol = trade.symbol?.toUpperCase().replace(/[^A-Z0-9]/g, "");
      const matches = filters.symbols.some((s: string) =>
        s.toUpperCase().replace(/[^A-Z0-9]/g, "") === normalizedSymbol
      );
      if (!matches) {
        skip = true;
        reasons.push(`Symbol ${trade.symbol} not in filter [${filters.symbols.join(", ")}]`);
      }
    }

    // 2. Session filter
    if (!skip && filters.sessions && filters.sessions.length > 0) {
      if (!trade.session || !filters.sessions.includes(trade.session)) {
        skip = true;
        reasons.push(`Session ${trade.session || "unknown"} not in filter [${filters.sessions.join(", ")}]`);
      }
    }

    // 3. Require SL
    if (!skip && filters.require_sl) {
      if (trade.sl_initial == null) {
        skip = true;
        reasons.push("No stop loss set");
      }
    }

    // 4. Minimum R:R
    if (!skip && filters.min_rr && trade.sl_initial != null && trade.tp_initial != null) {
      const slDist = Math.abs(trade.entry_price - trade.sl_initial);
      const tpDist = Math.abs(trade.tp_initial - trade.entry_price);
      const rr = slDist > 0 ? tpDist / slDist : 0;
      if (rr < filters.min_rr) {
        skip = true;
        reasons.push(`R:R ${rr.toFixed(2)} below minimum ${filters.min_rr}`);
      }
    }

    // 5. Max trades per day
    const tradeDay = trade.entry_time?.slice(0, 10) || "unknown";
    if (!skip && filters.max_trades_per_day) {
      const count = dailyTradeCounts[tradeDay] || 0;
      if (count >= filters.max_trades_per_day) {
        skip = true;
        reasons.push(`Daily trade limit (${filters.max_trades_per_day}) reached`);
      }
    }

    // 6. Max daily loss R
    if (!skip && filters.max_daily_loss_r) {
      const dayLoss = dailyPnl[tradeDay] || 0;
      // Rough R-loss check: if we have balance_at_entry and a 1% risk assumption
      if (dayLoss < 0 && trade.balance_at_entry && trade.balance_at_entry > 0) {
        const riskPerR = trade.balance_at_entry * 0.01;
        const rLoss = Math.abs(dayLoss) / riskPerR;
        if (rLoss >= filters.max_daily_loss_r) {
          skip = true;
          reasons.push(`Daily loss ${rLoss.toFixed(1)}R exceeds max ${filters.max_daily_loss_r}R`);
        }
      }
    }

    // 7. Direction filter
    if (!skip && filters.allowed_directions && filters.allowed_directions.length > 0) {
      if (!filters.allowed_directions.includes(trade.direction)) {
        skip = true;
        reasons.push(`Direction ${trade.direction} not allowed`);
      }
    }

    // 8. Duration filter
    if (!skip && filters.min_duration_minutes && trade.duration_seconds != null) {
      if (trade.duration_seconds < filters.min_duration_minutes * 60) {
        skip = true;
        reasons.push(`Duration ${Math.round(trade.duration_seconds / 60)}min below minimum ${filters.min_duration_minutes}min`);
      }
    }
    if (!skip && filters.max_duration_minutes && trade.duration_seconds != null) {
      if (trade.duration_seconds > filters.max_duration_minutes * 60) {
        skip = true;
        reasons.push(`Duration ${Math.round(trade.duration_seconds / 60)}min exceeds maximum ${filters.max_duration_minutes}min`);
      }
    }

    const signal = skip ? "skip" : "take";

    if (!skip) {
      alphaTaken++;
      alphaTotalPnl += pnl;
      runningEquity += pnl;
      dailyTradeCounts[tradeDay] = (dailyTradeCounts[tradeDay] || 0) + 1;
      dailyPnl[tradeDay] = (dailyPnl[tradeDay] || 0) + pnl;

      if (pnl > 0) { alphaWins++; alphaGrossProfits += pnl; }
      else { alphaLosses++; alphaGrossLosses += Math.abs(pnl); }

      if (trade.r_multiple_actual != null) {
        alphaTotalR += trade.r_multiple_actual;
        alphaRCount++;
      }
    }

    if (runningEquity > maxEquity) maxEquity = runningEquity;
    const dd = maxEquity - runningEquity;
    if (dd > maxDrawdown) maxDrawdown = dd;

    equityCurve.push({
      date: trade.entry_time,
      alpha_equity: Math.round(runningEquity * 100) / 100,
      actual_equity: Math.round(actualRunningEquity * 100) / 100,
    });

    const isPlaybookTrade = trade.playbook_id === playbook_id;
    const agreed = (signal === "take" && isPlaybookTrade) || (signal === "skip" && !isPlaybookTrade);

    tradeLog.push({
      trade_id: trade.id,
      symbol: trade.symbol,
      direction: trade.direction,
      session: trade.session,
      signal,
      reason: reasons.length > 0 ? reasons.join("; ") : "All filters passed",
      confidence: 1.0, // deterministic = 100%
      actual_pnl: pnl,
      r_multiple: trade.r_multiple_actual,
      entry_time: trade.entry_time,
      agreed,
    });
  }

  const winRate = alphaTaken > 0 ? (alphaWins / alphaTaken) * 100 : 0;
  const profitFactor = alphaGrossLosses > 0 ? alphaGrossProfits / alphaGrossLosses : alphaGrossProfits > 0 ? Infinity : 0;
  const avgR = alphaRCount > 0 ? alphaTotalR / alphaRCount : 0;

  const agreements = tradeLog.filter((t) => t.agreed).length;
  const agreementScore = trades.length > 0 ? (agreements / trades.length) * 100 : 0;

  // Sharpe
  const returns = tradeLog.filter((t) => t.signal === "take").map((t) => t.actual_pnl);
  const meanReturn = returns.length > 0 ? returns.reduce((a: number, b: number) => a + b, 0) / returns.length : 0;
  const stdDev = returns.length > 1
    ? Math.sqrt(returns.reduce((sum: number, r: number) => sum + Math.pow(r - meanReturn, 2), 0) / (returns.length - 1))
    : 0;
  const sharpe = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(252) : 0;

  const results = {
    metrics: {
      total_trades: trades.length,
      alpha_taken: alphaTaken,
      alpha_skipped: trades.length - alphaTaken,
      win_rate: Math.round(winRate * 10) / 10,
      profit_factor: profitFactor === Infinity ? 999 : Math.round(profitFactor * 100) / 100,
      total_pnl: Math.round(alphaTotalPnl * 100) / 100,
      max_drawdown: Math.round(maxDrawdown * 100) / 100,
      avg_r: Math.round(avgR * 100) / 100,
      sharpe: Math.round(sharpe * 100) / 100,
      agreement_score: Math.round(agreementScore * 10) / 10,
    },
    equity_curve: equityCurve,
    trade_log: tradeLog,
    alpha_definition: alpha,
    unverifiable_rules: alpha.unverifiable_rules || [],
    filters_applied: Object.entries(filters)
      .filter(([_, v]) => v != null && v !== false && !(Array.isArray(v) && v.length === 0))
      .map(([k]) => k),
  };

  // Update simulation run
  await serviceClient
    .from("simulation_runs")
    .update({
      status: "completed",
      alpha_code: JSON.stringify(alpha),
      results,
    })
    .eq("id", simRun.id);

  return new Response(JSON.stringify({ id: simRun.id, ...results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
