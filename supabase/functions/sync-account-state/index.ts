// Returns the server's authoritative sync watermark for a (user, broker login)
// pair so the MT5 EA can gap-fill on connect and on a periodic timer.
//
// Resolution cascade (multi-account-per-terminal aware):
//   1. account_number == login (for this user)
//   2. mt5_install_id == install_id (for this user) — picks any sibling on the
//      same MT5 install and backfills account_number to the live login.
//   3. API-key-bound account as final fallback.
//
// Side effects on a successful resolution:
//   - Backfills account_number / mt5_install_id on the resolved row.
//   - Bumps accounts.last_heartbeat_at = now() and live_state = 'live'.
//   - If the account was 'dormant' OR force_resync=true, auto-closes any
//     trades still marked is_open=true whose ticket is NOT in the EA-supplied
//     expected_open_tickets[] — and clears force_resync afterwards.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = req.headers.get("x-api-key");
    if (!apiKey) return jsonError("Missing API key", 401);

    const body = await req.json().catch(() => ({}));
    const login = body?.login != null ? String(body.login) : null;
    const installId: string | null = typeof body?.install_id === "string" ? body.install_id : null;
    // EA-side ground truth: tickets MT5 currently has open for this login.
    // Used for on-reconnect / force-resync auto-close of stale is_open trades.
    const eaOpenTickets: number[] = Array.isArray(body?.open_tickets)
      ? body.open_tickets.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0)
      : [];
    const force: boolean = body?.force === true;

    if (!login) return jsonError("login is required", 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve user from API key (account.api_key OR active setup_token)
    const { data: accForKey } = await supabase
      .from("accounts")
      .select("id, user_id")
      .eq("api_key", apiKey)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    let userId: string | null = accForKey?.user_id ?? null;
    if (!userId) {
      const { data: tok } = await supabase
        .from("setup_tokens")
        .select("user_id, used")
        .eq("token", apiKey)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (tok && !tok.used) userId = tok.user_id;
    }
    if (!userId) return jsonError("Invalid API key", 401);

    // ---- Resolution cascade ----
    let account: { id: string; mt5_install_id: string | null; account_number: string | null; live_state: string | null; force_resync: boolean } | null = null;

    // 1. by (user_id, account_number = login)
    {
      const { data } = await supabase
        .from("accounts")
        .select("id, mt5_install_id, account_number, live_state, force_resync")
        .eq("user_id", userId)
        .eq("account_number", login)
        .eq("is_active", true)
        .maybeSingle();
      if (data) account = data as any;
    }

    // 2. by (user_id, mt5_install_id) — sibling on the same MT5 install.
    //    Treat as a TEMPLATE only. If the login is new, we deliberately return
    //    account_id:null so the EA does a fresh history sync; ingest-events
    //    will then auto-create a new row per login. Never overwrite
    //    account_number on the sibling.
    let siblingExists = false;
    if (!account && installId) {
      const { data } = await supabase
        .from("accounts")
        .select("id")
        .eq("user_id", userId)
        .eq("mt5_install_id", installId)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      siblingExists = !!data;
    }

    // 3. API-key-bound account — last resort, only when no install sibling
    //    exists (otherwise we'd misroute a new login to an unrelated account
    //    that happens to share the api key).
    if (!account && !siblingExists && accForKey) {
      const { data } = await supabase
        .from("accounts")
        .select("id, mt5_install_id, account_number, live_state, force_resync")
        .eq("id", accForKey.id)
        .maybeSingle();
      if (data) account = data as any;
    }

    if (!account) {
      // First-ever connect for this login. EA should do a fresh history sync.
      return jsonOk({
        account_id: null,
        last_deal_id: null,
        last_event_time: null,
        open_tickets: [],
        server_time: new Date().toISOString(),
      });
    }

    // Backfill account_number / install_id when missing or stale (login switched)
    const patch: Record<string, unknown> = {
      last_heartbeat_at: new Date().toISOString(),
      live_state: "live",
    };
    if (account.account_number !== login) patch.account_number = login;
    if (installId && account.mt5_install_id !== installId) patch.mt5_install_id = installId;

    const wasDormant = account.live_state === "dormant";
    const shouldResync = wasDormant || account.force_resync || force;

    // ---- On-reconnect / force-resync repair ----
    let autoClosedCount = 0;
    if (shouldResync) {
      const { data: openTrades } = await supabase
        .from("trades")
        .select("id, ticket, entry_price, entry_time, raw_payload")
        .eq("account_id", account.id)
        .eq("is_open", true);

      const stale = (openTrades || []).filter(
        (t: any) => !eaOpenTickets.includes(Number(t.ticket)),
      );

      for (const t of stale as any[]) {
        const merged = { ...(t.raw_payload || {}), repair_reason: "auto_close_on_reconnect", repaired_at: new Date().toISOString() };
        await supabase
          .from("trades")
          .update({
            is_open: false,
            exit_time: new Date().toISOString(),
            exit_price: t.entry_price,
            raw_payload: merged,
          })
          .eq("id", t.id);
        autoClosedCount += 1;
      }

      if (account.force_resync) patch.force_resync = false;
    }

    await supabase.from("accounts").update(patch).eq("id", account.id);

    // Latest event we've ingested
    const { data: latestEvents } = await supabase
      .from("events")
      .select("ticket, event_timestamp, raw_payload")
      .eq("account_id", account.id)
      .order("event_timestamp", { ascending: false })
      .limit(1);
    const latest = latestEvents?.[0];
    const lastDealId =
      latest?.raw_payload?.deal_id != null ? Number(latest.raw_payload.deal_id) : null;

    // Open tickets the server still considers live (post-repair)
    const { data: openTrades } = await supabase
      .from("trades")
      .select("ticket")
      .eq("account_id", account.id)
      .eq("is_open", true);
    const openTickets = (openTrades || [])
      .map((t: any) => Number(t.ticket))
      .filter((n) => Number.isFinite(n) && n > 0);

    return jsonOk({
      account_id: account.id,
      last_deal_id: shouldResync ? null : lastDealId,
      last_event_time: shouldResync ? null : (latest?.event_timestamp ?? null),
      open_tickets: openTickets,
      auto_closed: autoClosedCount,
      was_dormant: wasDormant,
      server_time: new Date().toISOString(),
    });
  } catch (err) {
    console.error("sync-account-state error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonError(message, 500);
  }
});

function jsonOk(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ status: "error", message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
