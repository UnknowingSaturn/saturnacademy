import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

interface EventPayload {
  idempotency_key: string;
  terminal_id: string;
  account_id?: string;
  event_type: "open" | "modify" | "partial_close" | "close";
  ticket: number;
  symbol: string;
  direction: "buy" | "sell";
  lot_size: number;
  price: number;
  sl?: number;
  tp?: number;
  commission?: number;
  swap?: number;
  profit?: number;
  timestamp: string;
  raw_payload?: Record<string, unknown>;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get API key from header
    const apiKey = req.headers.get("x-api-key");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ status: "error", message: "Missing API key" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client with service role for account lookup
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
      console.error("Invalid API key:", accountError);
      return new Response(
        JSON.stringify({ status: "error", message: "Invalid API key" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const payload: EventPayload = await req.json();
    console.log("Received event:", payload.idempotency_key, payload.event_type);

    // Check for duplicate (idempotency)
    const { data: existingEvent } = await supabase
      .from("events")
      .select("id")
      .eq("idempotency_key", payload.idempotency_key)
      .single();

    if (existingEvent) {
      console.log("Duplicate event:", payload.idempotency_key);
      return new Response(
        JSON.stringify({ 
          status: "duplicate", 
          event_id: existingEvent.id,
          message: "Event already processed" 
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert event
    const { data: newEvent, error: insertError } = await supabase
      .from("events")
      .insert({
        idempotency_key: payload.idempotency_key,
        account_id: account.id,
        terminal_id: payload.terminal_id,
        event_type: payload.event_type,
        ticket: payload.ticket,
        symbol: payload.symbol,
        direction: payload.direction,
        lot_size: payload.lot_size,
        price: payload.price,
        sl: payload.sl,
        tp: payload.tp,
        commission: payload.commission || 0,
        swap: payload.swap || 0,
        profit: payload.profit,
        event_timestamp: payload.timestamp,
        raw_payload: payload.raw_payload,
        processed: false,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(
        JSON.stringify({ status: "error", message: insertError.message, retry_after: 5000 }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Process event into trades table
    await processEvent(supabase, newEvent, account.user_id);

    console.log("Event processed:", newEvent.id);
    return new Response(
      JSON.stringify({ 
        status: "accepted", 
        event_id: newEvent.id,
        message: "Event processed successfully" 
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error processing event:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ status: "error", message, retry_after: 5000 }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function processEvent(supabase: any, event: any, userId: string) {
  const { event_type, ticket, account_id } = event;

  // Find existing trade for this ticket
  const { data: existingTrade } = await supabase
    .from("trades")
    .select("*")
    .eq("ticket", ticket)
    .eq("account_id", account_id)
    .single();

  // Determine session from timestamp
  const hour = new Date(event.event_timestamp).getUTCHours();
  let session = "off_hours";
  if (hour >= 0 && hour < 8) session = "tokyo";
  else if (hour >= 8 && hour < 13) session = "london";
  else if (hour >= 13 && hour < 17) session = "overlap_london_ny";
  else if (hour >= 17 && hour < 22) session = "new_york";

  if (event_type === "open") {
    // Create new trade
    await supabase.from("trades").insert({
      user_id: userId,
      account_id: account_id,
      terminal_id: event.terminal_id,
      ticket: ticket,
      symbol: event.symbol,
      direction: event.direction,
      total_lots: event.lot_size,
      entry_price: event.price,
      entry_time: event.event_timestamp,
      sl_initial: event.sl,
      tp_initial: event.tp,
      sl_final: event.sl,
      tp_final: event.tp,
      session: session,
      is_open: true,
    });
  } else if (event_type === "modify" && existingTrade) {
    // Update SL/TP
    await supabase.from("trades").update({
      sl_final: event.sl,
      tp_final: event.tp,
    }).eq("id", existingTrade.id);
  } else if (event_type === "partial_close" && existingTrade) {
    // Add to partial closes array
    const partialCloses = existingTrade.partial_closes || [];
    partialCloses.push({
      time: event.event_timestamp,
      lots: event.lot_size,
      price: event.price,
      pnl: event.profit || 0,
    });
    
    await supabase.from("trades").update({
      partial_closes: partialCloses,
      total_lots: existingTrade.total_lots - event.lot_size,
    }).eq("id", existingTrade.id);
  } else if (event_type === "close" && existingTrade) {
    // Close the trade
    const duration = Math.floor(
      (new Date(event.event_timestamp).getTime() - new Date(existingTrade.entry_time).getTime()) / 1000
    );
    
    // Calculate R-multiple if SL was set
    let rMultiple = null;
    if (existingTrade.sl_initial && event.profit) {
      const risk = Math.abs(existingTrade.entry_price - existingTrade.sl_initial) * existingTrade.total_lots;
      if (risk > 0) {
        rMultiple = event.profit / risk;
      }
    }

    await supabase.from("trades").update({
      exit_price: event.price,
      exit_time: event.event_timestamp,
      gross_pnl: event.profit,
      commission: (existingTrade.commission || 0) + (event.commission || 0),
      swap: (existingTrade.swap || 0) + (event.swap || 0),
      net_pnl: event.profit - (event.commission || 0) - (event.swap || 0),
      r_multiple_actual: rMultiple,
      duration_seconds: duration,
      is_open: false,
    }).eq("id", existingTrade.id);
  }

  // Mark event as processed
  await supabase.from("events").update({ processed: true }).eq("id", event.id);
}