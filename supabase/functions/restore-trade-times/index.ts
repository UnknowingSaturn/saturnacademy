import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type BrokerDstProfile =
  | 'EET_DST' | 'GMT_DST'
  | 'FIXED_PLUS_3' | 'FIXED_PLUS_2' | 'FIXED_PLUS_0'
  | 'MANUAL';

interface RestoreRequest {
  account_id: string;
  broker_utc_offset?: number;
  broker_dst_profile?: BrokerDstProfile;
}

/**
 * Get the offset (in hours) of an IANA timezone at a given date.
 * Uses Intl.DateTimeFormat — fully DST-aware, no external libs.
 */
function getIanaOffsetHours(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(date).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  return Math.round((asUtc - date.getTime()) / 3_600_000);
}

/**
 * Resolve the broker's UTC offset for a given timestamp using the DST profile.
 * For DST profiles, returns the correct offset for THAT specific date.
 */
function resolveBrokerOffsetHours(
  profile: BrokerDstProfile,
  timestamp: Date,
  manualOffsetHours: number
): number {
  switch (profile) {
    case 'FIXED_PLUS_0': return 0;
    case 'FIXED_PLUS_2': return 2;
    case 'FIXED_PLUS_3': return 3;
    case 'EET_DST':      return getIanaOffsetHours('Europe/Athens', timestamp);
    case 'GMT_DST':      return getIanaOffsetHours('Europe/London', timestamp);
    case 'MANUAL':
    default:             return manualOffsetHours;
  }
}

/**
 * Restore original trade times from events table and convert to UTC.
 *
 * The events table stores timestamps from MT5 in broker server time.
 * This function uses the account's broker_dst_profile (or a request override)
 * to pick the correct offset PER trade date — so DST transitions across
 * historical data are handled correctly.
 *
 * Note: Live EA trades already arrive in UTC (the EA does the math live);
 * this endpoint is mainly for legacy/CSV-imported history.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { account_id, broker_utc_offset, broker_dst_profile }: RestoreRequest = await req.json();

    if (!account_id) {
      return new Response(
        JSON.stringify({ error: "account_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get account data (we need the saved profile/offset as fallbacks)
    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("*")
      .eq("id", account_id)
      .single();

    if (accountError || !account) {
      return new Response(
        JSON.stringify({ error: `Account ${account_id} not found` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const profile: BrokerDstProfile =
      (broker_dst_profile as BrokerDstProfile)
      ?? (account.broker_dst_profile as BrokerDstProfile)
      ?? 'MANUAL';
    const manualOffset = broker_utc_offset ?? account.broker_utc_offset ?? 2;

    console.log(`Restoring trade times for account ${account_id} — profile=${profile}, manualOffset=${manualOffset}`);

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
      if (!eventsByTicket.has(ticket)) eventsByTicket.set(ticket, []);
      eventsByTicket.get(ticket)!.push(event);
    }

    console.log(`Grouped into ${eventsByTicket.size} positions`);

    let updatedCount = 0;
    let notFoundCount = 0;
    const failures: Array<{ ticket: number; reason: string }> = [];

    // Per-event UTC conversion. If the event already carries a per-event offset
    // in raw_payload.broker_utc_offset (live EA), prefer that. Otherwise use the
    // DST profile to resolve the offset for that specific date.
    const convertEventToUtc = (event: any): string | null => {
      if (!event.event_timestamp) return null;
      const naive = new Date(event.event_timestamp);
      if (isNaN(naive.getTime())) return null;

      const perEventOffset = event.raw_payload?.broker_utc_offset;
      const offsetH = typeof perEventOffset === 'number'
        ? perEventOffset
        : resolveBrokerOffsetHours(profile, naive, manualOffset);

      const utc = new Date(naive.getTime() - offsetH * 3_600_000);
      return utc.toISOString();
    };

    for (const [ticket, positionEvents] of eventsByTicket) {
      try {
        const openEvent = positionEvents.find(e => e.event_type === 'open');
        const closeEvent = positionEvents.find(e => e.event_type === 'close');

        if (!openEvent) {
          failures.push({ ticket, reason: 'No open event found' });
          continue;
        }

        const entryTimeUTC = convertEventToUtc(openEvent);
        if (!entryTimeUTC) {
          failures.push({ ticket, reason: 'Invalid open event timestamp' });
          continue;
        }

        const { data: trade, error: tradeError } = await supabase
          .from("trades")
          .select("id, entry_time, exit_time")
          .eq("ticket", ticket)
          .eq("account_id", account_id)
          .single();

        if (tradeError || !trade) {
          notFoundCount++;
          continue;
        }

        const updateData: Record<string, unknown> = { entry_time: entryTimeUTC };
        if (closeEvent) {
          const exitTimeUTC = convertEventToUtc(closeEvent);
          if (exitTimeUTC) updateData.exit_time = exitTimeUTC;
        }

        const { error: updateError } = await supabase
          .from("trades")
          .update(updateData)
          .eq("id", trade.id);

        if (updateError) {
          failures.push({ ticket, reason: updateError.message });
        } else {
          updatedCount++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        failures.push({ ticket, reason: msg });
      }
    }

    console.log(`Restore complete. Updated ${updatedCount}, not found ${notFoundCount}, failures ${failures.length}`);

    return new Response(
      JSON.stringify({
        message: `Restored ${updatedCount} trades from ${eventsByTicket.size} positions using profile ${profile}`,
        trades_updated: updatedCount,
        trades_not_found: notFoundCount,
        total_positions: eventsByTicket.size,
        profile_used: profile,
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
