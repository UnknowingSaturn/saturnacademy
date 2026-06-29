// Pair Lab — AI quant report.
// Takes a pre-computed bucket (deterministic stats from src/lib/pairLabMath.ts)
// and produces a structured narrative: what's working, what's leaking, and
// concrete parameter changes. Trade IDs in the input are echoed as citations.
//
// We do NOT recompute math here — the client already did that. This function
// only adds the narrative layer, grounded in the deterministic numbers and
// (when supplied) the user's prop-firm DD budget.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, corsPreflight, jsonResponse } from "../_shared/cors.ts";
import { setTickSizeOverrides } from "../_shared/quant/symbolMapping.ts";

// Pinned Lovable AI Gateway model id. Keep in one place so a model swap is
// a one-line change. If the gateway returns 404 we surface the model id in
// the error response — silent fallback hides config drift.
const PAIR_LAB_MODEL = "google/gemini-2.5-flash";


interface Tp1Star {
  r: number;
  hitRate: number;
  expectancyR: number;
}

interface BucketInput {
  symbol: string;
  session: string;
  rawSymbols?: string[];
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
  // S4.5 / S2.2 rename: client sends *Pips-suffixed names; previously the
  // handler read the deprecated `idealSlMedian` / `slInitialMedian` and got
  // `undefined`, so the AI quant note silently dropped SL drift commentary.
  idealSlMedianPips: number | null;
  slInitialMedianPips: number | null;
  slDrift: "too_wide" | "too_tight" | "aligned" | null;
  confidence: "high" | "medium" | "low";
  expectedRCi: [number, number] | null;
  worstLosingStreak: number;
  suggestedSlPips: number | null;
  slSource: "ideal_sl" | "winners_mae" | "winners_mae_fallback" | "legacy";
  slSourceN: number | null;
  tpLadderR: number[];
  tp1Star: Tp1Star | null;
  suggestedRiskPct: number | null;
  /** Bootstrap 95% CI on raw quarter-Kelly. Sent by the client when n≥10. */
  suggestedRiskPctCi?: [number, number] | null;
  suggestedRiskPctPropFirm: number | null;
  bindingConstraint: "kelly" | "prop_firm_dd" | "hard_cap" | null;
  edgeVsBaseline: { winRateDelta: number; expectedRDelta: number } | null;
  /** Profit factor (sum winR / sum lossR). null when no losses recorded. */
  profitFactor?: number | null;
  /** True when wins>0 and losses=0 — PF is undefined; cite "all wins" instead. */
  profitFactorAllWins?: boolean;
  /** Phase-4 additions — confidence + walk-forward provenance. */
  recommendationConfidence?: "validated" | "low" | "insufficient";
  suggestedTpR?: number | null;
  expectancyAtSuggested?: number | null;
  expectancyAtSuggestedCi?: [number, number] | null;
  walkForward?: {
    inSampleE: number;
    outOfSampleE: number;
    degradationPct: number;
    oosN: number;
  } | null;
  topTradeIds: string[];
  bottomTradeIds: string[];
}


interface PropFirmInput {
  firmName: string | null;
  balance: number;
  dailyLossDollars: number | null;
  maxDrawdownDollars: number | null;
  hardCapPct: number;
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
  propFirm?: PropFirmInput | null;
  /**
   * Per-symbol tick-size overrides mirrored from the client's symbol_groups
   * config. Currently unused (this handler only consumes a pre-computed
   * bucket) but installed for the request lifetime so any future direct
   * buildBuckets() call inside this function matches client output for
   * crypto/exotic-index symbols. Reset in finally to keep Deno isolates clean.
   */
  tickSizeOverrides?: Record<string, number> | null;
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

    // Install per-request tick-size overrides so any future direct
    // buildBuckets() call inside this handler matches client output. Reset in
    // the outer finally to keep Deno isolates clean across invocations.
    const overrides = body.tickSizeOverrides ?? null;
    if (overrides && typeof overrides === "object") {
      setTickSizeOverrides(overrides);
    }

    const b = body.bucket;
    const base = body.baseline;
    const pf = body.propFirm ?? null;


