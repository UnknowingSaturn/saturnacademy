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
  // Accept all event types including history_sync
  event_type: "entry" | "exit" | "history_sync" | "open" | "modify" | "partial_close" | "close";
  // For history_sync, this contains the actual event type (entry/exit)
  original_event_type?: "entry" | "exit";
  // Accept all three IDs explicitly
  position_id: number;
  deal_id: number;
  order_id: number;
  // Legacy field for backwards compatibility
  ticket?: number;
  symbol: string;
  direction: "buy" | "sell";
  lot_size: number;
  price: number;
  sl?: number;
  tp?: number;
  commission?: number;
  swap?: number;
  profit?: number;
  // Accept both UTC timestamp and server_time
  timestamp: string;
  server_time?: string;
  // NEW: Timezone offset from broker server
  timezone_offset_seconds?: number;
  // NEW: Equity at entry for R% calculation
  equity_at_entry?: number;
  // NEW: Entry details for orphan exit handling
  entry_price?: number;
  entry_time?: string;
  account_info?: AccountInfo;
  raw_payload?: Record<string, unknown>;
}

// Helper: Get pip size for a symbol (5-digit vs 3-digit pricing)
function getPipSize(symbol: string): number {
  const normalized = symbol.toUpperCase().replace(/[^A-Z]/g, '');
  // JPY pairs use 0.01 (3-digit pricing shows as 0.001)
  if (normalized.includes('JPY')) {
    return 0.01;
  }
  // Gold/Silver
  if (normalized.includes('XAU') || normalized.includes('GOLD')) {
    return 0.1;
  }
  if (normalized.includes('XAG') || normalized.includes('SILVER')) {
    return 0.01;
  }
  // Most forex pairs use 0.0001
  return 0.0001;
}

