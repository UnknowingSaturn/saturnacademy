import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Session time windows (UTC hours)
const SESSION_TIMES = {
  tokyo: { start: 0, end: 9 },      // 00:00 - 09:00 UTC
  london: { start: 7, end: 16 },    // 07:00 - 16:00 UTC
  new_york: { start: 13, end: 22 }, // 13:00 - 22:00 UTC
  overlap_london_ny: { start: 13, end: 16 }, // 13:00 - 16:00 UTC
};

function getSessionOpenTime(session: string, entryTime: Date): number {
  const sessionInfo = SESSION_TIMES[session as keyof typeof SESSION_TIMES];
  if (!sessionInfo) return 0;
  
  const entryHour = entryTime.getUTCHours();
  const entryMinutes = entryTime.getUTCMinutes();
  const sessionStartMinutes = sessionInfo.start * 60;
  const entryTotalMinutes = entryHour * 60 + entryMinutes;
  
  // If entry is before session start, it might be from previous day's session
  if (entryTotalMinutes < sessionStartMinutes) {
    return entryTotalMinutes + (24 * 60) - sessionStartMinutes;
  }
  
  return entryTotalMinutes - sessionStartMinutes;
}

function calculateEntryPercentile(
  entryPrice: number,
  slPrice: number | null,
  tpPrice: number | null,
  direction: string
): number | null {
  // If we don't have both SL and TP, we can't calculate meaningful percentile
  if (!slPrice || !tpPrice) return null;
  
  const rangeSize = Math.abs(tpPrice - slPrice);
  if (rangeSize === 0) return 50; // Avoid division by zero
  
  // Calculate where entry falls within the SL-TP range
  const distanceFromSL = Math.abs(entryPrice - slPrice);
  const percentile = (distanceFromSL / rangeSize) * 100;
  
  return Math.min(100, Math.max(0, percentile));
}

function calculateEntryEfficiency(
  entryPrice: number,
  slPrice: number | null,
  tpPrice: number | null,
  direction: string
): number | null {
  if (!slPrice || !tpPrice) return null;
  
  const range = Math.abs(tpPrice - slPrice);
  if (range === 0) return 50;
  
  // For buys: better entry = closer to SL (lower price)
  // For sells: better entry = closer to SL (higher price)
  if (direction === 'buy') {
    const distanceFromSL = entryPrice - slPrice;
    const efficiency = 100 - (distanceFromSL / range) * 100;
    return Math.min(100, Math.max(0, efficiency));
  } else {
    const distanceFromSL = slPrice - entryPrice;
    const efficiency = 100 - (distanceFromSL / range) * 100;
    return Math.min(100, Math.max(0, efficiency));
  }
}

function calculateExitEfficiency(
  exitPrice: number | null,
  slPrice: number | null,
  tpPrice: number | null,
  direction: string
): number | null {
  if (!exitPrice || !slPrice || !tpPrice) return null;
  
  const range = Math.abs(tpPrice - slPrice);
  if (range === 0) return 50;
  
  // For buys: better exit = closer to TP (higher price)
  // For sells: better exit = closer to TP (lower price)
  if (direction === 'buy') {
    const distanceFromSL = exitPrice - slPrice;
    const efficiency = (distanceFromSL / range) * 100;
    return Math.min(100, Math.max(0, efficiency));
  } else {
    const distanceFromSL = slPrice - exitPrice;
    const efficiency = (distanceFromSL / range) * 100;
    return Math.min(100, Math.max(0, efficiency));
  }
}

function calculateStopLocationQuality(
  slPrice: number | null,
  entryPrice: number,
  tpPrice: number | null,
  direction: string
): number | null {
  if (!slPrice || !tpPrice) return null;
  
  const riskDistance = Math.abs(entryPrice - slPrice);
  const rewardDistance = Math.abs(tpPrice - entryPrice);
  
  if (riskDistance === 0) return 0;
  
  const rrRatio = rewardDistance / riskDistance;
  
  // Quality based on RR ratio: 1:1 = 50%, 2:1 = 75%, 3:1 = 85%, etc.
  // Cap at 100%
  const quality = Math.min(100, 25 + (rrRatio * 25));
  return quality;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { trade_id } = await req.json();
    console.log("Computing features for trade:", trade_id);

    // Fetch trade data
    const { data: trade, error: tradeError } = await supabase
      .from("trades")
      .select("*")
      .eq("id", trade_id)
      .single();

    if (tradeError || !trade) {
      console.error("Trade fetch error:", tradeError);
      return new Response(
        JSON.stringify({ error: "Trade not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const entryTime = new Date(trade.entry_time);
    const dayOfWeek = entryTime.getUTCDay();
    const timeSinceSessionOpen = trade.session 
      ? getSessionOpenTime(trade.session, entryTime)
      : null;

    // Calculate features
    const entryPercentile = calculateEntryPercentile(
      trade.entry_price,
      trade.sl_initial || trade.sl_final,
      trade.tp_initial || trade.tp_final,
      trade.direction
    );

    const entryEfficiency = calculateEntryEfficiency(
      trade.entry_price,
      trade.sl_initial || trade.sl_final,
      trade.tp_initial || trade.tp_final,
      trade.direction
    );

    const exitEfficiency = calculateExitEfficiency(
      trade.exit_price,
      trade.sl_initial || trade.sl_final,
      trade.tp_initial || trade.tp_final,
      trade.direction
    );

    const stopLocationQuality = calculateStopLocationQuality(
      trade.sl_initial || trade.sl_final,
      trade.entry_price,
      trade.tp_initial || trade.tp_final,
      trade.direction
    );

    // Calculate range size in pips (simplified - assumes 4/5 decimal pairs)
    let rangeSizePips: number | null = null;
    const sl = trade.sl_initial || trade.sl_final;
    const tp = trade.tp_initial || trade.tp_final;
    if (sl && tp) {
      const pipMultiplier = trade.symbol.includes("JPY") ? 100 : 10000;
      rangeSizePips = Math.abs(tp - sl) * pipMultiplier;
    }

    const features = {
      trade_id,
      day_of_week: dayOfWeek,
      time_since_session_open_mins: timeSinceSessionOpen,
      volatility_regime: null, // Would need external data source
      range_size_pips: rangeSizePips,
      entry_percentile: entryPercentile,
      distance_to_mean_pips: null, // Would need price data
      htf_bias: null, // Would need chart data
      entry_efficiency: entryEfficiency,
      exit_efficiency: exitEfficiency,
      stop_location_quality: stopLocationQuality,
      computed_at: new Date().toISOString(),
    };

    console.log("Computed features:", features);

    // Upsert features
    const { data: result, error: upsertError } = await supabase
      .from("trade_features")
      .upsert(features, { onConflict: "trade_id" })
      .select()
      .single();

    if (upsertError) {
      console.error("Upsert error:", upsertError);
      return new Response(
        JSON.stringify({ error: upsertError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Features saved successfully");

    return new Response(
      JSON.stringify({ features: result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Compute features error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
