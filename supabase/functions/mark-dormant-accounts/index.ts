// Cron worker (runs every 2 min) that flips accounts to live_state='dormant'
// when their per-login heartbeat has been silent for more than 10 minutes.
// No auth required — invoked by pg_cron via pg_net.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STALE_AFTER_MIN = 10;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const cutoff = new Date(Date.now() - STALE_AFTER_MIN * 60_000).toISOString();

    // Only accounts whose EA has actually checked in at least once and are
    // currently 'live' — leaves brand-new accounts (no heartbeat yet) alone.
    const { data: stale, error } = await supabase
      .from("accounts")
      .update({ live_state: "dormant" })
      .eq("live_state", "live")
      .not("last_heartbeat_at", "is", null)
      .lt("last_heartbeat_at", cutoff)
      .select("id");

    if (error) throw error;

    return new Response(
      JSON.stringify({ status: "ok", marked_dormant: stale?.length ?? 0, cutoff }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("mark-dormant-accounts error:", err);
    return new Response(
      JSON.stringify({ status: "error", message: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
