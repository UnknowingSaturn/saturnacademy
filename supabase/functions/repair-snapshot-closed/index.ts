import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { isPendingRepair } from "../_shared/snapshotRepair.ts";

/**
 * Repair "snapshot_closed" trades for a given account by re-matching them
 * against MT5 deal history streamed into the events table — INCLUDING events
 * that were attributed to sibling accounts on the same MT5 install (i.e.
 * other logins on the same install). This is necessary because when a user
 * switches MT5 logins, the close event for an older trade may arrive tagged
 * with the new login's account_id, so we have to search across all siblings
 * sharing the same `mt5_install_id`.
 *
 * If a matching exit event is found on a sibling account we both:
 *   1) apply the real PnL/exit data, and
 *   2) move the trade's account_id to the sibling so it ends up filed under
 *      the broker login that actually owned the deal.
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

    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const accountId: string | undefined = body.account_id;
    const allUserAccounts: boolean = !!body.all;

    // Resolve target accounts to scan for stuck trades
    let targetAccountIds: string[] = [];
    if (allUserAccounts) {
      const { data: accs } = await admin
        .from("accounts")
        .select("id")
        .eq("user_id", user.id);
      targetAccountIds = (accs || []).map((a: any) => a.id);
    } else if (accountId) {
      const { data: account } = await admin
        .from("accounts")
        .select("id, user_id")
        .eq("id", accountId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!account) {
        return new Response(JSON.stringify({ error: "Account not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      targetAccountIds = [accountId];
    } else {
      return new Response(JSON.stringify({ error: "account_id or all required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pre-fetch ALL of the user's accounts so we can build install_id -> [sibling ids]
    const { data: userAccounts } = await admin
      .from("accounts")
      .select("id, mt5_install_id, account_number")
      .eq("user_id", user.id);

    const siblingsByInstall = new Map<string, string[]>();
    const accountById = new Map<string, any>();
    for (const a of userAccounts || []) {
      accountById.set(a.id, a);
      if (a.mt5_install_id) {
        const arr = siblingsByInstall.get(a.mt5_install_id) || [];
        arr.push(a.id);
        siblingsByInstall.set(a.mt5_install_id, arr);
      }
    }

    // Pull stuck trades across all target accounts, joined to their repair events.
    const { data: stuckTrades, error: tradesErr } = await admin
      .from("trades")
      .select("id, ticket, symbol, direction, entry_price, entry_time, original_lots, equity_at_entry, balance_at_entry, sl_initial, account_id, trade_repair_events(action)")
      .in("account_id", targetAccountIds)
      .eq("is_open", false);

    if (tradesErr) {
      return new Response(JSON.stringify({ error: tradesErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const candidates = (stuckTrades || []).filter((t: any) =>
      isPendingRepair(t.trade_repair_events as any),
    );


    let repaired = 0;
    let pending = 0;
    let reassigned = 0;
    const repairedTickets: number[] = [];
    const pendingTickets: number[] = [];

    for (const trade of candidates) {
      const acct = accountById.get(trade.account_id);
      const installId = acct?.mt5_install_id;
      const searchAccountIds = installId
        ? (siblingsByInstall.get(installId) || [trade.account_id])
        : [trade.account_id];

      const { data: exitEvents } = await admin
        .from("events")
        .select("account_id, price, profit, commission, swap, sl, tp, event_timestamp")
        .in("account_id", searchAccountIds)
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

      const update: Record<string, unknown> = {
        exit_price: Number(exitEvent.price),
        exit_time: exitEvent.event_timestamp,
        gross_pnl: grossPnl,
        commission,
        swap,
        net_pnl: netPnl,
        duration_seconds: duration > 0 ? duration : null,
        awaiting_exit: false,
      };

      const wasReassigned = exitEvent.account_id && exitEvent.account_id !== trade.account_id;
      if (wasReassigned) {
        update.account_id = exitEvent.account_id;
        reassigned++;
      }

      await admin.from("trades").update(update).eq("id", trade.id);

      // Typed repair event
      await admin.from("trade_repair_events").insert({
        user_id: user.id,
        trade_id: trade.id,
        action: "repaired_from_snapshot",
        source: "manual_repair_snapshot_closed",
        metadata: {
          net_pnl: netPnl,
          ticket: trade.ticket ?? null,
          reassigned: exitEvent.account_id !== trade.account_id,
        },
        applied_at: new Date().toISOString(),
      });

      repaired++;
      if (trade.ticket) repairedTickets.push(Number(trade.ticket));
    }

    return new Response(JSON.stringify({
      status: "ok",
      total_stuck: candidates.length,
      repaired,
      reassigned,
      pending_mt5_reconnect: pending,
      repaired_tickets: repairedTickets,
      pending_tickets: pendingTickets,
      message: pending > 0
        ? `Repaired ${repaired} trade${repaired === 1 ? "" : "s"}. ${pending} still need you to log MT5 back into the original broker login — they'll heal automatically on reconnect.`
        : `Repaired ${repaired} trade${repaired === 1 ? "" : "s"}.`,
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
