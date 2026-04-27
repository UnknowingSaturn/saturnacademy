import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Backfill/recalculate trade metrics for an account
 * This fixes:
 * - balance_at_entry (running balance when each trade opened)
 * - r_multiple_actual (R% = net_pnl / equity_at_entry * 100, with fallback to balance_at_entry)
 * - session (based on entry_time in America/New_York timezone)
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { account_id } = await req.json();

    if (!account_id) {
      return new Response(
        JSON.stringify({ error: "account_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Starting backfill for account:", account_id);

    // Get account info (need user_id to load custom session_definitions)
    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("id, user_id, balance_start, equity_current")
      .eq("id", account_id)
      .single();

    if (accountError || !account) {
      return new Response(
        JSON.stringify({ error: "Account not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load user's custom session definitions (falls back to defaults if none)
    const sessions = await loadSessions(supabase, account.user_id);
    console.log(`Using ${sessions.length} session definitions for classification`);

    // Get all closed trades for this account, ordered by entry_time
    const { data: trades, error: tradesError } = await supabase
      .from("trades")
      .select("id, entry_time, net_pnl, is_open, equity_at_entry")
      .eq("account_id", account_id)
      .eq("is_open", false)
      .order("entry_time", { ascending: true });

    if (tradesError) {
      return new Response(
        JSON.stringify({ error: tradesError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${trades?.length || 0} closed trades to process`);

    // Calculate total PnL from all closed trades
    const totalPnl = trades?.reduce((sum, t) => sum + (t.net_pnl || 0), 0) || 0;

    // Derive the true starting balance:
    // current_equity = starting_balance + total_pnl
    // starting_balance = current_equity - total_pnl
    const derivedStartBalance = (account.equity_current || 0) - totalPnl;
    
    console.log("Balance calculation:", {
      currentEquity: account.equity_current,
      totalPnl,
      derivedStartBalance,
      originalBalanceStart: account.balance_start,
    });

    // Process each trade chronologically
    let runningBalance = derivedStartBalance;
    const updates: { 
      id: string; 
      balance_at_entry: number; 
      r_multiple_actual: number | null; 
      session: string;
      equity_at_entry_used: number; // For logging
    }[] = [];

    for (const trade of trades || []) {
      const balanceAtEntry = runningBalance;
      
      // Use equity_at_entry if available (from real-time capture), otherwise use derived balance
      // For historical trades without equity_at_entry, derived balance is the best approximation
      const equityForRCalc = trade.equity_at_entry || balanceAtEntry;
      
      // Calculate R% = (net_pnl / equity_at_entry) * 100
      let rMultiple: number | null = null;
      if (equityForRCalc > 0 && trade.net_pnl !== null) {
        rMultiple = Math.round((trade.net_pnl / equityForRCalc) * 10000) / 100;
      }

      // Calculate session from entry_time in America/New_York
      const session = getSessionFromTime(trade.entry_time, sessions);

      updates.push({
        id: trade.id,
        balance_at_entry: balanceAtEntry,
        r_multiple_actual: rMultiple,
        session,
        equity_at_entry_used: equityForRCalc,
      });

      // Update running balance
      runningBalance += trade.net_pnl || 0;
    }

    // Also process open trades (just for balance_at_entry and session, not R%)
    const { data: openTrades } = await supabase
      .from("trades")
      .select("id, entry_time, equity_at_entry")
      .eq("account_id", account_id)
      .eq("is_open", true)
      .order("entry_time", { ascending: true });

    for (const trade of openTrades || []) {
      const session = getSessionFromTime(trade.entry_time, sessions);
      updates.push({
        id: trade.id,
        balance_at_entry: runningBalance,
        r_multiple_actual: null, // Open trades don't have R% yet
        session,
        equity_at_entry_used: trade.equity_at_entry || runningBalance,
      });
    }

    // Apply updates
    let successCount = 0;
    let errorCount = 0;

    for (const update of updates) {
      const { error } = await supabase
        .from("trades")
        .update({
          balance_at_entry: update.balance_at_entry,
          r_multiple_actual: update.r_multiple_actual,
          session: update.session,
        })
        .eq("id", update.id);

      if (error) {
        console.error("Update failed for trade", update.id, error);
        errorCount++;
      } else {
        successCount++;
      }
    }

    // Update account balance_start with derived value
    await supabase
      .from("accounts")
      .update({ balance_start: derivedStartBalance })
      .eq("id", account_id);

    console.log("Backfill complete:", { successCount, errorCount });

    return new Response(
      JSON.stringify({
        success: true,
        derivedStartBalance,
        tradesUpdated: successCount,
        errors: errorCount,
        totalPnl,
        note: "R% uses equity_at_entry when available, falls back to derived balance for historical trades",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Backfill error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

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

    // Format the timestamp in this session's timezone
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
      // Overnight wrap (e.g. Tokyo 19:00 → 03:00)
      if (minutes >= startMin || minutes < endMin) return session.key;
    } else {
      if (minutes >= startMin && minutes < endMin) return session.key;
    }
  }

  return "off_hours";
}