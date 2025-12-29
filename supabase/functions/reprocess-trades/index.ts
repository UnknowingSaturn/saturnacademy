import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ReprocessRequest {
  account_id: string;
  broker_utc_offset?: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { account_id, broker_utc_offset }: ReprocessRequest = await req.json();

    if (!account_id) {
      return new Response(
        JSON.stringify({ error: "account_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Reprocessing trades for account ${account_id} with UTC offset ${broker_utc_offset}`);

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

    // Use provided offset or fall back to account's stored offset, default to 2
    const effectiveOffset = broker_utc_offset ?? account.broker_utc_offset ?? 2;
    
    // The current stored times assume offset was calculated at runtime using TimeGMT() - TimeCurrent()
    // But this was computed at SEND TIME, not DEAL TIME, which is incorrect for historical trades
    // 
    // The broker server time is UTC+2 (or whatever effectiveOffset is)
    // So if the EA sent deal_time + (TimeGMT() - TimeCurrent()) at sync time,
    // and sync was done when market was closed (different offset), the times are wrong.
    //
    // The correct approach:
    // stored_utc = deal_time + (TimeGMT() - TimeCurrent()) -- this was computed at sync time
    // If broker is UTC+2, then: correct_utc = deal_time - (2 * 3600) = deal_time - 7200
    // But we stored: stored_utc = deal_time + runtime_offset
    // So correction needed: correct_utc = stored_utc - runtime_offset - (broker_offset * 3600)
    //
    // Since we don't know the runtime offset at sync time, we'll use a different approach:
    // We assume the CURRENT stored times are broker_offset hours AHEAD of actual UTC
    // So we subtract (broker_offset * 3600) seconds from all times
    
    // Actually, let's think about this more carefully:
    // - The EA stores times using: dealTime + (TimeGMT() - TimeCurrent())
    // - If broker is UTC+2, then TimeCurrent() is 2 hours ahead of TimeGMT()
    // - So (TimeGMT() - TimeCurrent()) = -2 hours
    // - Therefore stored_utc = dealTime - 2 hours
    // - But dealTime is already in broker time (UTC+2)
    // - So correct_utc = dealTime - 2 hours = broker_time - 2 hours = UTC time ✓
    //
    // BUT the problem is that for historical trades synced later, the offset was computed
    // at the TIME OF SYNC, not at the DEAL TIME. During off-market hours or DST transitions,
    // this could be wrong.
    //
    // The user reported that 10:40 AM EST shows as 12:40 PM EST - a 2-hour difference.
    // This suggests the times are being displayed 2 hours later than they should be.
    // 
    // The fix: adjust all times by subtracting the difference between what was used
    // and what should have been used. Since most brokers are UTC+2, and the error is 2 hours,
    // we need to subtract 2 hours from all stored times.
    //
    // For flexibility, we'll allow the user to specify the offset and adjust accordingly.

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
        JSON.stringify({ message: "No trades to reprocess", trades_updated: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${trades.length} trades to reprocess`);

    // Calculate the correction needed
    // The times are currently stored assuming some offset was applied
    // We need to correct them to use the broker's actual offset
    // 
    // Based on user feedback: if times show 2 hours later than expected,
    // we need to SUBTRACT the broker offset in hours
    const offsetCorrection = effectiveOffset * 60 * 60 * 1000; // Convert hours to milliseconds

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
        // Correct entry_time
        const originalEntryTime = new Date(trade.entry_time);
        const correctedEntryTime = new Date(originalEntryTime.getTime() - offsetCorrection);
        
        // Correct exit_time if exists
        let correctedExitTime = null;
        if (trade.exit_time) {
          const originalExitTime = new Date(trade.exit_time);
          correctedExitTime = new Date(originalExitTime.getTime() - offsetCorrection);
        }

        // Calculate session from corrected entry time
        const session = getSessionFromTime(correctedEntryTime);

        // Calculate R% using equity_at_entry if available, otherwise use running balance
        const equityAtEntry = trade.equity_at_entry || runningBalance;
        let rMultiple = null;
        if (equityAtEntry > 0 && trade.net_pnl !== null) {
          rMultiple = Math.round((trade.net_pnl / equityAtEntry) * 10000) / 100;
        }

        // Update the trade
        const { error: updateError } = await supabase
          .from("trades")
          .update({
            entry_time: correctedEntryTime.toISOString(),
            exit_time: correctedExitTime?.toISOString() || null,
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
        const originalEntryTime = new Date(trade.entry_time);
        const correctedEntryTime = new Date(originalEntryTime.getTime() - offsetCorrection);
        const session = getSessionFromTime(correctedEntryTime);

        const { error: updateError } = await supabase
          .from("trades")
          .update({
            entry_time: correctedEntryTime.toISOString(),
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

    // Update account's broker_utc_offset
    await supabase
      .from("accounts")
      .update({ broker_utc_offset: effectiveOffset })
      .eq("id", account_id);

    console.log(`Reprocessing complete. Updated ${updatedCount} trades.`);

    return new Response(
      JSON.stringify({
        message: "Trades reprocessed successfully",
        trades_updated: updatedCount,
        broker_utc_offset: effectiveOffset,
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

// Helper function to determine session from timestamp
function getSessionFromTime(date: Date): string {
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
  
  // Tokyo: 19:00 - 04:00 ET (overnight)
  if (etTime >= 19 || etTime < 4) return "tokyo";
  // London: 03:00 - 08:00 ET
  if (etTime >= 3 && etTime < 8) return "london";
  // New York AM: 08:00 - 12:00 ET (main killzone 9:30-11:30)
  if (etTime >= 8 && etTime < 12) return "new_york_am";
  // New York PM: 12:00 - 17:00 ET
  if (etTime >= 12 && etTime < 17) return "new_york_pm";
  
  return "off_hours";
}