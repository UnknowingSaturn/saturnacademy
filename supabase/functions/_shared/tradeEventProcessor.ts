// Trade-event processor: entry / modify / exit / partial_close / orphan / repair.
// Extracted verbatim from ingest-events/index.ts (A-tranche split). Behavior preserved.

import { computeRMultiple } from "./rMultiple.ts";
import { classifySession, loadSessions } from "./session.ts";
import { isPendingRepair } from "./snapshotRepair.ts";
import { computeNetPnl } from "./pnl.ts";
import { insertRepairEvent } from "./repairEvent.ts";
import type { EventPayload } from "./eventTypes.ts";

// Detect if a trade was zeroed out by snapshot reconciliation and is awaiting repair.
async function isSnapshotClosed(supabase: any, tradeId: string, isOpen: boolean): Promise<boolean> {
  if (isOpen) return false;
  const { data } = await supabase
    .from("trade_repair_events")
    .select("action")
    .eq("trade_id", tradeId);
  return isPendingRepair(data as any);
}

/**
 * Sibling repair: close/partial event arrives for a ticket with no trade on the
 * current account. Check whether a sibling account on the same MT5 install has
 * a snapshot_closed trade for this ticket awaiting repair; if so, apply exit
 * data in-place and reassign to the current account.
 */
async function tryRepairSiblingSnapshotClosed(
  supabase: any,
  userId: string,
  currentAccountId: string,
  ticket: number | bigint,
  event: any,
): Promise<boolean> {
  try {
    const { data: currentAcc } = await supabase
      .from("accounts")
      .select("id, mt5_install_id")
      .eq("id", currentAccountId)
      .maybeSingle();
    const installId = currentAcc?.mt5_install_id;
    if (!installId) return false;

    const { data: siblings } = await supabase
      .from("accounts")
      .select("id")
      .eq("user_id", userId)
      .eq("mt5_install_id", installId);

    const siblingIds = (siblings || []).map((s: any) => s.id);
    if (siblingIds.length === 0) return false;

    const { data: stuck } = await supabase
      .from("trades")
      .select(
        "id, ticket, entry_time, entry_price, original_lots, equity_at_entry, balance_at_entry, sl_initial, account_id, symbol, direction",
      )
      .in("account_id", siblingIds)
      .eq("ticket", ticket)
      .eq("is_open", false)
      .limit(5);

    let candidate: any = null;
    for (const t of stuck || []) {
      const { data: evs } = await supabase
        .from("trade_repair_events")
        .select("action")
        .eq("trade_id", t.id);
      if (isPendingRepair(evs as any)) { candidate = t; break; }
    }
    if (!candidate) return false;

    const grossPnl = Number(event.profit) || 0;
    const commission = Number(event.commission) || 0;
    const swap = Number(event.swap) || 0;
    const netPnl = computeNetPnl(grossPnl, commission, swap);
    const duration = Math.floor(
      (new Date(event.event_timestamp).getTime() -
        new Date(candidate.entry_time).getTime()) / 1000,
    );

    const rMultiple = computeRMultiple({
      entryPrice: Number(candidate.entry_price) || null,
      exitPrice: Number(event.price) || null,
      slPrice: Number(candidate.sl_initial) || null,
      lots: Number(candidate.original_lots) || null,
      grossPnl,
      netPnl,
      symbol: candidate.symbol,
      equityAtEntry: Number(candidate.equity_at_entry) || Number(candidate.balance_at_entry) || null,
      direction: candidate.direction,
    });

    await supabase.from("trades").update({
      account_id: currentAccountId,
      terminal_id: event.terminal_id,
      exit_price: Number(event.price),
      exit_time: event.event_timestamp,
      gross_pnl: grossPnl,
      commission,
      swap,
      net_pnl: netPnl,
      r_multiple_actual: rMultiple,
      duration_seconds: duration > 0 ? duration : null,
      total_lots: 0,
      awaiting_exit: false,
    }).eq("id", candidate.id);

    await insertRepairEvent(supabase, {
      userId,
      tradeId: candidate.id,
      action: "repaired_from_snapshot",
      source: "ingest_sibling_repair",
      metadata: {
        net_pnl: netPnl,
        ticket: Number(ticket),
        note: "Auto-repaired on ingest from sibling login on same MT5 install",
      },
    });

    console.log("AUTO-REPAIR: healed sibling snapshot_closed trade", candidate.id, "ticket:", ticket, "PnL:", netPnl);
    return true;
  } catch (err) {
    console.error("tryRepairSiblingSnapshotClosed failed (non-fatal):", err);
    return false;
  }
}

