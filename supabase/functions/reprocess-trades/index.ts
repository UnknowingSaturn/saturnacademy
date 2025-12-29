import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ReprocessRequest {
  account_id: string;
  use_custom_sessions?: boolean;
}

interface SessionDefinition {
  name: string;
  key: string;
  start_hour: number;
  start_minute: number;
  end_hour: number;
  end_minute: number;
  timezone: string;
  is_active: boolean;
}

// Default sessions if user hasn't defined any
const DEFAULT_SESSIONS: SessionDefinition[] = [
  { name: 'Tokyo', key: 'tokyo', start_hour: 19, start_minute: 0, end_hour: 4, end_minute: 0, timezone: 'America/New_York', is_active: true },
  { name: 'London', key: 'london', start_hour: 3, start_minute: 0, end_hour: 8, end_minute: 0, timezone: 'America/New_York', is_active: true },
  { name: 'NY AM', key: 'new_york_am', start_hour: 8, start_minute: 0, end_hour: 12, end_minute: 0, timezone: 'America/New_York', is_active: true },
  { name: 'NY PM', key: 'new_york_pm', start_hour: 12, start_minute: 0, end_hour: 17, end_minute: 0, timezone: 'America/New_York', is_active: true },
  { name: 'Off Hours', key: 'off_hours', start_hour: 17, start_minute: 0, end_hour: 19, end_minute: 0, timezone: 'America/New_York', is_active: true },
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { account_id, use_custom_sessions = true }: ReprocessRequest = await req.json();

    if (!account_id) {
      return new Response(
        JSON.stringify({ error: "account_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get account data
    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("*")
      .eq("id", account_id)
      .single();

    if (accountError || !account) {
      return new Response(
        JSON.stringify({ error: "Account not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    console.log(`Recalculating trade data for account ${account_id}`);

    // Fetch user's custom session definitions if enabled
    let sessions: SessionDefinition[] = DEFAULT_SESSIONS;
    
    if (use_custom_sessions) {
      const { data: customSessions, error: sessionsError } = await supabase
        .from("session_definitions")
        .select("*")
        .eq("user_id", account.user_id)
        .eq("is_active", true)
        .order("sort_order");

      if (!sessionsError && customSessions && customSessions.length > 0) {
        sessions = customSessions as SessionDefinition[];
        console.log(`Using ${sessions.length} custom session definitions`);
      } else {
        console.log("Using default session definitions");
      }
    }

    // Fetch all trades for this account
    const { data: trades, error: tradesError } = await supabase
      .from("trades")
      .select("*")
      .eq("account_id", account_id)
      .order("entry_time", { ascending: true });

    if (tradesError) {
      console.error("Error fetching trades:", tradesError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch trades" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!trades || trades.length === 0) {
      return new Response(
        JSON.stringify({ message: "No trades to recalculate", trades_updated: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${trades.length} trades to recalculate`);

    let updatedCount = 0;
    let runningBalance = account.balance_start || 0;

    // Sort closed trades by entry_time for proper equity tracking
    const closedTrades = trades.filter(t => !t.is_open).sort(
      (a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime()
    );
    const openTrades = trades.filter(t => t.is_open);

    // Process closed trades first to build equity history
    for (const trade of closedTrades) {
      try {
        // Use entry_time directly - it's already in UTC from ingestion
        const entryTime = new Date(trade.entry_time);

        // Calculate session from entry time using custom or default sessions
        const session = getSessionFromTime(entryTime, sessions);

        // Calculate R% using equity_at_entry if available, otherwise use running balance
        const equityAtEntry = trade.equity_at_entry || runningBalance;
        let rMultiple = null;
        if (equityAtEntry > 0 && trade.net_pnl !== null) {
          rMultiple = Math.round((trade.net_pnl / equityAtEntry) * 10000) / 100;
        }

        // Update the trade - only session, balance, and R%
        const { error: updateError } = await supabase
          .from("trades")
          .update({
            session: session,
            balance_at_entry: runningBalance,
            r_multiple_actual: rMultiple,
          })
          .eq("id", trade.id);

        if (updateError) {
          console.error(`Error updating trade ${trade.id}:`, updateError);
        } else {
          updatedCount++;
          // Update running balance for next trade
          if (trade.net_pnl !== null) {
            runningBalance += trade.net_pnl;
          }
        }
      } catch (err) {
        console.error(`Error processing trade ${trade.id}:`, err);
      }
    }

    // Process open trades
    for (const trade of openTrades) {
      try {
        const entryTime = new Date(trade.entry_time);
        const session = getSessionFromTime(entryTime, sessions);

        const { error: updateError } = await supabase
          .from("trades")
          .update({
            session: session,
            balance_at_entry: runningBalance,
          })
          .eq("id", trade.id);

        if (updateError) {
          console.error(`Error updating open trade ${trade.id}:`, updateError);
        } else {
          updatedCount++;
        }
      } catch (err) {
        console.error(`Error processing open trade ${trade.id}:`, err);
      }
    }

    console.log(`Recalculation complete. Updated ${updatedCount} trades.`);

    return new Response(
      JSON.stringify({
        message: "Trade data recalculated successfully",
        trades_updated: updatedCount,
        sessions_used: sessions.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in reprocess-trades:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Helper function to determine session from timestamp using custom or default definitions
function getSessionFromTime(date: Date, sessions: SessionDefinition[]): string {
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
  const etTimeInMinutes = etHour * 60 + etMinute;

  // Check each session definition
  for (const session of sessions) {
    if (!session.is_active) continue;

    const startMinutes = session.start_hour * 60 + session.start_minute;
    const endMinutes = session.end_hour * 60 + session.end_minute;

    // Handle overnight sessions (e.g., Tokyo: 19:00 - 04:00)
    if (startMinutes > endMinutes) {
      // Session spans midnight
      if (etTimeInMinutes >= startMinutes || etTimeInMinutes < endMinutes) {
        return session.key;
      }
    } else {
      // Normal session within same day
      if (etTimeInMinutes >= startMinutes && etTimeInMinutes < endMinutes) {
        return session.key;
      }
    }
  }
  
  return "off_hours";
}
