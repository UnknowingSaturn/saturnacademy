// Consolidated trade rebuild endpoint.
//
// Replaces three earlier functions:
//   - reprocess-trades        → mode: "reprocess"          (per-account: session + R% + running balance)
//   - reclassify-sessions     → mode: "reclassify-sessions" (per-user: session only, all trades)
//   - restore-trade-times     → mode: "restore-times"       (per-account: rebuild entry/exit from events using DST profile)
//
// All callers are authenticated React clients. We verify JWT and enforce ownership before any write.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { json, requireUser, requireOwnedAccount, AuthError } from "../_shared/edgeAuth.ts";
import { computeRMultiple } from "../_shared/rMultiple.ts";
import { classifySession, DEFAULT_SESSIONS, SessionDefinition } from "../_shared/session.ts";

type Mode = "reprocess" | "reclassify-sessions" | "restore-times";
type BrokerDstProfile =
  | "EET_DST" | "GMT_DST"
  | "FIXED_PLUS_3" | "FIXED_PLUS_2" | "FIXED_PLUS_0"
  | "MANUAL";

interface RebuildRequest {
  mode: Mode;
  account_id?: string;
  use_custom_sessions?: boolean;
  broker_utc_offset?: number;
  broker_dst_profile?: BrokerDstProfile;
}

// --- helpers shared across modes ----------------------------------------------

async function loadUserSessions(
  admin: SupabaseClient,
  userId: string,
  useCustom = true,
): Promise<SessionDefinition[]> {
  if (!useCustom) return DEFAULT_SESSIONS;
  const { data } = await admin
    .from("session_definitions")
    .select("key,start_hour,start_minute,end_hour,end_minute,timezone,sort_order,is_active,name,color")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("sort_order");
  return data && data.length > 0 ? (data as SessionDefinition[]) : DEFAULT_SESSIONS;
}

// --- mode: restore-times helpers ---------------------------------------------

function getIanaOffsetHours(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(date).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  return Math.round((asUtc - date.getTime()) / 3_600_000);
}

function resolveBrokerOffsetHours(
  profile: BrokerDstProfile,
  timestamp: Date,
  manualOffsetHours: number,
): number {
  switch (profile) {
    case "FIXED_PLUS_0": return 0;
    case "FIXED_PLUS_2": return 2;
    case "FIXED_PLUS_3": return 3;
    case "EET_DST":      return getIanaOffsetHours("Europe/Athens", timestamp);
    case "GMT_DST":      return getIanaOffsetHours("Europe/London", timestamp);
    case "MANUAL":
    default:             return manualOffsetHours;
  }
}

// --- mode handlers ------------------------------------------------------------