// Helper: Get approximate pip value in USD for a given lot size
function getPipValue(symbol: string, lots: number): number {
  const normalized = symbol.toUpperCase().replace(/[^A-Z]/g, '');
  // Standard lot = 100,000 units
  // For pairs ending in USD, pip value is straightforward
  // For JPY pairs: 1 pip = 0.01 yen per unit, so 100,000 units = 1000 yen ≈ $6.67
  // For simplicity, we use approximate values
  
  if (normalized.includes('JPY')) {
    // JPY pairs: ~$7-8 per pip per standard lot
    return lots * 7.5;
  }
  if (normalized.includes('XAU') || normalized.includes('GOLD')) {
    // Gold: 1 pip (0.1) = $10 per standard lot
    return lots * 10;
  }
  if (normalized.includes('XAG') || normalized.includes('SILVER')) {
    // Silver: 1 pip (0.01) = $50 per standard lot
    return lots * 50;
  }
  // Most forex pairs ending in USD: $10 per pip per standard lot
  // Other pairs vary but $10 is a reasonable approximation
  return lots * 10;
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
    console.log("Received event:", payload.idempotency_key, payload.event_type, "position:", payload.position_id, "deal:", payload.deal_id);

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
      // FIX: Add expires_at check to prevent use of expired tokens
      const { data: setupToken, error: tokenError } = await supabase
        .from("setup_tokens")
        .select("user_id, used, sync_history_enabled, sync_history_from")
        .eq("token", apiKey)
        .gt("expires_at", new Date().toISOString())
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

      // Create the account with sync settings from setup token
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
          sync_history_enabled: setupToken.sync_history_enabled ?? true,
          sync_history_from: setupToken.sync_history_from,
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
      console.log("Auto-created account:", account.id, accountName, "sync_history_enabled:", setupToken.sync_history_enabled, "sync_history_from:", setupToken.sync_history_from);
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

    // SERVER-SIDE FILTERING: Skip history_sync events older than sync_history_from
    if (payload.event_type === "history_sync") {
      // Fetch account sync settings
      const { data: accountSettings } = await supabase
        .from("accounts")
        .select("sync_history_enabled, sync_history_from")
        .eq("id", account.id)
        .single();

      // Skip if sync is disabled
      if (accountSettings && accountSettings.sync_history_enabled === false) {
        console.log("History sync disabled, skipping event:", payload.idempotency_key);
        return new Response(
          JSON.stringify({ 
            status: "skipped", 
            reason: "history_sync_disabled",
            message: "Historical sync is disabled for this account" 
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Skip if event is older than sync_history_from
      if (accountSettings?.sync_history_from) {
        const eventTime = new Date(payload.timestamp);
        const syncCutoff = new Date(accountSettings.sync_history_from);

        if (eventTime < syncCutoff) {
          console.log("Event before sync cutoff, skipping:", 
            payload.idempotency_key, 
            "event:", eventTime.toISOString(), 
            "cutoff:", syncCutoff.toISOString());
          return new Response(
            JSON.stringify({ 
              status: "skipped", 
              reason: "before_sync_cutoff",
              message: "Event is older than configured sync date" 
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
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

    // Map new event types to database enum values
    // For history_sync, use the original_event_type to determine actual event
    let dbEventType = payload.event_type;
    let effectiveEventType = payload.event_type;
    
    if (payload.event_type === "history_sync") {
      // History sync events use original_event_type for processing
      effectiveEventType = payload.original_event_type || "entry";
      dbEventType = effectiveEventType === "entry" ? "open" : "close";
      console.log("Processing history sync event, original type:", effectiveEventType);
    } else if (payload.event_type === "entry") {
      dbEventType = "open";
    } else if (payload.event_type === "exit") {
      // Will be determined as partial_close or close during processing
      dbEventType = "close"; // Default, will be updated if partial
    }

    // Use position_id as the trade grouping key (was previously called ticket)
    const tradeTicket = payload.position_id || payload.ticket;

    // Insert event
    const { data: newEvent, error: insertError } = await supabase
      .from("events")
      .insert({
        idempotency_key: payload.idempotency_key,
        account_id: account.id,
        terminal_id: payload.terminal_id,
        event_type: dbEventType,
        ticket: tradeTicket,
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
      raw_payload: {
        ...payload.raw_payload,
        // Store all IDs in raw_payload for reference
        position_id: payload.position_id,
        deal_id: payload.deal_id,
        order_id: payload.order_id,
        server_time: payload.server_time,
        timezone_offset_seconds: payload.timezone_offset_seconds,
        equity_at_entry: payload.equity_at_entry,
        // Store entry details for orphan exit handling
        entry_price: payload.entry_price,
        entry_time: payload.entry_time,
      },
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
    await processEvent(supabase, newEvent, account.user_id, payload);

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

async function processEvent(supabase: any, event: any, userId: string, originalPayload: EventPayload) {
  const { event_type, ticket, account_id, lot_size } = event;
  // For history_sync, use original_event_type; otherwise use the payload event_type
  const effectiveEventType = originalPayload.event_type === "history_sync" 
    ? originalPayload.original_event_type 
    : originalPayload.event_type;

  // Find existing trade for this position_id (ticket in DB)
  const { data: existingTrade } = await supabase
    .from("trades")
    .select("*")
    .eq("ticket", ticket)
    .eq("account_id", account_id)
    .single();

  // Determine session from timestamp - use America/New_York (DST-aware)
  const eventDate = new Date(event.event_timestamp);
  
  // Use Intl.DateTimeFormat to get the hour in America/New_York timezone (handles DST)
  const etFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  
  const parts = etFormatter.formatToParts(eventDate);
  const etHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const etMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  const etTime = etHour + etMinute / 60;
  
  // Session detection priority (London takes precedence in the 03:00-04:00 overlap):
  // - London: 03:00 - 08:00 ET (checked first to capture 03:00-04:00)
  // - Tokyo: 19:00 - 03:00 ET (after London close)
  // - New York AM: 08:00 - 12:00 ET
  // - New York PM: 12:00 - 17:00 ET
  // - Off Hours: 17:00 - 19:00 ET
  let session = "off_hours";
  if (etTime >= 3 && etTime < 8) {
    session = "london";
  } else if (etTime >= 8 && etTime < 12) {
    session = "new_york_am";
  } else if (etTime >= 12 && etTime < 17) {
    session = "new_york_pm";
  } else if (etTime >= 19 || etTime < 3) {
    session = "tokyo";
  }
  
  console.log("Session detection:", { 
    utcTime: eventDate.toISOString(), 
    etHour, 
    etMinute, 
    etTime: etTime.toFixed(2), 
    session 
  });

  // Fetch account data for balance/equity tracking
  const { data: accountData } = await supabase
    .from("accounts")
    .select("balance_start, equity_current")
    .eq("id", account_id)
    .single();
  
  const currentEquity = accountData?.equity_current || accountData?.balance_start || 0;

  // Handle entry event (open) - including history_sync entries
  if (effectiveEventType === "entry" || event_type === "open") {
    if (existingTrade) {
      // Trade already exists - might be adding to position
      console.log("Trade already exists for position:", ticket);
    } else {
      // Use equity_at_entry from payload if provided, otherwise use current equity
      const equityAtEntry = originalPayload.equity_at_entry || currentEquity;
      
      // Create new trade - store original_lots, balance_at_entry, and equity_at_entry
      await supabase.from("trades").insert({
        user_id: userId,
        account_id: account_id,
        terminal_id: event.terminal_id,
        ticket: ticket,
        symbol: event.symbol,
        direction: event.direction,
        total_lots: event.lot_size,
        original_lots: event.lot_size,
        entry_price: event.price,
        entry_time: event.event_timestamp,
        sl_initial: event.sl,
        tp_initial: event.tp,
        sl_final: event.sl,
        tp_final: event.tp,
        session: session,
        is_open: true,
        balance_at_entry: currentEquity, // Keep for backwards compatibility
        equity_at_entry: equityAtEntry, // NEW: Actual equity snapshot for R% calculation
      });
      console.log("Created new trade for position:", ticket, "equity_at_entry:", equityAtEntry);
    }
  } 
  // Handle exit event - determine if partial or full close (including history_sync exits)
  else if (effectiveEventType === "exit" || event_type === "close" || event_type === "partial_close") {
    if (!existingTrade) {
      // ORPHAN EXIT: Create a closed trade from exit event data
      console.log("Orphan exit event - creating closed trade for position:", ticket);
      
      // Extract entry details from raw_payload if available
      const rawPayload = event.raw_payload || {};
      const entryPrice = rawPayload.entry_price || originalPayload.entry_price || event.price;
      const entryTime = rawPayload.entry_time || originalPayload.entry_time || event.event_timestamp;
      
      // Calculate duration
      const entryDate = new Date(entryTime);
      const exitDate = new Date(event.event_timestamp);
      const duration = Math.floor((exitDate.getTime() - entryDate.getTime()) / 1000);
      
      // Calculate net PnL
      const grossPnl = event.profit || 0;
      const commission = event.commission || 0;
      const swap = event.swap || 0;
      const netPnl = grossPnl - commission - Math.abs(swap);
      
      // R% calculation using actual risk (|entry - SL| × lots × pip value)
      let rMultiple = null;
      const equityAtEntry = rawPayload.equity_at_entry || originalPayload.equity_at_entry || currentEquity;
      const slPrice = event.sl;
      
      if (slPrice && entryPrice && slPrice !== entryPrice) {
        // Calculate risk in pips
        const pipSize = getPipSize(event.symbol);
        const stopDistancePips = Math.abs(entryPrice - slPrice) / pipSize;
        // Calculate pip value (approximate - for Forex pairs ending in USD, 1 standard lot = $10/pip)
        const pipValue = getPipValue(event.symbol, lot_size);
        const riskAmount = stopDistancePips * pipValue;
        
        if (riskAmount > 0) {
          // R = Net PnL / Risk Amount (as a ratio, stored as percentage)
          rMultiple = Math.round((netPnl / riskAmount) * 100) / 100;
          console.log("R calc (orphan):", { stopDistancePips, pipValue, riskAmount, netPnl, rMultiple });
        }
      } else if (equityAtEntry && equityAtEntry > 0) {
        // Fallback to equity-based if no SL
        rMultiple = Math.round((netPnl / equityAtEntry) * 10000) / 100;
      }
      
      // Create closed trade
      const { data: newTrade, error: tradeError } = await supabase.from("trades").insert({
        user_id: userId,
        account_id: account_id,
        terminal_id: event.terminal_id,
        ticket: ticket,
        symbol: event.symbol,
        direction: event.direction,
        total_lots: 0, // Closed
        original_lots: lot_size,
        entry_price: entryPrice,
        entry_time: entryTime,
        exit_price: event.price,
        exit_time: event.event_timestamp,
        sl_initial: event.sl,
        tp_initial: event.tp,
        sl_final: event.sl,
        tp_final: event.tp,
        gross_pnl: grossPnl,
        commission: commission,
        swap: swap,
        net_pnl: netPnl,
        r_multiple_actual: rMultiple,
        duration_seconds: duration > 0 ? duration : null,
        session: session,
        is_open: false,
        balance_at_entry: currentEquity,
        equity_at_entry: equityAtEntry,
      }).select().single();
      
      if (tradeError) {
        console.error("Failed to create orphan trade:", tradeError);
      } else {
        console.log("Created closed trade from orphan exit:", ticket, "PnL:", netPnl, "R%:", rMultiple);
      }
      
      // Mark event as processed
      await supabase.from("events").update({ processed: true }).eq("id", event.id);
      return;
    }

    // Calculate remaining lots after this exit
    const remainingLots = existingTrade.total_lots - lot_size;
    const isPartialClose = remainingLots > 0.001; // Small tolerance for floating point

    if (isPartialClose) {
      // Partial close - add to partial_closes array
      const partialCloses = existingTrade.partial_closes || [];
      partialCloses.push({
        time: event.event_timestamp,
        lots: lot_size,
        price: event.price,
        pnl: event.profit || 0,
        deal_id: originalPayload.deal_id,
      });
      
      await supabase.from("trades").update({
        partial_closes: partialCloses,
        total_lots: remainingLots,
        // Update SL/TP if provided
        sl_final: event.sl || existingTrade.sl_final,
        tp_final: event.tp || existingTrade.tp_final,
      }).eq("id", existingTrade.id);

      // Update event type to partial_close
      await supabase.from("events").update({ event_type: "partial_close" }).eq("id", event.id);
      console.log("Processed partial close for position:", ticket, "remaining lots:", remainingLots);
    } else {
      // Full close
      const duration = Math.floor(
        (new Date(event.event_timestamp).getTime() - new Date(existingTrade.entry_time).getTime()) / 1000
      );
      
      // Calculate total PnL including partials
      let totalGrossPnl = event.profit || 0;
      let totalCommission = event.commission || 0;
      let totalSwap = event.swap || 0;
      
      // Add PnL from partial closes
      if (existingTrade.partial_closes) {
        for (const partial of existingTrade.partial_closes) {
          totalGrossPnl += partial.pnl || 0;
        }
      }
      // Add existing commission/swap
      totalCommission += existingTrade.commission || 0;
      totalSwap += existingTrade.swap || 0;
      
      const netPnl = totalGrossPnl - totalCommission - Math.abs(totalSwap);
      
      // Calculate R-multiple using actual risk (|entry - SL| × lots × pip value)
      let rMultiple = null;
      const slPrice = existingTrade.sl_initial || existingTrade.sl_final;
      const entryPrice = existingTrade.entry_price;
      const originalLots = existingTrade.original_lots || existingTrade.total_lots;
      
      if (slPrice && entryPrice && slPrice !== entryPrice) {
        // Calculate risk in pips
        const pipSize = getPipSize(existingTrade.symbol);
        const stopDistancePips = Math.abs(entryPrice - slPrice) / pipSize;
        // Calculate pip value based on lots
        const pipValue = getPipValue(existingTrade.symbol, originalLots);
        const riskAmount = stopDistancePips * pipValue;
        
        if (riskAmount > 0) {
          // R = Net PnL / Risk Amount (as a ratio, e.g., 1.5R, -0.5R)
          rMultiple = Math.round((netPnl / riskAmount) * 100) / 100;
          console.log("R calc:", { symbol: existingTrade.symbol, entry: entryPrice, sl: slPrice, stopDistancePips, pipValue, lots: originalLots, riskAmount, netPnl, rMultiple });
        }
      } else {
        // Fallback to equity-based if no SL (stored as percentage)
        const equityAtEntry = existingTrade.equity_at_entry || existingTrade.balance_at_entry;
        if (equityAtEntry && equityAtEntry > 0) {
          rMultiple = Math.round((netPnl / equityAtEntry) * 10000) / 100;
        }
      }

      // Update account equity_current after trade closes
      const equityForUpdate = existingTrade.equity_at_entry || existingTrade.balance_at_entry || currentEquity;
      const newEquity = equityForUpdate + netPnl;
      await supabase.from("accounts").update({
        equity_current: newEquity
      }).eq("id", account_id);

      await supabase.from("trades").update({
        exit_price: event.price,
        exit_time: event.event_timestamp,
        gross_pnl: totalGrossPnl,
        commission: totalCommission,
        swap: totalSwap,
        net_pnl: netPnl,
        r_multiple_actual: rMultiple,
        duration_seconds: duration,
        is_open: false,
        total_lots: 0, // All closed
        sl_final: event.sl || existingTrade.sl_final,
        tp_final: event.tp || existingTrade.tp_final,
      }).eq("id", existingTrade.id);
      
      console.log("Processed full close for position:", ticket, "PnL:", netPnl, "R:", rMultiple, "equity:", equityForUpdate, "new equity:", newEquity);
    }
  }
  // Handle legacy modify event
  else if (event_type === "modify" && existingTrade) {
    await supabase.from("trades").update({
      sl_final: event.sl,
      tp_final: event.tp,
    }).eq("id", existingTrade.id);
    console.log("Processed modify for position:", ticket);
  }

  // Mark event as processed
  await supabase.from("events").update({ processed: true }).eq("id", event.id);
}