export async function processEvent(
  supabase: any,
  event: any,
  userId: string,
  originalPayload: EventPayload,
): Promise<void> {
  const { event_type, ticket, account_id, lot_size } = event;
  const effectiveEventType = originalPayload.event_type === "history_sync"
    ? originalPayload.original_event_type
    : originalPayload.event_type;

  const { data: existingTrade } = await supabase
    .from("trades")
    .select("*")
    .eq("ticket", ticket)
    .eq("account_id", account_id)
    .single();

  const sessions = await loadSessions(supabase, userId);
  const session = classifySession(event.event_timestamp, sessions);

  const { data: accountData } = await supabase
    .from("accounts")
    .select("balance_start, equity_current")
    .eq("id", account_id)
    .single();

  const currentEquity = accountData?.equity_current || accountData?.balance_start || 0;

  // ===== MODIFY =====
  if (effectiveEventType === "modify" || event_type === "modify") {
    if (existingTrade) {
      const updateData: Record<string, unknown> = {};
      if (event.sl) updateData.sl_final = event.sl;
      if (event.tp) updateData.tp_final = event.tp;

      await supabase.from("trades").update(updateData).eq("id", existingTrade.id);

      const mods: Array<Record<string, unknown>> = [];
      if (event.sl && Number(event.sl) !== Number(existingTrade.sl_final ?? NaN)) {
        mods.push({
          user_id: userId,
          trade_id: existingTrade.id,
          field: "sl",
          old_value: existingTrade.sl_final ?? null,
          new_value: event.sl,
          occurred_at: event.event_timestamp,
        });
      }
      if (event.tp && Number(event.tp) !== Number(existingTrade.tp_final ?? NaN)) {
        mods.push({
          user_id: userId,
          trade_id: existingTrade.id,
          field: "tp",
          old_value: existingTrade.tp_final ?? null,
          new_value: event.tp,
          occurred_at: event.event_timestamp,
        });
      }
      if (mods.length > 0) {
        await supabase.from("trade_modifications").insert(mods);
      }

      console.log(
        "Processed SL/TP modify for position:",
        ticket,
        "SL:",
        event.sl,
        "TP:",
        event.tp,
        "previous_sl:",
        originalPayload.raw_payload?.previous_sl,
        "previous_tp:",
        originalPayload.raw_payload?.previous_tp,
      );
    } else {
      console.log("Modify event for unknown position:", ticket, "- ignoring");
    }
    await supabase.from("events").update({ processed: true }).eq("id", event.id);
    return;
  }

  // ===== ENTRY =====
  if (effectiveEventType === "entry" || event_type === "open") {
    if (existingTrade) {
      if (await isSnapshotClosed(supabase, existingTrade.id, existingTrade.is_open)) {
        console.log("REPAIR: reopening snapshot_closed trade:", existingTrade.id, "ticket:", ticket);
        await supabase.from("trades").update({
          is_open: true,
          awaiting_exit: false,
          exit_time: null,
          exit_price: null,
          gross_pnl: null,
          net_pnl: null,
          r_multiple_actual: null,
          duration_seconds: null,
          total_lots: existingTrade.original_lots || event.lot_size,
          sl_final: event.sl || existingTrade.sl_final,
          tp_final: event.tp || existingTrade.tp_final,
        }).eq("id", existingTrade.id);

        await insertRepairEvent(supabase, {
          userId,
          tradeId: existingTrade.id,
          action: "repaired_reopened",
          source: "ingest_entry_reopen",
          metadata: { ticket, note: "Reopened after EA reconnect — trade is still live in MT5" },
        });
      } else {
        console.log("Trade already exists for position:", ticket);
      }
    } else {
      const equityAtEntry = originalPayload.equity_at_entry || currentEquity;

      await supabase.from("trades").insert({
        user_id: userId,
        account_id: account_id,
        terminal_id: event.terminal_id,
        install_id: originalPayload.install_id ?? event.install_id ?? null,
        broker_login: event.broker_login
          ?? (originalPayload.account_info?.login != null ? String(originalPayload.account_info.login) : null),
        ticket: ticket,
        symbol: event.symbol,
        direction: event.direction,
        total_lots: event.lot_size,
        original_lots: event.lot_size,
        entry_price: event.price,
        entry_time: event.event_timestamp,
        sl_initial: event.sl,
        tp_initial: event.tp,
        sl_final: event.sl,
        tp_final: event.tp,
        session: session,
        is_open: true,
        balance_at_entry: currentEquity,
        equity_at_entry: equityAtEntry,
      });
      console.log("Created new trade for position:", ticket, "equity_at_entry:", equityAtEntry);
    }
  }
  // ===== EXIT (full / partial / orphan / repair) =====
  else if (effectiveEventType === "exit" || event_type === "close" || event_type === "partial_close") {
    if (!existingTrade) {
      const repairedSibling = await tryRepairSiblingSnapshotClosed(
        supabase, userId, account_id, ticket, event,
      );
      if (repairedSibling) {
        await supabase.from("events").update({ processed: true }).eq("id", event.id);
        return;
      }

      // ORPHAN EXIT: create a closed trade from exit event data
      console.log("Orphan exit event - creating closed trade for position:", ticket);

      const rawPayload = event.raw_payload || {};
      const entryPrice = rawPayload.entry_price || originalPayload.entry_price || event.price;
      const entryTime = rawPayload.entry_time || originalPayload.entry_time || event.event_timestamp;

      const entryDate = new Date(entryTime);
      const exitDate = new Date(event.event_timestamp);
      const duration = Math.floor((exitDate.getTime() - entryDate.getTime()) / 1000);

      const grossPnl = event.profit || 0;
      const commission = event.commission || 0;
      const swap = event.swap || 0;
      const netPnl = computeNetPnl(grossPnl, commission, swap);

      const equityAtEntry = rawPayload.equity_at_entry || originalPayload.equity_at_entry || currentEquity;
      const rMultiple = computeRMultiple({
        entryPrice,
        exitPrice: event.price,
        slPrice: event.sl,
        lots: lot_size,
        grossPnl,
        netPnl,
        symbol: event.symbol,
        equityAtEntry,
        direction: event.direction,
      });

      await supabase.from("trades").insert({
        user_id: userId,
        account_id: account_id,
        terminal_id: event.terminal_id,
        install_id: originalPayload.install_id ?? event.install_id ?? null,
        broker_login: event.broker_login
          ?? (originalPayload.account_info?.login != null ? String(originalPayload.account_info.login) : null),
        ticket: ticket,
        symbol: event.symbol,
        direction: event.direction,
        total_lots: 0,
        original_lots: lot_size,
        entry_price: entryPrice,
        entry_time: entryTime,
        exit_price: event.price,
        exit_time: event.event_timestamp,
        // Orphan exit: never saw entry, true SL/TP at entry is unknown.
        sl_initial: event.sl && Number(event.sl) !== 0 ? event.sl : null,
        tp_initial: event.tp && Number(event.tp) !== 0 ? event.tp : null,
        sl_final: event.sl && Number(event.sl) !== 0 ? event.sl : null,
        tp_final: event.tp && Number(event.tp) !== 0 ? event.tp : null,
        gross_pnl: grossPnl,
        commission: commission,
        swap: swap,
        net_pnl: netPnl,
        r_multiple_actual: rMultiple,
        duration_seconds: duration > 0 ? duration : null,
        session: session,
        is_open: false,
        balance_at_entry: currentEquity,
        equity_at_entry: equityAtEntry,
      });

      console.log("Created closed trade from orphan exit:", ticket, "PnL:", netPnl);
      await supabase.from("events").update({ processed: true }).eq("id", event.id);
      return;
    }

    const isRepair = await isSnapshotClosed(supabase, existingTrade.id, existingTrade.is_open);
    if (isRepair) {
      console.log("REPAIR: overwriting snapshot_closed trade with real exit data:", existingTrade.id, "ticket:", ticket);
    }

    const remainingLots = existingTrade.total_lots - lot_size;
    const isPartialClose = !isRepair && remainingLots > 0.001;

    if (isPartialClose) {
      await supabase.from("trades").update({
        total_lots: remainingLots,
        sl_final: event.sl || existingTrade.sl_final,
        tp_final: event.tp || existingTrade.tp_final,
      }).eq("id", existingTrade.id);

      await supabase.from("trade_partial_fills").upsert({
        user_id: userId,
        trade_id: existingTrade.id,
        ticket: ticket,
        deal_id: originalPayload.deal_id ?? null,
        lots: lot_size,
        price: event.price,
        profit: event.profit ?? null,
        commission: event.commission ?? 0,
        swap: event.swap ?? 0,
        occurred_at: event.event_timestamp,
      }, { onConflict: "trade_id,deal_id", ignoreDuplicates: true });

      await supabase.from("events").update({ event_type: "partial_close" }).eq("id", event.id);
      console.log("Processed partial close for position:", ticket, "remaining lots:", remainingLots);
    } else {
      // Full close (or late-arriving close for an already-closed trade — we re-aggregate
      // from the `events` table so we never overwrite a prior partial's PnL).
      const duration = Math.floor(
        (new Date(event.event_timestamp).getTime() - new Date(existingTrade.entry_time).getTime()) / 1000,
      );

      // Build the authoritative set of close fills from `events`, deduped by deal_id
      // (falling back to a (price, lot_size, timestamp) signature when deal_id is missing).
      const { data: closeEventRows } = await supabase
        .from("events")
        .select("id, event_type, event_timestamp, price, lot_size, profit, commission, swap, raw_payload")
        .eq("ticket", ticket)
        .eq("account_id", account_id)
        .in("event_type", ["close", "partial_close"]);

      const fillsByKey = new Map<string, {
        price: number; lots: number; profit: number; commission: number; swap: number; occurred_at: string;
      }>();
      const collect = (row: any) => {
        const dealId = row?.raw_payload?.deal_id;
        const key = dealId && Number(dealId) !== 0
          ? `d:${dealId}`
          : `s:${row.price}|${row.lot_size}|${row.event_timestamp}`;
        if (fillsByKey.has(key)) return;
        fillsByKey.set(key, {
          price: Number(row.price) || 0,
          lots: Number(row.lot_size) || 0,
          profit: Number(row.profit) || 0,
          commission: Number(row.commission) || 0,
          swap: Number(row.swap) || 0,
          occurred_at: row.event_timestamp,
        });
      };
      for (const row of closeEventRows || []) collect(row);
      // Include the in-flight event itself (it may not yet be visible above if it's the very row
      // currently being processed in a parallel transaction).
      collect({
        raw_payload: { deal_id: originalPayload.deal_id },
        price: event.price,
        lot_size: lot_size,
        event_timestamp: event.event_timestamp,
        profit: event.profit,
        commission: event.commission,
        swap: event.swap,
      });

      const allFills = Array.from(fillsByKey.values()).sort(
        (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
      );

      let totalGrossPnl = 0;
      let totalCommission = existingTrade.commission || 0;
      let totalSwap = existingTrade.swap || 0;
      for (const f of allFills) {
        totalGrossPnl += f.profit;
        totalCommission += f.commission;
        totalSwap += f.swap;
      }

      const netPnl = computeNetPnl(totalGrossPnl, totalCommission, totalSwap);

      const rMultiple = computeRMultiple({
        entryPrice: existingTrade.entry_price,
        exitPrice: event.price,
        slPrice: existingTrade.sl_initial || existingTrade.sl_final,
        lots: existingTrade.original_lots || existingTrade.total_lots || lot_size,
        grossPnl: totalGrossPnl,
        netPnl,
        symbol: existingTrade.symbol,
        equityAtEntry: existingTrade.equity_at_entry || existingTrade.balance_at_entry,
        direction: existingTrade.direction,
        fills: allFills.map((f) => ({
          time: f.occurred_at,
          lots: f.lots,
          price: f.price,
          pnl: computeNetPnl(f.profit, f.commission, f.swap),
        })),
      });

      // Equity delta: only credit the *new* PnL relative to whatever was previously recorded.
      // For first-time full-close on an open trade, `existingTrade.net_pnl` is null → delta = netPnl.
      // For re-close repair, we credit the difference so we don't double-count.
      if (!isRepair) {
        const priorNet = Number(existingTrade.net_pnl) || 0;
        const delta = netPnl - priorNet;
        if (Math.abs(delta) > 1e-9) {
          await supabase.rpc("apply_equity_delta", { _account_id: account_id, _delta: delta });
        }
      }

      await supabase.from("trades").update({
        exit_price: event.price,
        exit_time: event.event_timestamp,
        gross_pnl: totalGrossPnl,
        commission: totalCommission,
        swap: totalSwap,
        net_pnl: netPnl,
        r_multiple_actual: rMultiple,
        duration_seconds: duration,
        is_open: false,
        total_lots: 0,
        sl_final: event.sl || existingTrade.sl_final,
        tp_final: event.tp || existingTrade.tp_final,
        awaiting_exit: false,
      }).eq("id", existingTrade.id);

      if (isRepair) {
        await insertRepairEvent(supabase, {
          userId,
          tradeId: existingTrade.id,
          action: "repaired_from_snapshot",
          source: "ingest_full_close_repair",
          metadata: { net_pnl: netPnl, ticket, note: "Real PnL recovered from MT5 deal history after EA reconnect" },
        });
      }


      console.log(isRepair ? "REPAIRED full close" : "Processed full close", "for position:", ticket, "PnL:", netPnl, "R:", rMultiple);
    }
  }

  await supabase.from("events").update({ processed: true }).eq("id", event.id);
}
