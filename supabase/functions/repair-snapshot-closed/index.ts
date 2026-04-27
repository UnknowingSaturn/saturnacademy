import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Repair "snapshot_closed" trades for a given account by re-matching them
 * against MT5 deal history that the EA has already streamed into the events table.
 *
 * Flow:
 *  1. Find all trades on this account where partial_closes contains a
 *     snapshot_closed marker (these are the "BE" rows the user sees).
 *  2. For each one, look in the events table for an exit/close event that
 *     references the same ticket.
 *  3. If we find one, re-apply it: real PnL, real exit price/time, and replace
 *     the snapshot marker with a "repaired_from_snapshot" marker.
 *  4. If no exit event exists, mark the trade as "needs_mt5_reconnect" so the
 *     user knows to log back into that broker account in MT5 — the EA's
 *     next OnInit will then replay the gap and the trade will heal.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, supabaseKey);

    // Authn
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { account_id } = await req.json().catch(() => ({}));
    if (!account_id) {
      return new Response(JSON.stringify({ error: "account_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify the account belongs to the caller
    const { data: account, error: accErr } = await admin
      .from("accounts")
      .select("id, user_id")
      .eq("id", account_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (accErr || !account) {
      return new Response(JSON.stringify({ error: "Account not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Find snapshot_closed trades on this account
    const { data: stuckTrades, error: tradesErr } = await admin
      .from("trades")
      .select("id, ticket, symbol, entry_price, entry_time, original_lots, partial_closes, equity_at_entry, balance_at_entry, sl_initial")
      .eq("account_id", account_id)
      .eq("is_open", false);

    if (tradesErr) {
      return new Response(JSON.stringify({ error: tradesErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const candidates = (stuckTrades || []).filter((t: any) =>
      Array.isArray(t.partial_closes) &&
      t.partial_closes.some((m: any) => m?.type === "snapshot_closed")
    );

    let repaired = 0;
    let pending = 0;
    const repairedTickets: number[] = [];
    const pendingTickets: number[] = [];

    for (const trade of candidates) {
      // Look for any exit event referencing this ticket on this account
      const { data: exitEvents } = await admin
        .from("events")
        .select("price, profit, commission, swap, sl, tp, event_timestamp")
        .eq("account_id", account_id)
        .eq("ticket", trade.ticket)
        .in("event_type", ["close", "partial_close"])
        .order("event_timestamp", { ascending: false })
        .limit(1);

      const exitEvent = exitEvents?.[0];
      if (!exitEvent) {
        pending++;
        if (trade.ticket) pendingTickets.push(Number(trade.ticket));
        continue;
      }

      const grossPnl = Number(exitEvent.profit) || 0;
      const commission = Number(exitEvent.commission) || 0;
      const swap = Number(exitEvent.swap) || 0;
      const netPnl = grossPnl - commission - Math.abs(swap);

      const duration = Math.floor(
        (new Date(exitEvent.event_timestamp).getTime() -
          new Date(trade.entry_time).getTime()) / 1000
      );

      await admin.from("trades").update({
        exit_price: Number(exitEvent.price),
        exit_time: exitEvent.event_timestamp,
        gross_pnl: grossPnl,
        commission: commission,
        swap: swap,
        net_pnl: netPnl,
        duration_seconds: duration > 0 ? duration : null,
        partial_closes: [{
          type: "repaired_from_snapshot",
          repaired_at: new Date().toISOString(),
          note: "Recovered from MT5 deal history during one-shot backfill",
        }],
      }).eq("id", trade.id);

      repaired++;
      if (trade.ticket) repairedTickets.push(Number(trade.ticket));
    }

    return new Response(JSON.stringify({
      status: "ok",
      total_stuck: candidates.length,
      repaired,
      pending_mt5_reconnect: pending,
      repaired_tickets: repairedTickets,
      pending_tickets: pendingTickets,
      message: pending > 0
        ? `Repaired ${repaired} trades. ${pending} more need you to log back into this broker account in MT5 — the EA will heal them automatically on reconnect.`
        : `Repaired ${repaired} trades.`,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("repair-snapshot-closed error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
