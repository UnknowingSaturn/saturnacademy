import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface RestoreRequest {
  account_id: string;
  broker_utc_offset?: number; // Broker server UTC offset (e.g., 2 for UTC+2)
}

/**
 * Restore original trade times from events table and convert to UTC
 * 
 * The events table stores timestamps from MT5 in broker server time.
 * This function converts them to UTC using the provided broker_utc_offset.
 * 
 * Example: If broker is UTC+2 and event_timestamp is "2024-01-01 10:00:00",
 * the actual UTC time is "2024-01-01 08:00:00" (subtract 2 hours).
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { account_id, broker_utc_offset }: RestoreRequest = await req.json();

    if (!account_id) {
      return new Response(
        JSON.stringify({ error: "account_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use provided offset or fall back to account setting or default to 2 (common for EU brokers)
    let utcOffset = broker_utc_offset;
    
    console.log(`Restoring trade times for account ${account_id} with UTC offset ${utcOffset}`);

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

    // Use account's broker_utc_offset if not provided in request
    if (utcOffset === undefined) {
      utcOffset = account.broker_utc_offset ?? 2;
    }
    
    console.log(`Using broker UTC offset: ${utcOffset}`);

    // Get all events for this account (bounded)
    const { data: events, error: eventsError } = await supabase
      .from("events")
      .select("*")
      .eq("account_id", account_id)
      .order("event_timestamp", { ascending: true })
      .limit(50000);

    if (eventsError) {
      console.error("Error fetching events:", eventsError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch events", details: eventsError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!events || events.length === 0) {
      return new Response(
        JSON.stringify({
          message: "No EA events stored for this account — timezone correction only applies to trades imported via the live EA bridge, not CSV imports.",
          trades_updated: 0,
          trades_not_found: 0,
          total_positions: 0,
          failures: [],
        }),
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
    const failures: Array<{ ticket: number; reason: string }> = [];

    // For each position, find entry and exit events and restore times
    for (const [ticket, positionEvents] of eventsByTicket) {
      try {
        // Find the open event (entry)
        const openEvent = positionEvents.find(e => e.event_type === 'open');
        // Find the close event (full exit)
        const closeEvent = positionEvents.find(e => e.event_type === 'close');

        if (!openEvent) {
          console.log(`No open event for ticket ${ticket}`);
          failures.push({ ticket, reason: 'No open event found' });
          continue;
        }

        // Guard against null/invalid timestamps
        if (!openEvent.event_timestamp || isNaN(new Date(openEvent.event_timestamp).getTime())) {
          console.log(`Invalid open event_timestamp for ticket ${ticket}: ${openEvent.event_timestamp}`);
          failures.push({ ticket, reason: 'Invalid open event timestamp' });
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

        // Convert broker time to UTC by subtracting the offset
        const convertToUTC = (brokerTimestamp: string): string => {
          const brokerDate = new Date(brokerTimestamp);
          const utcDate = new Date(brokerDate.getTime() - (utcOffset! * 60 * 60 * 1000));
          return utcDate.toISOString();
        };

        // Prepare update with times converted to UTC
        const entryTimeUTC = convertToUTC(openEvent.event_timestamp);
        const updateData: any = {
          entry_time: entryTimeUTC,
        };

        let exitTimeUTC: string | undefined;
        if (closeEvent && closeEvent.event_timestamp && !isNaN(new Date(closeEvent.event_timestamp).getTime())) {
          exitTimeUTC = convertToUTC(closeEvent.event_timestamp);
          updateData.exit_time = exitTimeUTC;
        }

        // Update the trade
        const { error: updateError } = await supabase
          .from("trades")
          .update(updateData)
          .eq("id", trade.id);

        if (updateError) {
          console.error(`Error updating trade ${trade.id}:`, updateError);
          failures.push({ ticket, reason: updateError.message });
        } else {
          updatedCount++;
          console.log(`Restored ticket ${ticket}: broker=${openEvent.event_timestamp} -> UTC=${entryTimeUTC}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error(`Unexpected error processing ticket ${ticket}:`, msg);
        failures.push({ ticket, reason: msg });
      }
    }

    console.log(`Restore complete. Updated ${updatedCount} trades, ${notFoundCount} not found, ${failures.length} failures`);

    return new Response(
      JSON.stringify({
        message: `Restored ${updatedCount} trades from ${eventsByTicket.size} positions`,
        trades_updated: updatedCount,
        trades_not_found: notFoundCount,
        total_positions: eventsByTicket.size,
        failures,
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
