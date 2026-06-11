// Pair Lab — AI quant report.
// Takes a pre-computed bucket (deterministic stats from src/lib/pairLabMath.ts)
// and produces a structured narrative: what's working, what's leaking, and
// concrete parameter changes. Trade IDs in the input are echoed as citations.
//
// We do NOT recompute math here — the client already did that. This function
// only adds the narrative layer.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, corsPreflight, jsonResponse } from "../_shared/cors.ts";

interface BucketInput {
  symbol: string;
  session: string;
  n: number;
  wins: number;
  losses: number;
  winRate: number;
  expectedR: number;
  expectedRMedian: number;
  mfeP50: number | null;
  mfeP75: number | null;
  maeP50: number | null;
  maeP75: number | null;
  idealSlMedian: number | null;
  slInitialMedian: number | null;
  slDrift: "too_wide" | "too_tight" | "aligned" | null;
  tpHitDistribution: Record<string, number>;
  mostCommonTpHit: string | null;
  confidence: "high" | "medium" | "low";
  expectedRCi: [number, number] | null;
  suggestedSlPips: number | null;
  tpLadderR: number[];
  suggestedRiskPct: number | null;
  edgeVsBaseline: { winRateDelta: number; expectedRDelta: number } | null;
  topTradeIds: string[];
  bottomTradeIds: string[];
}

interface RequestBody {
  bucket: BucketInput;
  baseline: {
    n: number;
    winRate: number;
    expectedR: number;
    mfeP75: number | null;
    maeP75: number | null;
  };
}

serve(async (req) => {
  const pre = corsPreflight(req);
  if (pre) return pre;

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return jsonResponse({ error: "Missing Authorization header" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return jsonResponse({ error: "Invalid session" }, 401);

    const body = (await req.json()) as RequestBody;
    if (!body?.bucket) return jsonResponse({ error: "Missing bucket" }, 400);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return jsonResponse({ error: "LOVABLE_API_KEY not configured" }, 500);

    const b = body.bucket;
    const base = body.baseline;

    const facts = {
      bucket: `${b.symbol} · ${b.session}`,
      sample: { n: b.n, wins: b.wins, losses: b.losses, confidence: b.confidence },
      outcome: {
        win_rate_pct: +(b.winRate * 100).toFixed(1),
        expected_r: +b.expectedR.toFixed(2),
        expected_r_median: +b.expectedRMedian.toFixed(2),
        expected_r_ci_95: b.expectedRCi
          ? [+b.expectedRCi[0].toFixed(2), +b.expectedRCi[1].toFixed(2)]
          : null,
      },
      excursion: {
        mfe_median_R: b.mfeP50,
        mfe_p75_R: b.mfeP75,
        mae_median: b.maeP50,
        mae_p75: b.maeP75,
      },
      stops: {
        ideal_sl_median_pips: b.idealSlMedian,
        actual_sl_median_pips: b.slInitialMedian,
        drift: b.slDrift,
      },
      tp_hits: b.tpHitDistribution,
      most_common_tp_hit: b.mostCommonTpHit,
      recommended_parameters: {
        suggested_sl_pips: b.suggestedSlPips,
        tp_ladder_R: b.tpLadderR,
        suggested_risk_pct: b.suggestedRiskPct,
      },
      edge_vs_baseline: b.edgeVsBaseline,
      baseline: {
        n: base.n,
        win_rate_pct: +(base.winRate * 100).toFixed(1),
        expected_r: +base.expectedR.toFixed(2),
        mfe_p75_R: base.mfeP75,
        mae_p75: base.maeP75,
      },
      example_trades: {
        best: b.topTradeIds,
        worst: b.bottomTradeIds,
      },
    };

    const systemPrompt = `You are a quant trading analyst writing a concise parameter-optimization note for a single SYMBOL × SESSION bucket.

You receive pre-computed deterministic statistics. DO NOT recompute or contradict the numbers. Cite trade IDs from example_trades when illustrating a point.

Output strict JSON with these keys:
{
  "headline": "One short sentence summarizing the bucket's edge or leak (≤90 chars).",
  "whats_working": "2-3 sentences. What this bucket does well. Reference numbers.",
  "whats_leaking": "2-3 sentences. Where R is left on the table or given back. Reference numbers.",
  "parameter_changes": [
    { "label": "Stop loss", "current": "...", "suggested": "...", "rationale": "..." },
    { "label": "Take profit", "current": "...", "suggested": "...", "rationale": "..." },
    { "label": "Risk size", "current": "...", "suggested": "...", "rationale": "..." }
  ],
  "playbook_edits": ["Short imperative bullet …", "Another short bullet …"],
  "caveats": "1 sentence about sample size or low confidence if relevant. Empty string if not.",
  "cited_trade_ids": ["uuid", ...]
}

Rules:
- Be concrete. Use the bucket name, R values, pip values, win rate.
- If confidence is "low" (n<10) say so in caveats and soften recommendations.
- If expected_r is negative and CI doesn't cross zero, the leak is real — say so.
- If slDrift is "too_wide" → suggest tightening to ideal_sl_median. If "too_tight" → suggest widening to mae_p75 × 1.15.
- If most_common_tp_hit is far below mfe_p75 → suggest trailing or partial-out higher.
- No platitudes ("stay disciplined", "trust the process"). No filler. Plain numbers.
- cited_trade_ids must be a subset of example_trades.best + example_trades.worst.`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Bucket facts:\n${JSON.stringify(facts, null, 2)}` },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiResp.ok) {
      const text = await aiResp.text();
      if (aiResp.status === 429) {
        return jsonResponse({ error: "Rate limit reached. Try again in a minute." }, 429);
      }
      if (aiResp.status === 402) {
        return jsonResponse({ error: "Lovable AI credits exhausted. Add credits in Workspace → Usage." }, 402);
      }
      return jsonResponse({ error: `AI gateway error: ${text}` }, 500);
    }

    const payload = await aiResp.json();
    const content = payload?.choices?.[0]?.message?.content ?? "{}";
    let note: unknown;
    try {
      note = JSON.parse(content);
    } catch {
      return jsonResponse({ error: "AI returned non-JSON content" }, 500);
    }

    return jsonResponse({ note, model: "google/gemini-3-flash-preview" });
  } catch (err) {
    console.error("pair-lab-report error", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
