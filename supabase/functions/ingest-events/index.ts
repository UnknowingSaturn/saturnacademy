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
  ea_type?: "journal" | "master" | "receiver";
  event_type: "entry" | "exit" | "history_sync" | "open" | "modify" | "partial_close" | "close" | "position_snapshot" | "heartbeat";
  open_position_tickets?: number[];
  original_event_type?: "entry" | "exit";
  position_id: number;
  deal_id: number;
  order_id: number;
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
  timestamp: string;
  server_time?: string;
  timezone_offset_seconds?: number;
  equity_at_entry?: number;
  entry_price?: number;
  entry_time?: string;
  spread?: number;
  // Heartbeat fields
  ea_version?: string;
  open_positions_count?: number;
  leverage?: number;
  margin_free?: number;
  margin_level?: number;
  broker_utc_offset?: number;
  account_info?: AccountInfo;
  raw_payload?: Record<string, unknown>;
}

// Helper: Get pip size for a symbol (5-digit vs 3-digit pricing)
function getPipSize(symbol: string): number {
  const normalized = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (normalized.includes('JPY')) return 0.01;
  if (normalized.includes('XAU') || normalized.includes('GOLD')) return 0.1;
  if (normalized.includes('XAG') || normalized.includes('SILVER')) return 0.01;
  if (normalized.includes('SP500') || normalized.includes('SPX') || normalized.includes('US500')) return 0.01;
  if (normalized.includes('NAS') || normalized.includes('USTEC') || normalized.includes('US100')) return 0.01;
  if (normalized.includes('US30') || normalized.includes('DJ30') || normalized.includes('DOW')) return 1.0;
  if (normalized.includes('DAX') || normalized.includes('DE40') || normalized.includes('GER40')) return 0.1;
  if (normalized.includes('FTSE') || normalized.includes('UK100')) return 0.1;
  if (normalized.includes('OIL') || normalized.includes('BRENT') || normalized.includes('WTI') || 
      normalized.includes('USOIL') || normalized.includes('XTIUSD')) return 0.01;
  if (normalized.includes('BTC') || normalized.includes('BITCOIN')) return 1.0;
  if (normalized.includes('ETH')) return 0.01;
  return 0.0001;
}

