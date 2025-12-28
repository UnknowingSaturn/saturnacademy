import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface AccountInfo {
  login: number;
  broker: string;
  server: string;
  balance: number;
  equity: number;
  account_type: "demo" | "live" | "prop";
}

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
  account_info?: AccountInfo;
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
      console.error("Missing API key");
      return new Response(
        JSON.stringify({ status: "error", message: "Missing API key" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client with service role for account lookup
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request body first to get account_info
    const payload: EventPayload = await req.json();
    console.log("Received event:", payload.idempotency_key, payload.event_type);

    // Look up account by API key
    let { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("id, user_id, terminal_id")
      .eq("api_key", apiKey)
      .eq("is_active", true)
      .single();

    // If no account found, try auto-creation if we have account_info
    if ((accountError || !account) && payload.account_info) {
      console.log("No account found, attempting auto-creation...");
      
      // Get user_id from api_key - check if this is a setup token
      const { data: setupToken, error: tokenError } = await supabase
        .from("setup_tokens")
        .select("user_id, used")
        .eq("token", apiKey)
        .single();

      if (tokenError || !setupToken) {
        console.error("Invalid API key and no valid setup token:", accountError);
        return new Response(
          JSON.stringify({ status: "error", message: "Invalid API key" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (setupToken.used) {
        console.error("Setup token already used");
        return new Response(
          JSON.stringify({ status: "error", message: "Setup token already used" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Detect prop firm from server name
      let propFirm = null;
      const serverLower = payload.account_info.server.toLowerCase();
      if (serverLower.includes("ftmo")) {
        propFirm = "ftmo";
      } else if (serverLower.includes("fundednext")) {
        propFirm = "fundednext";
      }

      // Create the account
      const accountName = `${payload.account_info.broker} - ${payload.account_info.login}`;
      const { data: newAccount, error: createError } = await supabase
        .from("accounts")
        .insert({
          user_id: setupToken.user_id,
          name: accountName,
          broker: payload.account_info.broker,
          account_number: String(payload.account_info.login),
          account_type: payload.account_info.account_type,
          balance_start: payload.account_info.balance,
          equity_current: payload.account_info.equity,
          terminal_id: payload.terminal_id,
          api_key: apiKey,
          prop_firm: propFirm,
          is_active: true,
        })
        .select("id, user_id, terminal_id")
        .single();

      if (createError) {
        console.error("Failed to create account:", createError);
        return new Response(
          JSON.stringify({ status: "error", message: "Failed to create account: " + createError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Mark setup token as used
      await supabase
        .from("setup_tokens")
        .update({ used: true, used_at: new Date().toISOString() })
        .eq("token", apiKey);

      account = newAccount;
      console.log("Auto-created account:", account.id, accountName);
    } else if (accountError || !account) {
      console.error("Invalid API key:", accountError);
      return new Response(
        JSON.stringify({ status: "error", message: "Invalid API key" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update terminal_id if not set
    if (!account.terminal_id && payload.terminal_id) {
      await supabase
        .from("accounts")
        .update({ terminal_id: payload.terminal_id })
        .eq("id", account.id);
    }

    // Update equity if provided
    if (payload.account_info?.equity) {
      await supabase
        .from("accounts")
        .update({ equity_current: payload.account_info.equity })
        .eq("id", account.id);
    }

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
        account_id: account.id,
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
