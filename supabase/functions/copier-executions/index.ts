import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
};

// Payload shape mirrors copier-desktop/src-tauri/src/copier/mod.rs::Execution
interface DesktopExecution {
  id: string;
  timestamp: string; // RFC3339
  event_type: string;
  symbol: string;
  direction: string;
  master_lots: number;
  receiver_lots: number;
  master_price: number;
  executed_price: number | null;
  slippage_pips: number | null;
  status: string; // success | error | blocked | pending
  error_message: string | null;
  receiver_account: string; // account_number string
  // Optional richer fields the desktop may attach
  master_position_id?: number | null;
  receiver_position_id?: number | null;
  idempotency_key?: string | null;
  master_account_number?: string | null;
}

// Map desktop status -> DB-allowed enum (success | failed | skipped)
function normalizeStatus(s: string): "success" | "failed" | "skipped" {
  const x = (s || "").toLowerCase();
  if (x === "success") return "success";
  if (x === "blocked" || x === "skipped") return "skipped";
  return "failed";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const apiKey =
      req.headers.get("x-api-key") ||
      new URL(req.url).searchParams.get("api_key");

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "API key required (x-api-key header)" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Resolve user from API key (any account belonging to user works)
    const { data: callerAccount, error: callerErr } = await supabase
      .from("accounts")
      .select("id, user_id")
      .eq("api_key", apiKey)
      .maybeSingle();

    if (callerErr || !callerAccount) {
      return new Response(
        JSON.stringify({ error: "Invalid API key" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const userId = callerAccount.user_id as string;

    // Accept either a single execution or an array
    const raw = await req.json().catch(() => null);
    const executions: DesktopExecution[] = Array.isArray(raw)
      ? raw
      : raw
      ? [raw]
      : [];

    if (executions.length === 0) {
      return new Response(
        JSON.stringify({ inserted: 0, skipped: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Pre-fetch this user's accounts to map account_number -> id
    const { data: userAccounts } = await supabase
      .from("accounts")
      .select("id, account_number, copier_role")
      .eq("user_id", userId);

    const accountByNumber = new Map<string, { id: string; role: string | null }>();
    for (const a of userAccounts || []) {
      if (a.account_number) {
        accountByNumber.set(String(a.account_number), {
          id: a.id,
          role: a.copier_role ?? null,
        });
      }
    }

    // Best-effort master id: first account with copier_role = 'master'
    const masterAccountId =
      (userAccounts || []).find((a) => a.copier_role === "master")?.id ?? null;

    const rows = executions.map((e) => {
      const recv = accountByNumber.get(String(e.receiver_account));
      const masterId =
        e.master_account_number
          ? accountByNumber.get(String(e.master_account_number))?.id ?? masterAccountId
          : masterAccountId;

      const idempotencyKey =
        e.idempotency_key ||
        // Fallback: stable key per (receiver, position, event_type)
        `${recv?.id ?? "unknown"}:${e.master_position_id ?? e.id}:${e.event_type}`;

      return {
        user_id: userId,
        master_account_id: masterId,
        receiver_account_id: recv?.id ?? null,
        idempotency_key: idempotencyKey,
        master_position_id: e.master_position_id ?? null,
        receiver_position_id: e.receiver_position_id ?? null,
        event_type: e.event_type,
        symbol: e.symbol,
        direction: e.direction,
        master_lots: e.master_lots ?? null,
        receiver_lots: e.receiver_lots ?? null,
        master_price: e.master_price ?? null,
        executed_price: e.executed_price ?? null,
        slippage_pips: e.slippage_pips ?? null,
        status: normalizeStatus(e.status),
        error_message: e.error_message ?? null,
        executed_at: e.timestamp || new Date().toISOString(),
      };
    });

    // Upsert to dedupe on (receiver_account_id, idempotency_key)
    const { data: inserted, error: insertErr } = await supabase
      .from("copier_executions")
      .upsert(rows, {
        onConflict: "receiver_account_id,idempotency_key",
        ignoreDuplicates: true,
      })
      .select("id");

    if (insertErr) {
      console.error("Insert error:", insertErr);
      return new Response(
        JSON.stringify({ error: "Failed to insert executions", details: insertErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const insertedCount = inserted?.length ?? 0;
    return new Response(
      JSON.stringify({
        inserted: insertedCount,
        skipped: rows.length - insertedCount,
        total: rows.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("copier-executions error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: "Internal server error", details: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