// Helper: Get approximate pip value in USD for a given lot size
function getPipValue(symbol: string, lots: number): number {
  const normalized = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (normalized.includes('JPY')) return lots * 7.5;
  if (normalized.includes('XAU') || normalized.includes('GOLD')) return lots * 10;
  if (normalized.includes('XAG') || normalized.includes('SILVER')) return lots * 50;
  if (normalized.includes('SP500') || normalized.includes('SPX') || normalized.includes('US500')) return lots * 0.50;
  if (normalized.includes('NAS') || normalized.includes('USTEC') || normalized.includes('US100')) return lots * 0.20;
  if (normalized.includes('US30') || normalized.includes('DJ30') || normalized.includes('DOW')) return lots * 0.10;
  if (normalized.includes('DAX') || normalized.includes('DE40') || normalized.includes('GER40')) return lots * 0.10;
  if (normalized.includes('OIL') || normalized.includes('BRENT') || normalized.includes('WTI') ||
      normalized.includes('USOIL') || normalized.includes('XTIUSD')) return lots * 10;
  if (normalized.includes('BTC') || normalized.includes('BITCOIN')) return lots * 1.0;
  if (normalized.includes('ETH')) return lots * 1.0;
  return lots * 10;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = req.headers.get("x-api-key");
    if (!apiKey) {
      console.error("Missing API key");
      return new Response(
        JSON.stringify({ status: "error", message: "Missing API key" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
      
      const { data: setupToken, error: tokenError } = await supabase
        .from("setup_tokens")
        .select("user_id, used, sync_history_enabled, sync_history_from, copier_role, master_account_id")
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

      let propFirm = null;
      const serverLower = payload.account_info.server.toLowerCase();
      if (serverLower.includes("ftmo")) propFirm = "ftmo";
      else if (serverLower.includes("fundednext")) propFirm = "fundednext";

      const copierRole = setupToken.copier_role || 'independent';
      const isCopierAccount = copierRole !== 'independent';
      const eaType = copierRole !== 'independent' ? copierRole : (payload.ea_type || 'journal');

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
          copier_role: copierRole,
          copier_enabled: isCopierAccount,
          master_account_id: setupToken.master_account_id || null,
          ea_type: eaType,
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

      await supabase
        .from("setup_tokens")
        .update({ used: true, used_at: new Date().toISOString() })
        .eq("token", apiKey);

      account = newAccount;
      console.log("Auto-created account:", account.id, accountName, 
        "copier_role:", copierRole);
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

    // Update equity and ea_type if provided
    if (payload.account_info?.equity || payload.ea_type) {
      const updateData: Record<string, unknown> = {};
      if (payload.account_info?.equity) updateData.equity_current = payload.account_info.equity;
      if (payload.ea_type) updateData.ea_type = payload.ea_type;
      if (Object.keys(updateData).length > 0) {
        await supabase.from("accounts").update(updateData).eq("id", account.id);
      }
    }

    // ==========================================
    // Handle heartbeat event — update account health, no event/trade processing
    // ==========================================
    if (payload.event_type === "heartbeat") {
      console.log("Heartbeat received from terminal:", payload.terminal_id, 
        "equity:", payload.account_info?.equity, "positions:", payload.open_positions_count,
        "ea_version:", payload.ea_version);

      const heartbeatUpdate: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (payload.account_info?.equity) heartbeatUpdate.equity_current = payload.account_info.equity;

      // Auto-detect broker DST profile from observed offset history.
      // Only assign if account is still on the default 'MANUAL' profile, so we
      // never overwrite an explicit user choice.
      if (typeof payload.broker_utc_offset === 'number') {
        try {
          const { data: acc } = await supabase
            .from("accounts")
            .select("broker_dst_profile")
            .eq("id", account.id)
            .single();

          if (acc && (!acc.broker_dst_profile || acc.broker_dst_profile === 'MANUAL')) {
            // Look at offsets observed across recent heartbeat events for this account.
            const { data: recentHeartbeats } = await supabase
              .from("events")
              .select("event_timestamp, raw_payload")
              .eq("account_id", account.id)
              .order("event_timestamp", { ascending: false })
              .limit(200);

            const offsets = new Set<number>();
            (recentHeartbeats || []).forEach((e: any) => {
              const o = e.raw_payload?.broker_utc_offset;
              if (typeof o === 'number') offsets.add(o);
            });
            offsets.add(payload.broker_utc_offset);

            let detectedProfile: string | null = null;
            if (offsets.has(2) && offsets.has(3)) detectedProfile = 'EET_DST';
            else if (offsets.has(0) && offsets.has(1)) detectedProfile = 'GMT_DST';
            else if (offsets.size === 1) {
              const only = [...offsets][0];
              if (only === 0) detectedProfile = 'FIXED_PLUS_0';
              else if (only === 2) detectedProfile = 'FIXED_PLUS_2';
              else if (only === 3) detectedProfile = 'FIXED_PLUS_3';
              // Other fixed offsets stay as MANUAL with broker_utc_offset numeric
            }

            if (detectedProfile) {
              heartbeatUpdate.broker_dst_profile = detectedProfile;
              console.log(`Auto-detected broker DST profile: ${detectedProfile} for account ${account.id} (observed offsets: ${[...offsets].join(',')})`);
            }
          }
        } catch (err) {
          console.error("DST profile auto-detect failed (non-fatal):", err);
        }

        // Always keep the static numeric offset fresh as a fallback.
        heartbeatUpdate.broker_utc_offset = payload.broker_utc_offset;
      }

      await supabase.from("accounts").update(heartbeatUpdate).eq("id", account.id);

      return new Response(
        JSON.stringify({
          status: "accepted",
          message: "Heartbeat received",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ==========================================
    // Handle position_snapshot event
    // ==========================================
    if (payload.event_type === "position_snapshot") {
      const openTickets = payload.open_position_tickets || [];
      console.log("Position snapshot received:", openTickets.length, "open positions from terminal:", payload.terminal_id);

      const { data: openTrades, error: openTradesError } = await supabase
        .from("trades")
        .select("id, ticket, symbol, is_open")
        .eq("account_id", account.id)
        .eq("is_open", true);

      if (openTradesError) {
        console.error("Failed to fetch open trades for snapshot:", openTradesError);
        return new Response(
          JSON.stringify({ status: "error", message: "Failed to fetch open trades" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const staleTrades = (openTrades || []).filter(
        (trade: any) => trade.ticket && !openTickets.includes(trade.ticket)
      );

      let closedCount = 0;
      for (const staleTrade of staleTrades) {
        console.log("Closing stale trade:", staleTrade.id, "ticket:", staleTrade.ticket, "symbol:", staleTrade.symbol);
        
        const { error: updateError } = await supabase
          .from("trades")
          .update({
            is_open: false,
            exit_time: new Date().toISOString(),
            net_pnl: 0,
            gross_pnl: 0,
            partial_closes: JSON.stringify([{ type: "snapshot_closed", note: "Closed by position snapshot reconciliation — PnL data may be incomplete" }]),
          })
          .eq("id", staleTrade.id);

        if (!updateError) closedCount++;
        else console.error("Failed to close stale trade:", staleTrade.id, updateError);
      }

      console.log("Position snapshot reconciliation: closed", closedCount, "stale trades");

      return new Response(
        JSON.stringify({
          status: "accepted",
          message: `Snapshot processed: ${closedCount} stale trades closed`,
          open_in_mt5: openTickets.length,
          open_in_db: (openTrades || []).length,
          stale_closed: closedCount,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // SERVER-SIDE FILTERING: Skip history_sync events older than sync_history_from
    if (payload.event_type === "history_sync") {
      const { data: accountSettings } = await supabase
        .from("accounts")
        .select("sync_history_enabled, sync_history_from")
        .eq("id", account.id)
        .single();

      if (accountSettings && accountSettings.sync_history_enabled === false) {
        console.log("History sync disabled, skipping event:", payload.idempotency_key);
        return new Response(
          JSON.stringify({ status: "skipped", reason: "history_sync_disabled", message: "Historical sync is disabled for this account" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (accountSettings?.sync_history_from) {
        const eventTime = new Date(payload.timestamp);
        const syncCutoff = new Date(accountSettings.sync_history_from);
        if (eventTime < syncCutoff) {
          console.log("Event before sync cutoff, skipping:", payload.idempotency_key);
          return new Response(
            JSON.stringify({ status: "skipped", reason: "before_sync_cutoff", message: "Event is older than configured sync date" }),
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
        JSON.stringify({ status: "duplicate", event_id: existingEvent.id, message: "Event already processed" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Map event types to database enum values
    let dbEventType = payload.event_type;
    let effectiveEventType = payload.event_type;
    
    if (payload.event_type === "history_sync") {
      effectiveEventType = payload.original_event_type || "entry";
      dbEventType = effectiveEventType === "entry" ? "open" : "close";
    } else if (payload.event_type === "entry") {
      dbEventType = "open";
    } else if (payload.event_type === "exit") {
      dbEventType = "close";
    } else if (payload.event_type === "modify") {
      dbEventType = "modify";
    }

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
          position_id: payload.position_id,
          deal_id: payload.deal_id,
          order_id: payload.order_id,
          server_time: payload.server_time,
          timezone_offset_seconds: payload.timezone_offset_seconds,
          equity_at_entry: payload.equity_at_entry,
          entry_price: payload.entry_price,
          entry_time: payload.entry_time,
          spread: payload.spread,
          ea_version: payload.ea_version,
          broker_utc_offset: payload.broker_utc_offset,
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
  const effectiveEventType = originalPayload.event_type === "history_sync" 
    ? originalPayload.original_event_type 
    : originalPayload.event_type;

  // Find existing trade for this position_id
  const { data: existingTrade } = await supabase
    .from("trades")
    .select("*")
    .eq("ticket", ticket)
    .eq("account_id", account_id)
    .single();

  // Determine session from timestamp using user's session_definitions
  const sessions = await loadSessions(supabase, userId);
  const session = getSessionFromTime(event.event_timestamp, sessions);

  // Fetch account data
  const { data: accountData } = await supabase
    .from("accounts")
    .select("balance_start, equity_current")
    .eq("id", account_id)
    .single();
  
  const currentEquity = accountData?.equity_current || accountData?.balance_start || 0;

  // ==========================================
  // Handle MODIFY event — update SL/TP on existing trade
  // ==========================================
  if (effectiveEventType === "modify" || event_type === "modify") {
    if (existingTrade) {
      const updateData: Record<string, unknown> = {};
      if (event.sl) updateData.sl_final = event.sl;
      if (event.tp) updateData.tp_final = event.tp;
      
      await supabase.from("trades").update(updateData).eq("id", existingTrade.id);
      console.log("Processed SL/TP modify for position:", ticket, 
        "SL:", event.sl, "TP:", event.tp,
        "previous_sl:", originalPayload.raw_payload?.previous_sl,
        "previous_tp:", originalPayload.raw_payload?.previous_tp);
    } else {
      console.log("Modify event for unknown position:", ticket, "- ignoring");
    }
    await supabase.from("events").update({ processed: true }).eq("id", event.id);
    return;
  }

  // Handle entry event (open)
  if (effectiveEventType === "entry" || event_type === "open") {
    if (existingTrade) {
      console.log("Trade already exists for position:", ticket);
    } else {
      // Use equity_at_entry from payload if provided, otherwise use current equity
      const equityAtEntry = originalPayload.equity_at_entry || currentEquity;
      
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
        balance_at_entry: currentEquity,
        equity_at_entry: equityAtEntry,
      });
      console.log("Created new trade for position:", ticket, "equity_at_entry:", equityAtEntry);
    }
  } 
  // Handle exit event
  else if (effectiveEventType === "exit" || event_type === "close" || event_type === "partial_close") {
    if (!existingTrade) {
      // ORPHAN EXIT: Create a closed trade from exit event data
      console.log("Orphan exit event - creating closed trade for position:", ticket);
      
      const rawPayload = event.raw_payload || {};
      const entryPrice = rawPayload.entry_price || originalPayload.entry_price || event.price;
      const entryTime = rawPayload.entry_time || originalPayload.entry_time || event.event_timestamp;
      
      const entryDate = new Date(entryTime);
      const exitDate = new Date(event.event_timestamp);
      const duration = Math.floor((exitDate.getTime() - entryDate.getTime()) / 1000);
      
      const grossPnl = event.profit || 0;
      const commission = event.commission || 0;
      const swap = event.swap || 0;
      const netPnl = grossPnl - commission - Math.abs(swap);
      
      let rMultiple = null;
      const equityAtEntry = rawPayload.equity_at_entry || originalPayload.equity_at_entry || currentEquity;
      const slPrice = event.sl;
      
      if (slPrice && entryPrice && slPrice !== entryPrice) {
        const pipSize = getPipSize(event.symbol);
        const stopDistancePips = Math.abs(entryPrice - slPrice) / pipSize;
        const pipValue = getPipValue(event.symbol, lot_size);
        const riskAmount = stopDistancePips * pipValue;
        if (riskAmount > 0) {
          rMultiple = Math.round((netPnl / riskAmount) * 100) / 100;
        }
      } else if (equityAtEntry && equityAtEntry > 0) {
        rMultiple = Math.round((netPnl / equityAtEntry) * 10000) / 100;
      }
      
      await supabase.from("trades").insert({
        user_id: userId,
        account_id: account_id,
        terminal_id: event.terminal_id,
        ticket: ticket,
        symbol: event.symbol,
        direction: event.direction,
        total_lots: 0,
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
      });
      
      console.log("Created closed trade from orphan exit:", ticket, "PnL:", netPnl);
      await supabase.from("events").update({ processed: true }).eq("id", event.id);
      return;
    }

    // Calculate remaining lots after this exit
    const remainingLots = existingTrade.total_lots - lot_size;
    const isPartialClose = remainingLots > 0.001;

    if (isPartialClose) {
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
        sl_final: event.sl || existingTrade.sl_final,
        tp_final: event.tp || existingTrade.tp_final,
      }).eq("id", existingTrade.id);

      await supabase.from("events").update({ event_type: "partial_close" }).eq("id", event.id);
      console.log("Processed partial close for position:", ticket, "remaining lots:", remainingLots);
    } else {
      // Full close
      const duration = Math.floor(
        (new Date(event.event_timestamp).getTime() - new Date(existingTrade.entry_time).getTime()) / 1000
      );
      
      let totalGrossPnl = event.profit || 0;
      let totalCommission = event.commission || 0;
      let totalSwap = event.swap || 0;
      
      if (existingTrade.partial_closes) {
        for (const partial of existingTrade.partial_closes) {
          totalGrossPnl += partial.pnl || 0;
        }
      }
      totalCommission += existingTrade.commission || 0;
      totalSwap += existingTrade.swap || 0;
      
      const netPnl = totalGrossPnl - totalCommission - Math.abs(totalSwap);
      
      let rMultiple = null;
      const slPrice = existingTrade.sl_initial || existingTrade.sl_final;
      const entryPrice = existingTrade.entry_price;
      const originalLots = existingTrade.original_lots || existingTrade.total_lots;
      
      if (slPrice && entryPrice && slPrice !== entryPrice) {
        const pipSize = getPipSize(existingTrade.symbol);
        const stopDistancePips = Math.abs(entryPrice - slPrice) / pipSize;
        const pipValue = getPipValue(existingTrade.symbol, originalLots);
        const riskAmount = stopDistancePips * pipValue;
        if (riskAmount > 0) {
          rMultiple = Math.round((netPnl / riskAmount) * 100) / 100;
        }
      } else {
        const equityAtEntry = existingTrade.equity_at_entry || existingTrade.balance_at_entry;
        if (equityAtEntry && equityAtEntry > 0) {
          rMultiple = Math.round((netPnl / equityAtEntry) * 10000) / 100;
        }
      }

      // Update account equity
      const equityForUpdate = existingTrade.equity_at_entry || existingTrade.balance_at_entry || currentEquity;
      const newEquity = equityForUpdate + netPnl;
      await supabase.from("accounts").update({ equity_current: newEquity }).eq("id", account_id);

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
        total_lots: 0,
        sl_final: event.sl || existingTrade.sl_final,
        tp_final: event.tp || existingTrade.tp_final,
      }).eq("id", existingTrade.id);
      
      console.log("Processed full close for position:", ticket, "PnL:", netPnl, "R:", rMultiple);
    }
  }

  // Mark event as processed
  await supabase.from("events").update({ processed: true }).eq("id", event.id);
}

// ============================================================================
// Session classification — honors user's session_definitions table
// ============================================================================

interface SessionDefinition {
  key: string;
  start_hour: number;
  start_minute: number;
  end_hour: number;
  end_minute: number;
  timezone: string;
  sort_order: number;
  is_active: boolean;
}

const DEFAULT_SESSIONS: SessionDefinition[] = [
  { key: "london", start_hour: 3, start_minute: 0, end_hour: 8, end_minute: 0, timezone: "America/New_York", sort_order: 0, is_active: true },
  { key: "new_york_am", start_hour: 8, start_minute: 0, end_hour: 12, end_minute: 0, timezone: "America/New_York", sort_order: 1, is_active: true },
  { key: "new_york_pm", start_hour: 12, start_minute: 0, end_hour: 17, end_minute: 0, timezone: "America/New_York", sort_order: 2, is_active: true },
  { key: "off_hours", start_hour: 17, start_minute: 0, end_hour: 19, end_minute: 0, timezone: "America/New_York", sort_order: 3, is_active: true },
  { key: "tokyo", start_hour: 19, start_minute: 0, end_hour: 3, end_minute: 0, timezone: "America/New_York", sort_order: 4, is_active: true },
];

async function loadSessions(supabase: any, userId: string): Promise<SessionDefinition[]> {
  const { data, error } = await supabase
    .from("session_definitions")
    .select("key,start_hour,start_minute,end_hour,end_minute,timezone,sort_order,is_active")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("sort_order");
  if (error) {
    console.error("loadSessions error, falling back to defaults:", error);
    return DEFAULT_SESSIONS;
  }
  return data && data.length > 0 ? (data as SessionDefinition[]) : DEFAULT_SESSIONS;
}

function getSessionFromTime(timestamp: string, sessions: SessionDefinition[]): string {
  const date = new Date(timestamp);
  for (const session of sessions) {
    if (!session.is_active) continue;
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: session.timezone || "America/New_York",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
    const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
    const minutes = hour * 60 + minute;
    const startMin = session.start_hour * 60 + session.start_minute;
    const endMin = session.end_hour * 60 + session.end_minute;
    if (startMin > endMin) {
      if (minutes >= startMin || minutes < endMin) return session.key;
    } else {
      if (minutes >= startMin && minutes < endMin) return session.key;
    }
  }
  return "off_hours";
}
