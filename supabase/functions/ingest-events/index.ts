// ingest-events — thin router.
// Heavy lifting lives in ../_shared/{accountResolver,healthEvents,tradeEventProcessor}.
// Behavior is byte-equivalent to the pre-split monolith.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import type { EventPayload } from "../_shared/eventTypes.ts";
import {
  ResolveError,
  applyPerEventSideEffects,
  resolveAccount,
} from "../_shared/accountResolver.ts";
import { handleHeartbeat, handleSnapshot } from "../_shared/healthEvents.ts";
import { processEvent } from "../_shared/tradeEventProcessor.ts";

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = req.headers.get("x-api-key");
    if (!apiKey) {
      console.error("Missing API key");
      return json({ status: "error", message: "Missing API key" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const payload: EventPayload = await req.json();
    console.log(
      "Received event:",
      payload.idempotency_key,
      payload.event_type,
      "position:",
      payload.position_id,
      "deal:",
      payload.deal_id,
    );

    // ===== Account resolution (multi-account aware) =====
    let resolved;
    try {
      resolved = await resolveAccount(supabase, apiKey, payload);
    } catch (e) {
      if (e instanceof ResolveError) {
        console.error("Account resolution failed:", e.message);
        return json({ status: "error", message: e.message }, e.status);
      }
      throw e;
    }
    const { account, brokerLogin } = resolved;

    // Per-event side effects (heartbeat bump, balance snapshot)
    await applyPerEventSideEffects(supabase, account, payload);

    // ===== Heartbeat =====
    if (payload.event_type === "heartbeat") {
      return await handleHeartbeat(supabase, account, payload);
    }

    // ===== Position snapshot (read-only) =====
    if (payload.event_type === "position_snapshot") {
      return await handleSnapshot(supabase, account, payload);
    }

    // ===== history_sync server-side filtering =====
    if (payload.event_type === "history_sync") {
      const { data: accountSettings } = await supabase
        .from("accounts")
        .select("sync_history_enabled, sync_history_from")
        .eq("id", account.id)
        .single();

      if (accountSettings && accountSettings.sync_history_enabled === false) {
        console.log("History sync disabled, skipping event:", payload.idempotency_key);
        return json({
          status: "skipped",
          reason: "history_sync_disabled",
          message: "Historical sync is disabled for this account",
        });
      }

      if (accountSettings?.sync_history_from) {
        const eventTime = new Date(payload.timestamp);
        const syncCutoff = new Date(accountSettings.sync_history_from);
        if (eventTime < syncCutoff) {
          console.log("Event before sync cutoff, skipping:", payload.idempotency_key);
          return json({
            status: "skipped",
            reason: "before_sync_cutoff",
            message: "Event is older than configured sync date",
          });
        }
      }
    }

    // ===== Idempotency =====
    const { data: existingEvent } = await supabase
      .from("events")
      .select("id")
      .eq("idempotency_key", payload.idempotency_key)
      .maybeSingle();

    if (existingEvent) {
      console.log("Duplicate event:", payload.idempotency_key);
      return json({
        status: "duplicate",
        event_id: existingEvent.id,
        message: "Event already processed",
      });
    }

    // ===== Deal-level dedup for close/partial_close =====
    // EAs sometimes emit BOTH a `partial_close` and a `close` event for the
    // same MT5 deal (different idempotency keys). Without this guard the
    // processor double-aggregates and can overwrite a prior partial's PnL.
    const tradeTicketEarly = payload.position_id || payload.ticket;
    const dealId = payload.deal_id;
    const closeLikeTypes = new Set(["close", "partial_close", "exit"]);
    if (
      dealId &&
      Number(dealId) !== 0 &&
      tradeTicketEarly &&
      closeLikeTypes.has(payload.event_type)
    ) {
      const { data: dupDeal } = await supabase
        .from("events")
        .select("id, event_type")
        .eq("ticket", tradeTicketEarly)
        .eq("account_id", account.id)
        .filter("raw_payload->>deal_id", "eq", String(dealId))
        .in("event_type", ["close", "partial_close"])
        .limit(1)
        .maybeSingle();
      if (dupDeal) {
        console.log("Duplicate deal-level close event:", { ticket: tradeTicketEarly, deal_id: dealId });
        return json({
          status: "duplicate",
          event_id: dupDeal.id,
          message: "Close event already recorded for this deal_id",
        });
      }
    }

    // Map event_type → db enum
    let dbEventType = payload.event_type;
    let effectiveEventType = payload.event_type;
    if (payload.event_type === "history_sync") {
      effectiveEventType = payload.original_event_type || "entry";
      dbEventType = effectiveEventType === "entry" ? "open" : "close";
    } else if (payload.event_type === "entry") {
      dbEventType = "open";
    } else if (payload.event_type === "exit") {
      dbEventType = "close";
    } else if (payload.event_type === "modify") {
      dbEventType = "modify";
    }

    const tradeTicket = payload.position_id || payload.ticket;

    const { data: newEvent, error: insertError } = await supabase
      .from("events")
      .insert({
        idempotency_key: payload.idempotency_key,
        user_id: account.user_id,
        account_id: account.id,
        terminal_id: payload.terminal_id,
        install_id: payload.install_id ?? null,
        broker_login: brokerLogin,
        event_type: dbEventType,
        ticket: tradeTicket,
        symbol: payload.symbol,
        direction: payload.direction,
        lot_size: payload.lot_size,
        price: payload.price,
        sl: payload.sl,
        tp: payload.tp,
        commission: payload.commission || 0,
        swap: payload.swap || 0,
        profit: payload.profit,
        event_timestamp: payload.timestamp,
        raw_payload: {
          ...payload.raw_payload,
          position_id: payload.position_id,
          deal_id: payload.deal_id,
          order_id: payload.order_id,
          server_time: payload.server_time,
          timezone_offset_seconds: payload.timezone_offset_seconds,
          equity_at_entry: payload.equity_at_entry,
          entry_price: payload.entry_price,
          entry_time: payload.entry_time,
          spread: payload.spread,
          ea_version: payload.ea_version,
          broker_utc_offset: payload.broker_utc_offset,
        },
        processed: false,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      return json(
        { status: "error", message: insertError.message, retry_after: 5000 },
        500,
      );
    }

    await processEvent(supabase, newEvent, account.user_id, payload);

    await supabase
      .from("accounts")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("id", account.id);

    console.log("Event processed:", newEvent.id);
    return json({
      status: "accepted",
      event_id: newEvent.id,
      account_id: account.id,
      message: "Event processed successfully",
    });
  } catch (error) {
    console.error("Error processing event:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return json({ status: "error", message, retry_after: 5000 }, 500);
  }
});
