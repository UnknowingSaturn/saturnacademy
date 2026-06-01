// Consolidated trade repair endpoint.
//
// Replaces two earlier functions:
//   - trades-drift           → action: "list-drift"   (read-only drift + dormant accounts report)
//   - repair-snapshot-closed → action: "repair"       (re-match stuck trades against MT5 deal history)
//
// Both callers are authenticated React clients.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { json, requireUser, requireOwnedAccount, AuthError } from "../_shared/edgeAuth.ts";
import { isPendingRepair, hasSnapshotClosed, isAlreadyRepaired } from "../_shared/snapshotRepair.ts";
import { computeNetPnl } from "../_shared/pnl.ts";
import { computeRMultiple } from "../_shared/rMultiple.ts";
import { insertRepairEvent } from "../_shared/repairEvent.ts";

type Action = "list-drift" | "repair";

interface RepairRequest {
  action: Action;
  account_id?: string;
  all?: boolean;
}

async function runListDrift(admin: SupabaseClient, userId: string) {
  const { data: activeRows, error: taErr } = await admin
    .from("terminal_accounts")
    .select("terminal_id, install_id, account_id, last_active_at, is_currently_active")
    .eq("user_id", userId);
  if (taErr) return json({ error: taErr.message }, 500);

  // Load all of the user's accounts once so we can resolve account_number /
  // name when classifying drift reasons (login_switched etc.).
  const { data: allAccounts } = await admin
    .from("accounts")
    .select("id, name, account_number")
    .eq("user_id", userId);
  const acctById = new Map<string, { id: string; name: string; account_number: string | null }>();
  for (const a of allAccounts || []) acctById.set(a.id, a as any);

  const driftTrades: any[] = [];
  const dormantAccountIds = new Set<string>();

  const installActive = new Map<string, string>();
  for (const row of activeRows || []) {
    if (row.install_id && row.is_currently_active) {
      installActive.set(row.install_id, row.account_id);
    }
  }

  for (const ta of activeRows || []) {
    if (ta.install_id) {
      const activeOnInstall = installActive.get(ta.install_id);
      if (activeOnInstall && activeOnInstall !== ta.account_id) {
        dormantAccountIds.add(ta.account_id);
        continue;
      }
    }
    if (!ta.is_currently_active) continue;

    const { data: snap } = await admin
      .from("terminal_snapshots")
      .select("open_tickets, received_at, active_login")
      .eq("terminal_id", ta.terminal_id)
      .eq("account_id", ta.account_id)
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!snap) continue;

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

    const acct = acctById.get(ta.account_id);
    const expectedLogin = acct?.account_number ? String(acct.account_number) : null;
    const activeLogin = snap.active_login ? String(snap.active_login) : null;
    const loginMatches = !expectedLogin || !activeLogin || expectedLogin === activeLogin;

    for (const t of openTrades || []) {
      if (!t.ticket) continue;
      const tradeAge = Date.now() - new Date(t.entry_time).getTime();
      // Grace period: don't surface trades < 2 min old. Snapshots can lag
      // briefly behind a freshly opened position.
      if (tradeAge < 2 * 60 * 1000) continue;
      if (!openSet.has(Number(t.ticket))) {
        // Classify why the trade dropped out of the snapshot. Used by the UI
        // to choose calm vs. urgent messaging and whether to show Repair.
        const reason: "login_switched" | "likely_broker_closed" = loginMatches
          ? "likely_broker_closed"
          : "login_switched";
        driftTrades.push({
          ...t,
          snapshot_received_at: snap.received_at,
          active_login: activeLogin,
          expected_login: expectedLogin,
          account_name: acct?.name ?? null,
          reason,
        });
      }
    }
  }

  let dormantAccounts: any[] = [];
  if (dormantAccountIds.size > 0) {
    const ids = Array.from(dormantAccountIds);
    const { data: accs } = await admin
      .from("accounts")
      .select("id, name, account_number, broker, last_sync_at")
      .in("id", ids);

    const { data: stuckTrades } = await admin
      .from("trades")
      .select("id, account_id, trade_repair_events(action)")
      .in("account_id", ids)
      .eq("is_open", false);

    const stuckByAccount = new Map<string, number>();
    for (const t of stuckTrades || []) {
      const events = ((t as any).trade_repair_events || []) as Array<{ action: string }>;
      // Use the canonical helpers so new REPAIRED_ACTIONS / dismiss actions
      // don't silently leak through as "still stuck".
      if (hasSnapshotClosed(events) && !isAlreadyRepaired(events)) {
        const accId = (t as any).account_id;
        stuckByAccount.set(accId, (stuckByAccount.get(accId) || 0) + 1);
      }
    }

    dormantAccounts = (accs || []).map((a: any) => ({
      ...a,
      pending_repairs: stuckByAccount.get(a.id) || 0,
    }));
  }

  return json({ drift_trades: driftTrades, dormant_accounts: dormantAccounts });
}

