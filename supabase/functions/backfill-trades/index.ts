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
 * - r_multiple_actual (R% = net_pnl / balance_at_entry * 100)
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

    // Get account info
    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("id, balance_start, equity_current")
      .eq("id", account_id)
      .single();

    if (accountError || !account) {
      return new Response(
        JSON.stringify({ error: "Account not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get all closed trades for this account, ordered by entry_time
    const { data: trades, error: tradesError } = await supabase
      .from("trades")
      .select("id, entry_time, net_pnl, is_open")
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
    const updates: { id: string; balance_at_entry: number; r_multiple_actual: number | null; session: string }[] = [];

    for (const trade of trades || []) {
      const balanceAtEntry = runningBalance;
      
      // Calculate R% = (net_pnl / balance_at_entry) * 100
      let rMultiple: number | null = null;
      if (balanceAtEntry > 0 && trade.net_pnl !== null) {
        rMultiple = Math.round((trade.net_pnl / balanceAtEntry) * 10000) / 100;
      }

      // Calculate session from entry_time in America/New_York
      const session = getSessionFromTime(trade.entry_time);

      updates.push({
        id: trade.id,
        balance_at_entry: balanceAtEntry,
        r_multiple_actual: rMultiple,
        session,
      });

      // Update running balance
      runningBalance += trade.net_pnl || 0;
    }

    // Also process open trades (just for balance_at_entry and session, not R%)
    const { data: openTrades } = await supabase
      .from("trades")
      .select("id, entry_time")
      .eq("account_id", account_id)
      .eq("is_open", true)
      .order("entry_time", { ascending: true });

    for (const trade of openTrades || []) {
      const session = getSessionFromTime(trade.entry_time);
      updates.push({
        id: trade.id,
        balance_at_entry: runningBalance,
        r_multiple_actual: null,
        session,
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

/**
 * Determine trading session from timestamp using America/New_York timezone
 */
function getSessionFromTime(timestamp: string): string {
  const date = new Date(timestamp);
  
  // Use Intl.DateTimeFormat to get hour in America/New_York (handles DST)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  
  const parts = formatter.formatToParts(date);
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  const time = hour + minute / 60;
  
  // Session windows in ET
  if (time >= 19 || time < 4) return "tokyo";
  if (time >= 3 && time < 8) return "london";
  if (time >= 8 && time < 12) return "new_york_am";
  if (time >= 12 && time < 17) return "new_york_pm";
  return "off_hours";
}