async function runReprocess(
  admin: SupabaseClient,
  userId: string,
  body: RebuildRequest,
) {
  const accountId = body.account_id;
  if (!accountId) return json({ error: "account_id is required" }, 400);

  const { data: account, error: accountErr } = await admin
    .from("accounts")
    .select("*")
    .eq("id", accountId)
    .single();
  if (accountErr || !account) return json({ error: "Account not found" }, 404);
  if (account.user_id !== userId) return json({ error: "Forbidden" }, 403);

  const sessions = await loadUserSessions(admin, userId, body.use_custom_sessions !== false);

  const { data: trades, error: tradesErr } = await admin
    .from("trades")
    .select("*, trade_partial_fills(occurred_at, lots, price, profit, commission, swap)")
    .eq("account_id", accountId)
    .order("entry_time", { ascending: true });
  if (tradesErr) return json({ error: "Failed to fetch trades" }, 500);
  if (!trades || trades.length === 0) {
    return json({ message: "No trades to recalculate", trades_updated: 0 });
  }

  let updated = 0;
  let runningBalance = account.balance_start || 0;
  const closed = trades.filter((t) => !t.is_open).sort(
    (a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime(),
  );
  const open = trades.filter((t) => t.is_open);

  for (const trade of closed) {
    try {
      const entryTime = new Date(trade.entry_time);
      const session = classifySession(entryTime, sessions);
      const rMultiple = computeRMultiple({
        entryPrice: trade.entry_price,
        exitPrice: trade.exit_price,
        slPrice: trade.sl_initial || trade.sl_final,
        lots: trade.original_lots || trade.total_lots,
        grossPnl: trade.gross_pnl,
        netPnl: trade.net_pnl,
        symbol: trade.symbol,
        equityAtEntry: trade.equity_at_entry || runningBalance,
        direction: trade.direction,
        fills: Array.isArray(trade.trade_partial_fills) && trade.trade_partial_fills.length > 0
          ? trade.trade_partial_fills.map((f: any) => ({
              time: f.occurred_at,
              lots: Number(f.lots),
              price: Number(f.price),
              pnl: (Number(f.profit) || 0) - (Number(f.commission) || 0) - Math.abs(Number(f.swap) || 0),
            }))
          : null,
      });
      const { error: upErr } = await admin
        .from("trades")
        .update({ session, balance_at_entry: runningBalance, r_multiple_actual: rMultiple })
        .eq("id", trade.id);
      if (!upErr) {
        updated++;
        if (trade.net_pnl !== null) runningBalance += trade.net_pnl;
      } else {
        console.error(`reprocess: trade ${trade.id} update failed`, upErr);
      }
    } catch (err) {
      console.error(`reprocess: trade ${trade.id} error`, err);
    }
  }

  for (const trade of open) {
    try {
      const session = classifySession(new Date(trade.entry_time), sessions);
      const { error: upErr } = await admin
        .from("trades")
        .update({ session, balance_at_entry: runningBalance })
        .eq("id", trade.id);
      if (!upErr) updated++;
    } catch (err) {
      console.error(`reprocess: open trade ${trade.id} error`, err);
    }
  }

  return json({
    message: "Trade data recalculated successfully",
    trades_updated: updated,
    sessions_used: sessions.length,
  });
}

async function runReclassifySessions(admin: SupabaseClient, userId: string) {
  const sessions = await loadUserSessions(admin, userId, true);

  let from = 0;
  const pageSize = 1000;
  let scanned = 0;
  let updated = 0;
  const counts: Record<string, number> = {};

  while (true) {
    const { data: trades, error } = await admin
      .from("trades")
      .select("id, entry_time, session")
      .eq("user_id", userId)
      .order("entry_time", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) return json({ error: error.message }, 500);
    if (!trades || trades.length === 0) break;

    scanned += trades.length;
    for (const t of trades) {
      if (!t.entry_time) continue;
      const newSession = classifySession(t.entry_time, sessions);
      counts[newSession] = (counts[newSession] || 0) + 1;
      if (newSession !== t.session) {
        const { error: upErr } = await admin
          .from("trades")
          .update({ session: newSession })
          .eq("id", t.id);
        if (!upErr) updated++;
      }
    }
    if (trades.length < pageSize) break;
    from += pageSize;
  }

  return json({
    success: true,
    scanned,
    updated,
    sessions_used: sessions.length,
    breakdown: counts,
  });
}

async function runRestoreTimes(
  admin: SupabaseClient,
  userId: string,
  body: RebuildRequest,
) {
  const accountId = body.account_id;
  if (!accountId) return json({ error: "account_id is required" }, 400);

  const { data: account, error: accountErr } = await admin
    .from("accounts")
    .select("*")
    .eq("id", accountId)
    .single();
  if (accountErr || !account) return json({ error: `Account ${accountId} not found` }, 404);
  if (account.user_id !== userId) return json({ error: "Forbidden" }, 403);

  const profile: BrokerDstProfile =
    (body.broker_dst_profile as BrokerDstProfile)
    ?? (account.broker_dst_profile as BrokerDstProfile)
    ?? "MANUAL";
  const manualOffset = body.broker_utc_offset ?? account.broker_utc_offset ?? 2;

  const { data: events, error: evErr } = await admin
    .from("events")
    .select("*")
    .eq("account_id", accountId)
    .order("event_timestamp", { ascending: true })
    .limit(50000);
  if (evErr) return json({ error: "Failed to fetch events", details: evErr.message }, 500);

  if (!events || events.length === 0) {
    return json({
      message: "No EA events stored for this account — timezone correction only applies to trades imported via the live EA bridge, not CSV imports.",
      trades_updated: 0,
      trades_not_found: 0,
      total_positions: 0,
      failures: [],
    });
  }

  const eventsByTicket = new Map<number, any[]>();
  for (const ev of events) {
    const arr = eventsByTicket.get(ev.ticket) ?? [];
    arr.push(ev);
    eventsByTicket.set(ev.ticket, arr);
  }

  const convertToUtc = (event: any): string | null => {
    if (!event.event_timestamp) return null;
    const naive = new Date(event.event_timestamp);
    if (isNaN(naive.getTime())) return null;
    const perEventOffset = event.raw_payload?.broker_utc_offset;
    const offsetH = typeof perEventOffset === "number"
      ? perEventOffset
      : resolveBrokerOffsetHours(profile, naive, manualOffset);
    return new Date(naive.getTime() - offsetH * 3_600_000).toISOString();
  };

  let updated = 0;
  let notFound = 0;
  const failures: Array<{ ticket: number; reason: string }> = [];

  for (const [ticket, positionEvents] of eventsByTicket) {
    try {
      const openEvent = positionEvents.find((e) => e.event_type === "open");
      const closeEvent = positionEvents.find((e) => e.event_type === "close");
      if (!openEvent) { failures.push({ ticket, reason: "No open event found" }); continue; }
      const entryTimeUTC = convertToUtc(openEvent);
      if (!entryTimeUTC) { failures.push({ ticket, reason: "Invalid open event timestamp" }); continue; }

      const { data: trade } = await admin
        .from("trades")
        .select("id, entry_time, exit_time")
        .eq("ticket", ticket)
        .eq("account_id", accountId)
        .single();
      if (!trade) { notFound++; continue; }

      const updateData: Record<string, unknown> = { entry_time: entryTimeUTC };
      if (closeEvent) {
        const exitTimeUTC = convertToUtc(closeEvent);
        if (exitTimeUTC) updateData.exit_time = exitTimeUTC;
      }
      const { error: upErr } = await admin.from("trades").update(updateData).eq("id", trade.id);
      if (upErr) failures.push({ ticket, reason: upErr.message });
      else updated++;
    } catch (err) {
      failures.push({ ticket, reason: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  return json({
    message: `Restored ${updated} trades from ${eventsByTicket.size} positions using profile ${profile}`,
    trades_updated: updated,
    trades_not_found: notFound,
    total_positions: eventsByTicket.size,
    profile_used: profile,
    failures,
  });
}

// --- entry --------------------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Missing Authorization header" }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Invalid session" }, 401);
    const userId = userData.user.id;

    const admin = createClient(supabaseUrl, serviceKey);
    const body: RebuildRequest = await req.json().catch(() => ({} as RebuildRequest));
    if (!body.mode) return json({ error: "mode is required" }, 400);

    switch (body.mode) {
      case "reprocess":           return await runReprocess(admin, userId, body);
      case "reclassify-sessions": return await runReclassifySessions(admin, userId);
      case "restore-times":       return await runRestoreTimes(admin, userId, body);
      default:                    return json({ error: `Unknown mode: ${body.mode}` }, 400);
    }
  } catch (err) {
    console.error("trade-rebuild error:", err);
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
