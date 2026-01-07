import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Session detection logic (DST-aware, same as ingest-events)
function detectSession(utcTimestamp: string): string {
  const date = new Date(utcTimestamp);
  
  // Use Intl.DateTimeFormat to get the hour in America/New_York timezone (handles DST)
  const etFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  
  const parts = etFormatter.formatToParts(date);
  const etHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const etMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  const etTime = etHour + etMinute / 60;

  // Session detection priority (London takes precedence in the 03:00-04:00 overlap):
  if (etTime >= 3 && etTime < 8) return "london";
  if (etTime >= 8 && etTime < 12) return "new_york_am";
  if (etTime >= 12 && etTime < 17) return "new_york_pm";
  if (etTime >= 19 || etTime < 3) return "tokyo";
  return "off_hours";
}

// Helper: Get pip size for a symbol
function getPipSize(symbol: string): number {
  const normalized = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  
  // JPY pairs
  if (normalized.includes('JPY')) return 0.01;
  
  // Precious metals
  if (normalized.includes('XAU') || normalized.includes('GOLD')) return 0.1;
  if (normalized.includes('XAG') || normalized.includes('SILVER')) return 0.01;
  
  // US Indices - quoted in points
  if (normalized.includes('SP500') || normalized.includes('SPX') || normalized.includes('US500')) return 0.01;
  if (normalized.includes('NAS') || normalized.includes('USTEC') || normalized.includes('US100')) return 0.01;
  if (normalized.includes('US30') || normalized.includes('DJ30') || normalized.includes('DOW')) return 1.0;
  if (normalized.includes('DAX') || normalized.includes('DE40') || normalized.includes('GER40')) return 0.1;
  if (normalized.includes('FTSE') || normalized.includes('UK100')) return 0.1;
  
  // Oil
  if (normalized.includes('OIL') || normalized.includes('BRENT') || normalized.includes('WTI') || 
      normalized.includes('USOIL') || normalized.includes('XTIUSD')) return 0.01;
  
  // Crypto
  if (normalized.includes('BTC') || normalized.includes('BITCOIN')) return 1.0;
  if (normalized.includes('ETH')) return 0.01;
  
  // Default forex
  return 0.0001;
}

// Helper: Get approximate pip value in USD
function getPipValue(symbol: string, lots: number): number {
  const normalized = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  
  // JPY pairs
  if (normalized.includes('JPY')) return lots * 7.5;
  
  // Precious metals
  if (normalized.includes('XAU') || normalized.includes('GOLD')) return lots * 10;
  if (normalized.includes('XAG') || normalized.includes('SILVER')) return lots * 50;
  
  // US Indices - pip value per lot (approximations)
  if (normalized.includes('SP500') || normalized.includes('SPX') || normalized.includes('US500')) return lots * 0.50;
  if (normalized.includes('NAS') || normalized.includes('USTEC') || normalized.includes('US100')) return lots * 0.20;
  if (normalized.includes('US30') || normalized.includes('DJ30') || normalized.includes('DOW')) return lots * 0.10;
  if (normalized.includes('DAX') || normalized.includes('DE40') || normalized.includes('GER40')) return lots * 0.10;
  
  // Oil
  if (normalized.includes('OIL') || normalized.includes('BRENT') || normalized.includes('WTI') ||
      normalized.includes('USOIL') || normalized.includes('XTIUSD')) return lots * 10;
  
  // Crypto
  if (normalized.includes('BTC') || normalized.includes('BITCOIN')) return lots * 1.0;
  if (normalized.includes('ETH')) return lots * 1.0;
  
  // Default forex
  return lots * 10;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get authorization header and verify user
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get user from token
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Reprocessing orphan exits for user:", user.id);

    // Get user's accounts
    const { data: accounts } = await supabase
      .from("accounts")
      .select("id, equity_current, balance_start")
      .eq("user_id", user.id);

    if (!accounts || accounts.length === 0) {
      return new Response(JSON.stringify({ recovered: 0, message: "No accounts found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accountIds = accounts.map(a => a.id);
    const accountEquityMap = new Map(accounts.map(a => [a.id, a.equity_current || a.balance_start || 0]));

    // Find all processed close events for user's accounts (exit events are stored as "close" in the db)
    const { data: exitEvents, error: eventsError } = await supabase
      .from("events")
      .select("*")
      .in("account_id", accountIds)
      .eq("event_type", "close")
      .eq("processed", true)
      .order("event_timestamp", { ascending: true });

    if (eventsError) {
      console.error("Error fetching events:", eventsError);
      throw eventsError;
    }

    console.log(`Found ${exitEvents?.length || 0} processed exit events to check`);

    let recovered = 0;
    const recoveredTrades: string[] = [];

    for (const event of exitEvents || []) {
      const ticket = event.ticket;

      // Check if trade exists for this ticket
      const { data: existingTrade } = await supabase
        .from("trades")
        .select("id")
        .eq("ticket", ticket)
        .eq("user_id", user.id)
        .maybeSingle();

      if (existingTrade) {
        // Trade already exists, skip
        continue;
      }

      console.log("Found orphan exit event for ticket:", ticket);

      // Extract data from event
      const rawPayload = event.raw_payload || {};
      const entryPrice = rawPayload.entry_price || event.price;
      const entryTime = rawPayload.entry_time || event.event_timestamp;
      
      // Calculate duration
      const entryDate = new Date(entryTime);
      const exitDate = new Date(event.event_timestamp);
      const duration = Math.floor((exitDate.getTime() - entryDate.getTime()) / 1000);
      
      // Calculate PnL
      const grossPnl = event.profit || 0;
      const commission = event.commission || 0;
      const swap = event.swap || 0;
      const netPnl = grossPnl - commission - Math.abs(swap);
      
      // Get session
      const session = detectSession(entryTime);
      
      // R-multiple calculation using actual risk
      const currentEquity = accountEquityMap.get(event.account_id) || 0;
      const equityAtEntry = rawPayload.equity_at_entry || currentEquity;
      const slPrice = event.sl;
      let rMultiple = null;
      
      if (slPrice && entryPrice && slPrice !== entryPrice) {
        const pipSize = getPipSize(event.symbol);
        const stopDistancePips = Math.abs(entryPrice - slPrice) / pipSize;
        const pipValue = getPipValue(event.symbol, event.lot_size);
        const riskAmount = stopDistancePips * pipValue;
        
        if (riskAmount > 0) {
          rMultiple = Math.round((netPnl / riskAmount) * 100) / 100;
        }
      } else if (equityAtEntry && equityAtEntry > 0) {
        // Fallback to equity-based
        rMultiple = Math.round((netPnl / equityAtEntry) * 10000) / 100;
      }

      // Create the trade
      const { error: insertError } = await supabase.from("trades").insert({
        user_id: user.id,
        account_id: event.account_id,
        terminal_id: event.terminal_id,
        ticket: ticket,
        symbol: event.symbol,
        direction: event.direction,
        total_lots: 0,
        original_lots: event.lot_size,
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

      if (insertError) {
        console.error("Failed to create trade for ticket:", ticket, insertError);
      } else {
        recovered++;
        recoveredTrades.push(`${event.symbol} #${ticket}`);
        console.log("Recovered trade:", ticket, event.symbol, "PnL:", netPnl);
      }
    }

    console.log(`Recovery complete: ${recovered} trades recovered`);

    return new Response(
      JSON.stringify({ 
        recovered, 
        trades: recoveredTrades,
        message: recovered > 0 
          ? `Recovered ${recovered} missed trade(s)` 
          : "No missed trades found" 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Internal error";
    console.error("Reprocess error:", error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
