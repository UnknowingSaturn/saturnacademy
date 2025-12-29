import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface RestoreRequest {
  account_id: string;
}

/**
 * Restore original trade times from events table
 * This undoes any incorrect time adjustments from previous reprocessing
 * 
 * The events table stores the original timestamps from MT5.
 * MT5 timestamps are in broker server time (e.g., UTC+2).
 * These should be stored directly since that's the canonical source.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { account_id }: RestoreRequest = await req.json();

    if (!account_id) {
      return new Response(
        JSON.stringify({ error: "account_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Restoring trade times for account ${account_id}`);

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

    // Get all events for this account
    const { data: events, error: eventsError } = await supabase
      .from("events")
      .select("*")
      .eq("account_id", account_id)
      .order("event_timestamp", { ascending: true });

    if (eventsError) {
      console.error("Error fetching events:", eventsError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch events" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!events || events.length === 0) {
      return new Response(
        JSON.stringify({ message: "No events found to restore from", trades_updated: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${events.length} events`);

    // Group events by ticket (position_id)
    const eventsByTicket: Map<number, any[]> = new Map();
    for (const event of events) {
      const ticket = event.ticket;
      if (!eventsByTicket.has(ticket)) {
        eventsByTicket.set(ticket, []);
      }
      eventsByTicket.get(ticket)!.push(event);
    }

    console.log(`Grouped into ${eventsByTicket.size} positions`);

    let updatedCount = 0;
    let notFoundCount = 0;

    // For each position, find entry and exit events and restore times
    for (const [ticket, positionEvents] of eventsByTicket) {
      // Find the open event (entry)
      const openEvent = positionEvents.find(e => e.event_type === 'open');
      // Find the close event (full exit)
      const closeEvent = positionEvents.find(e => e.event_type === 'close');

      if (!openEvent) {
        console.log(`No open event for ticket ${ticket}`);
        continue;
      }

      // Find the corresponding trade
      const { data: trade, error: tradeError } = await supabase
        .from("trades")
        .select("id, entry_time, exit_time")
        .eq("ticket", ticket)
        .eq("account_id", account_id)
        .single();

      if (tradeError || !trade) {
        console.log(`Trade not found for ticket ${ticket}`);
        notFoundCount++;
        continue;
      }

      // Prepare update with original times from events
      const updateData: any = {
        entry_time: openEvent.event_timestamp,
      };

      if (closeEvent) {
        updateData.exit_time = closeEvent.event_timestamp;
      }

      // Update the trade
      const { error: updateError } = await supabase
        .from("trades")
        .update(updateData)
        .eq("id", trade.id);

      if (updateError) {
        console.error(`Error updating trade ${trade.id}:`, updateError);
      } else {
        updatedCount++;
        console.log(`Restored times for ticket ${ticket}: entry=${openEvent.event_timestamp}, exit=${closeEvent?.event_timestamp || 'open'}`);
      }
    }

    console.log(`Restore complete. Updated ${updatedCount} trades, ${notFoundCount} not found`);

    return new Response(
      JSON.stringify({
        message: "Trade times restored from events",
        trades_updated: updatedCount,
        trades_not_found: notFoundCount,
        total_positions: eventsByTicket.size,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in restore-trade-times:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
