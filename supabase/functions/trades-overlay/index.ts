import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get API key from header
    const apiKey = req.headers.get("x-api-key");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Missing API key" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Validate API key and get account
    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("id, user_id")
      .eq("api_key", apiKey)
      .eq("is_active", true)
      .single();

    if (accountError || !account) {
      return new Response(
        JSON.stringify({ error: "Invalid API key" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse query params
    const url = new URL(req.url);
    const symbol = url.searchParams.get("symbol");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    // Build query
    let query = supabase
      .from("trades")
      .select("*")
      .eq("user_id", account.user_id)
      .eq("is_open", false)
      .order("entry_time", { ascending: false });

    if (symbol) {
      query = query.eq("symbol", symbol.toUpperCase());
    }
    if (from) {
      query = query.gte("entry_time", from);
    }
    if (to) {
      query = query.lte("entry_time", to);
    }

    const { data: trades, error } = await query.limit(500);

    if (error) {
      console.error("Query error:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Transform to overlay format
    const overlayTrades = (trades || []).map((trade: any) => {
      const pnl = trade.net_pnl || 0;
      let result: "win" | "loss" | "breakeven" | "open" = "breakeven";
      if (trade.is_open) result = "open";
      else if (pnl > 0) result = "win";
      else if (pnl < 0) result = "loss";

      return {
        ticket: trade.ticket,
        symbol: trade.symbol,
        direction: trade.direction,
        entry: {
          price: trade.entry_price,
          time: trade.entry_time,
        },
        exit: trade.exit_price ? {
          price: trade.exit_price,
          time: trade.exit_time,
        } : null,
        sl: trade.sl_final || trade.sl_initial,
        tp: trade.tp_final || trade.tp_initial,
        r_multiple: trade.r_multiple_actual,
        result,
      };
    });

    console.log(`Overlay: returning ${overlayTrades.length} trades for ${symbol || "all symbols"}`);

    return new Response(
      JSON.stringify({ trades: overlayTrades }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Overlay error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});