async function runRepair(
  admin: SupabaseClient,
  userId: string,
  body: RepairRequest,
) {
  let targetAccountIds: string[] = [];
  if (body.all) {
    const { data: accs } = await admin
      .from("accounts")
      .select("id")
      .eq("user_id", userId);
    targetAccountIds = (accs || []).map((a: any) => a.id);
  } else if (body.account_id) {
    try {
      await requireOwnedAccount(admin, userId, body.account_id, "id, user_id");
    } catch (e: any) {
      return json({ error: e.message ?? "Account not found" }, e.status ?? 404);
    }
    targetAccountIds = [body.account_id];
  } else {
    return json({ error: "account_id or all required" }, 400);
  }

  const { data: userAccounts } = await admin
    .from("accounts")
    .select("id, mt5_install_id, account_number")
    .eq("user_id", userId);

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

  const { data: stuckTrades, error: tradesErr } = await admin
    .from("trades")
    .select("id, ticket, symbol, direction, entry_price, entry_time, original_lots, equity_at_entry, balance_at_entry, sl_initial, account_id, trade_repair_events(action)")
    .in("account_id", targetAccountIds)
    .eq("is_open", false);
  if (tradesErr) return json({ error: tradesErr.message }, 500);

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
    const netPnl = computeNetPnl(grossPnl, commission, swap);

    const duration = Math.floor(
      (new Date(exitEvent.event_timestamp).getTime() -
        new Date(trade.entry_time).getTime()) / 1000,
    );

    // Use the shared, broker-agnostic R-multiple calculator so repaired
    // trades match ingest-events / trade-rebuild values (indices, metals,
    // crypto, and partial-fill paths handled uniformly).
    const entryPrice = Number(trade.entry_price);
    const exitPrice = Number(exitEvent.price);
    const rMultiple = computeRMultiple({
      entryPrice: Number.isFinite(entryPrice) ? entryPrice : null,
      exitPrice: Number.isFinite(exitPrice) ? exitPrice : null,
      slPrice: trade.sl_initial != null ? Number(trade.sl_initial) : null,
      lots: trade.original_lots != null ? Number(trade.original_lots) : null,
      grossPnl,
      netPnl,
      symbol: String(trade.symbol || ""),
      equityAtEntry: trade.equity_at_entry != null ? Number(trade.equity_at_entry) : null,
      direction: String(trade.direction || "").toLowerCase(),
      fills: null,
    });

    const update: Record<string, unknown> = {
      exit_price: exitPrice,
      exit_time: exitEvent.event_timestamp,
      gross_pnl: grossPnl,
      commission,
      swap,
      net_pnl: netPnl,
      r_multiple_actual: rMultiple,
      duration_seconds: duration > 0 ? duration : null,
      awaiting_exit: false,
    };

    const wasReassigned = exitEvent.account_id && exitEvent.account_id !== trade.account_id;
    if (wasReassigned) {
      update.account_id = exitEvent.account_id;
      reassigned++;
    }

    await admin.from("trades").update(update).eq("id", trade.id);

    await insertRepairEvent(admin, {
      userId,
      tradeId: trade.id,
      action: "repaired_from_snapshot",
      source: "manual_repair_snapshot_closed",
      metadata: {
        net_pnl: netPnl,
        ticket: trade.ticket ?? null,
        reassigned: !!wasReassigned,
      },
    });

    repaired++;
    if (trade.ticket) repairedTickets.push(Number(trade.ticket));
  }

  return json({
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
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { userId, admin } = await requireUser(req);
    const body: RepairRequest = await req.json().catch(() => ({ action: "list-drift" } as RepairRequest));
    const action: Action = body.action ?? "list-drift";

    switch (action) {
      case "list-drift": return await runListDrift(admin, userId);
      case "repair":     return await runRepair(admin, userId, body);
      default:           return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    if (err instanceof AuthError) return json({ error: err.message }, err.status);
    console.error("trade-repair error:", err);
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
