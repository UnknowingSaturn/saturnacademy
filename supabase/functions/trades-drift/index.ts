import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

/**
 * Read-only drift / dormancy report.
 *
 * Returns two lists for the calling user:
 *   - drift_trades   : trades still flagged is_open in the DB but missing from
 *                      the latest snapshot of an ACTIVE (terminal,account). These
 *                      were probably closed at the broker and the EA missed the
 *                      deal event. The UI offers a repair action.
 *   - dormant_accounts: accounts that share an MT5 install with a different
 *                      currently-active login. Their open trades aren't drifted
 *                      — the server simply hasn't heard from that login since
 *                      the user switched. Surfaced so the UI can show "log back
 *                      in to sync" instead of false-positive drift.
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

    const { data: activeRows, error: taErr } = await admin
      .from("terminal_accounts")
      .select("terminal_id, install_id, account_id, last_active_at, is_currently_active")
      .eq("user_id", user.id);

    if (taErr) {
      return new Response(JSON.stringify({ error: taErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const driftTrades: any[] = [];
    const dormantAccountIds = new Set<string>();

    // Build install_id -> active_account_id for dormancy detection
    const installActive = new Map<string, string>();
    for (const row of activeRows || []) {
      if (row.install_id && row.is_currently_active) {
        installActive.set(row.install_id, row.account_id);
      }
    }

    for (const ta of activeRows || []) {
      // Dormant: account shares an install with a different active login
      if (ta.install_id) {
        const activeOnInstall = installActive.get(ta.install_id);
        if (activeOnInstall && activeOnInstall !== ta.account_id) {
          dormantAccountIds.add(ta.account_id);
          continue; // dormant accounts cannot drift — skip drift check
        }
      }

      if (!ta.is_currently_active) continue;

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

      const { data: openTrades } = await admin
        .from("trades")
        .select("id, ticket, symbol, direction, entry_time, entry_price, total_lots, terminal_id, account_id")
        .eq("account_id", ta.account_id)
        .eq("terminal_id", ta.terminal_id)
        .eq("is_open", true);

      for (const t of openTrades || []) {
        if (!t.ticket) continue;
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

    // Hydrate dormant_accounts with display data
    let dormantAccounts: any[] = [];
    if (dormantAccountIds.size > 0) {
      const { data: accs } = await admin
        .from("accounts")
        .select("id, name, account_number, broker, last_sync_at")
        .in("id", Array.from(dormantAccountIds));
      dormantAccounts = accs || [];
    }

    return new Response(
      JSON.stringify({ drift_trades: driftTrades, dormant_accounts: dormantAccounts }),
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
