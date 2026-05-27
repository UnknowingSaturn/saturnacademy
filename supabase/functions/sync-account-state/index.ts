// Returns the server's authoritative sync watermark for a (user, broker login)
// pair so the MT5 EA can gap-fill on connect and on a periodic timer.
//
// Auth: x-api-key (same model as ingest-events). The API key resolves the user;
// the broker login then resolves the account. install_id is recorded for
// multi-account-per-terminal awareness but is NOT required for the lookup.
//
// Response:
//   {
//     account_id: uuid,
//     last_deal_id: number | null,        // highest deal id we've ever ingested
//     last_event_time: ISO string | null, // event_timestamp of the latest event
//     open_tickets: number[],             // tickets the server still has is_open=true
//     server_time: ISO string
//   }
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
    if (!apiKey) {
      return jsonError("Missing API key", 401);
    }

    const body = await req.json().catch(() => ({}));
    const login = body?.login != null ? String(body.login) : null;
    const installId: string | null = typeof body?.install_id === "string" ? body.install_id : null;

    if (!login) {
      return jsonError("login is required", 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve user from API key (account.api_key OR active setup_token)
    const { data: accForKey } = await supabase
      .from("accounts")
      .select("user_id")
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

    // Resolve target account by (user_id, broker login)
    const { data: account } = await supabase
      .from("accounts")
      .select("id, mt5_install_id")
      .eq("user_id", userId)
      .eq("account_number", login)
      .eq("is_active", true)
      .maybeSingle();

    if (!account) {
      // No matching account yet — first connect for this login. EA should
      // run a fresh history sync; we return an empty watermark.
      return jsonOk({
        account_id: null,
        last_deal_id: null,
        last_event_time: null,
        open_tickets: [],
        server_time: new Date().toISOString(),
      });
    }

    // Backfill install_id when EA finally tells us
    if (installId && account.mt5_install_id !== installId) {
      await supabase
        .from("accounts")
        .update({ mt5_install_id: installId })
        .eq("id", account.id);
    }

    // Latest event we've ingested for this account
    const { data: latestEvents } = await supabase
      .from("events")
      .select("ticket, event_timestamp, raw_payload")
      .eq("account_id", account.id)
      .order("event_timestamp", { ascending: false })
      .limit(1);

    const latest = latestEvents?.[0];
    // deal_id lives in raw_payload (events.ticket is the position id)
    const lastDealId =
      latest?.raw_payload?.deal_id != null ? Number(latest.raw_payload.deal_id) : null;

    // Open tickets the server still considers live for this account
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
      last_deal_id: lastDealId,
      last_event_time: latest?.event_timestamp ?? null,
      open_tickets: openTickets,
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
