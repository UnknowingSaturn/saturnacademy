import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

/**
 * Read-only drift detection.
 *
 * For each (terminal_id, active_account) currently active for the caller,
 * compare the most recent terminal_snapshots row against trades that are
 * still is_open=true on that same account+terminal. Tickets present in
 * the DB but missing from the snapshot are "drift" — the broker probably
 * closed them but the EA missed the deal event.
 *
 * Dormant trades (on accounts not currently active on their terminal) are
 * NEVER flagged — they're expected to be invisible until that login is
 * reactivated.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, supabaseKey);

    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Currently-active accounts per terminal for this user
    const { data: activeRows, error: taErr } = await admin
      .from("terminal_accounts")
      .select("terminal_id, account_id, last_active_at")
      .eq("user_id", user.id)
      .eq("is_currently_active", true);

    if (taErr) {
      return new Response(JSON.stringify({ error: taErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const driftTrades: any[] = [];

    for (const ta of activeRows || []) {
      // Most recent snapshot for this terminal + active account
      const { data: snap } = await admin
        .from("terminal_snapshots")
        .select("open_tickets, received_at, active_login")
        .eq("terminal_id", ta.terminal_id)
        .eq("account_id", ta.account_id)
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!snap) continue;

      // Don't trust snapshots older than 10 minutes
      const snapAge = Date.now() - new Date(snap.received_at).getTime();
      if (snapAge > 10 * 60 * 1000) continue;

      const openTickets: number[] = (snap.open_tickets || []).map((t: any) => Number(t));
      const openSet = new Set(openTickets);

      // Open trades on this account+terminal whose ticket is NOT in the snapshot
      const { data: openTrades } = await admin
        .from("trades")
        .select("id, ticket, symbol, direction, entry_time, entry_price, total_lots, terminal_id, account_id")
        .eq("account_id", ta.account_id)
        .eq("terminal_id", ta.terminal_id)
        .eq("is_open", true);

      for (const t of openTrades || []) {
        if (!t.ticket) continue;
        // Grace window: ignore trades opened in the last 60s (snapshot/event race)
        const tradeAge = Date.now() - new Date(t.entry_time).getTime();
        if (tradeAge < 60 * 1000) continue;

        if (!openSet.has(Number(t.ticket))) {
          driftTrades.push({
            ...t,
            snapshot_received_at: snap.received_at,
            active_login: snap.active_login,
          });
        }
      }
    }

    return new Response(
      JSON.stringify({ drift_trades: driftTrades }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("trades-drift error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
