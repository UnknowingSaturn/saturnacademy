// Heartbeat + position_snapshot handlers.
// Extracted from ingest-events/index.ts (A-tranche split). Behavior preserved.

import type { EventPayload, ResolvedAccount } from "./eventTypes.ts";

/**
 * Heartbeat handler — updates account health, no event/trade processing.
 * Also auto-detects broker DST profile from observed UTC offsets (cached on
 * the account row; only re-scans history when a new distinct offset appears).
 */
export async function handleHeartbeat(
  supabase: any,
  account: ResolvedAccount,
  payload: EventPayload,
): Promise<Response> {
  console.log(
    "Heartbeat received from terminal:",
    payload.terminal_id,
    "equity:",
    payload.account_info?.equity,
    "positions:",
    payload.open_positions_count,
    "ea_version:",
    payload.ea_version,
  );

  const heartbeatUpdate: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (payload.account_info?.equity) heartbeatUpdate.equity_current = payload.account_info.equity;

  if (typeof payload.broker_utc_offset === "number") {
    try {
      const { data: acc } = await supabase
        .from("accounts")
        .select("broker_dst_profile, broker_utc_offset")
        .eq("id", account.id)
        .single();

      const onManual = !acc?.broker_dst_profile || acc.broker_dst_profile === "MANUAL";
      const offsetChanged = acc?.broker_utc_offset !== payload.broker_utc_offset;

      if (onManual && offsetChanged) {
        const { data: recentHeartbeats } = await supabase
          .from("events")
          .select("raw_payload")
          .eq("account_id", account.id)
          .order("event_timestamp", { ascending: false })
          .limit(200);

        const offsets = new Set<number>();
        (recentHeartbeats || []).forEach((e: any) => {
          const o = e.raw_payload?.broker_utc_offset;
          if (typeof o === "number") offsets.add(o);
        });
        offsets.add(payload.broker_utc_offset);

        let detectedProfile: string | null = null;
        if (offsets.has(2) && offsets.has(3)) detectedProfile = "EET_DST";
        else if (offsets.has(0) && offsets.has(1)) detectedProfile = "GMT_DST";
        else if (offsets.size === 1) {
          const only = [...offsets][0];
          if (only === 0) detectedProfile = "FIXED_PLUS_0";
          else if (only === 2) detectedProfile = "FIXED_PLUS_2";
          else if (only === 3) detectedProfile = "FIXED_PLUS_3";
        }

        if (detectedProfile) {
          heartbeatUpdate.broker_dst_profile = detectedProfile;
          console.log(
            `Auto-detected broker DST profile: ${detectedProfile} for account ${account.id} (offsets: ${[...offsets].join(",")})`,
          );
        }
      }
    } catch (err) {
      console.error("DST profile auto-detect failed (non-fatal):", err);
    }

    heartbeatUpdate.broker_utc_offset = payload.broker_utc_offset;
  }

  heartbeatUpdate.last_sync_at = new Date().toISOString();
  await supabase.from("accounts").update(heartbeatUpdate).eq("id", account.id);

  return jsonOk({ status: "accepted", message: "Heartbeat received" });
}

/**
 * Position snapshot — READ-ONLY drift signal.
 * Records what the EA currently sees on this (terminal_id, active_login).
 * NEVER mutates trades; drift is surfaced via the trades-drift function.
 */
export async function handleSnapshot(
  supabase: any,
  account: ResolvedAccount,
  payload: EventPayload,
): Promise<Response> {
  const openTickets = payload.open_position_tickets || [];
  const activeLogin = payload.account_info?.login != null
    ? String(payload.account_info.login)
    : null;

  console.log(
    "Position snapshot received (read-only):",
    openTickets.length,
    "open positions from terminal:",
    payload.terminal_id,
    "login:",
    activeLogin,
  );

  await supabase.from("terminal_snapshots").insert({
    user_id: account.user_id,
    terminal_id: payload.terminal_id,
    install_id: payload.install_id || null,
    active_login: activeLogin,
    account_id: account.id,
    open_tickets: openTickets,
    ea_version: payload.ea_version || null,
    raw_payload: payload.raw_payload || null,
  });

  await supabase
    .from("accounts")
    .update({ last_sync_at: new Date().toISOString() })
    .eq("id", account.id);

  return jsonOk({
    status: "accepted",
    message: "Snapshot recorded (read-only)",
    terminal_id: payload.terminal_id,
    account_id: account.id,
    open_in_mt5: openTickets.length,
  });
}

// Local helper — kept private so the router can compose CORS headers freely.
import { corsHeaders } from "./cors.ts";
function jsonOk(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