    const facts = {
      bucket: `${b.symbol} · ${b.session}`,
      raw_symbols_merged: b.rawSymbols ?? [],
      sample: { n: b.n, wins: b.wins, losses: b.losses, confidence: b.confidence, worst_losing_streak: b.worstLosingStreak },
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
        ideal_sl_median_pips: b.idealSlMedianPips,
        actual_sl_median_pips: b.slInitialMedianPips,
        drift: b.slDrift,
      },
      recommended_parameters: {
        suggested_sl_pips: b.suggestedSlPips,
        sl_source: b.slSource,
        sl_source_n: b.slSourceN,
        suggested_tp_r: b.suggestedTpR ?? null,
        expectancy_at_suggested_r: b.expectancyAtSuggested ?? null,
        expectancy_at_suggested_ci_95:
          b.expectancyAtSuggestedCi
            ? [
                +b.expectancyAtSuggestedCi[0].toFixed(2),
                +b.expectancyAtSuggestedCi[1].toFixed(2),
              ]
            : null,
        tp_ladder_R_expected_r: b.tpLadderR,
        tp1_star_win_rate_maxing: b.tp1Star
          ? {
              r: b.tp1Star.r,
              hit_rate_pct: +(b.tp1Star.hitRate * 100).toFixed(1),
              expectancy_r: +b.tp1Star.expectancyR.toFixed(2),
            }
          : null,
        suggested_risk_pct_edge_only: b.suggestedRiskPct,
        suggested_risk_pct_edge_only_ci_95:
          b.suggestedRiskPctCi
            ? [
                +b.suggestedRiskPctCi[0].toFixed(2),
                +b.suggestedRiskPctCi[1].toFixed(2),
              ]
            : null,
        suggested_risk_pct_prop_firm: b.suggestedRiskPctPropFirm,
        binding_constraint: b.bindingConstraint,
        recommendation_confidence: b.recommendationConfidence ?? null,
      },
      walk_forward: b.walkForward
        ? {
            in_sample_expected_r: +b.walkForward.inSampleE.toFixed(2),
            out_of_sample_expected_r: +b.walkForward.outOfSampleE.toFixed(2),
            degradation_pct: +b.walkForward.degradationPct.toFixed(1),
            oos_n: b.walkForward.oosN,
          }
        : null,
      profitability: {
        // null + flag so the model can distinguish "no losses" from "no data".
        profit_factor: b.profitFactor ?? null,
        profit_factor_all_wins: b.profitFactorAllWins ?? false,
      },
      edge_vs_baseline: b.edgeVsBaseline,
      baseline: {
        n: base.n,
        win_rate_pct: +(base.winRate * 100).toFixed(1),
        expected_r: +base.expectedR.toFixed(2),
        mfe_p75_R: base.mfeP75,
        mae_p75: base.maeP75,
      },
      prop_firm: pf
        ? {
            firm_name: pf.firmName,
            balance: pf.balance,
            daily_loss_dollars: pf.dailyLossDollars,
            max_drawdown_dollars: pf.maxDrawdownDollars,
            hard_cap_pct: pf.hardCapPct,
          }
        : null,
      example_trades: {
        best: b.topTradeIds,
        worst: b.bottomTradeIds,
      },
    };


    const systemPrompt = `You are a quant trading analyst writing a concise parameter-optimization note for a single SYMBOL × SESSION bucket, targeting prop-firm survival and win-rate uplift.

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
- The recommended SL (suggested_sl_pips) is sourced per sl_source: "ideal_sl" = median of the trader's logged ideal SL across sl_source_n trades (cite as "based on your logged ideal SL, n=…"); "winners_mae" = MAE-of-winners p90 × 1.10, n=sl_source_n (cite as "derived from how much heat your winners absorbed, n=…"); "winners_mae_fallback" = MAE p75 × 1.15 (cite as "fallback estimate — log ideal SL on more trades to tighten this"); "legacy" = no SL data, do not recommend a stop.
- slDrift ("too_wide"/"too_tight") describes how the trader's *actual* initial SL compares to their own ideal SL. Comment on execution discipline ("you're placing stops X% wider than your own ideal"), do NOT use it to override suggested_sl_pips.
- If tp1_star_win_rate_maxing is present, treat it as the "raise win rate" lever. Recommend it as TP1 (book partial / move to BE) when the goal is win-rate uplift — even if its expectancy_r is lower than the expected-R ladder. State the win-rate it locks in (hit_rate_pct).
- If tp1_star_win_rate_maxing.r is well below mfe_p75 (gap ≥ 0.5R), explicitly recommend trailing or partial-out higher to capture the unrealized excursion.
- If prop_firm is set, your "Risk size" suggestion MUST equal suggested_risk_pct_prop_firm, not suggested_risk_pct_edge_only. If binding_constraint is "prop_firm_dd", say plainly: "risk is capped by daily DD budget, not by edge" and reference worst_losing_streak. If "hard_cap", say "capped by per-trade hard cap".
- When citing suggested_risk_pct_edge_only, also state suggested_risk_pct_edge_only_ci_95 (when present) — if the CI crosses zero the Kelly fraction is not statistically distinct from "don't size up", and risk should be held at the floor.
- If profitability.profit_factor is present, cite it ("PF 1.8"). If profitability.profit_factor_all_wins is true, say "all wins, PF undefined" rather than implying infinite edge.
- If worst_losing_streak × suggested_risk_pct_prop_firm would breach the daily DD budget, raise a red flag in whats_leaking.
- If raw_symbols_merged has >1 entry, note in caveats that this bucket aggregates broker variants (list them).
- recommendation_confidence reports whether the SL/TP grid produced a statistically valid optimum: "validated" = bootstrap lower CI > 0 (trust the suggested_tp_r); "low" = grid found a max but CI lower bound ≤ 0 (treat suggested_tp_r as directional, raise this in caveats); "insufficient" = fell back to legacy heuristic — do NOT cite expectancy_at_suggested_r, recommend collecting more MFE / winners' MAE data instead.
- expectancy_at_suggested_ci_95 is the bootstrap 95% CI on E[R] at the chosen (SL, TP) cell. If it crosses zero, the TP suggestion is not statistically distinguishable from break-even — say so explicitly when recommending the TP.
- walk_forward (when present) compares in-sample vs out-of-sample expected R on a 70/30 chronological split. If degradation_pct > 60 the parameter fit is curve-fit risk — raise this in whats_leaking and soften the TP suggestion. If degradation_pct is between 25 and 60, note "edge decayed OOS but didn't collapse". If degradation_pct < 25 the edge held OOS — say so in whats_working. If degradation_pct < 0, OOS *outperformed* IS by |degradation_pct|% — call this out positively in whats_working ("edge strengthened out-of-sample by X%"). If walk_forward is null, OOS validation could not run (fewer than 30 closed trades or fewer than 5 OOS pairs) — mention "OOS validation pending — need more closed trades" in caveats.
- No platitudes ("stay disciplined", "trust the process"). No filler. Plain numbers.
- cited_trade_ids must be a subset of example_trades.best + example_trades.worst.`;


    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: PAIR_LAB_MODEL,
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
      // Surface the model id loudly on 404/400 so a bad model id can't hide
      // behind a generic "AI gateway error".
      if (aiResp.status === 404 || aiResp.status === 400) {
        return jsonResponse(
          { error: `AI gateway rejected model "${PAIR_LAB_MODEL}" (${aiResp.status}): ${text}` },
          502,
        );
      }
      return jsonResponse({ error: `AI gateway error (${aiResp.status}): ${text}` }, 500);
    }

    const payload = await aiResp.json();
    const content = payload?.choices?.[0]?.message?.content ?? "{}";
    let note: unknown;
    try {
      note = JSON.parse(content);
    } catch {
      return jsonResponse({ error: "AI returned non-JSON content" }, 500);
    }

    return jsonResponse({ note, model: PAIR_LAB_MODEL });
  } catch (err) {
    console.error("pair-lab-report error", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } finally {
    // Always clear overrides so a follow-up request on the same isolate
    // starts from defaults (no cross-request bleed).
    setTickSizeOverrides({});
  }
});

