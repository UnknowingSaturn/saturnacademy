import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifySession, DEFAULT_SESSIONS, SessionDefinition } from "../_shared/session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load user's session definitions
    const { data: customSessions } = await supabase
      .from("session_definitions")
      .select("key,start_hour,start_minute,end_hour,end_minute,timezone,sort_order,is_active")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("sort_order");
    const sessions: SessionDefinition[] =
      customSessions && customSessions.length > 0
        ? (customSessions as SessionDefinition[])
        : DEFAULT_SESSIONS;

    console.log(`Reclassifying sessions for user ${user.id} using ${sessions.length} session(s)`);

    // Pull all the user's trades (id + entry_time + current session) in pages of 1000
    let from = 0;
    const pageSize = 1000;
    let totalScanned = 0;
    let totalUpdated = 0;
    const counts: Record<string, number> = {};

    while (true) {
      const { data: trades, error } = await supabase
        .from("trades")
        .select("id, entry_time, session")
        .eq("user_id", user.id)
        .order("entry_time", { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) {
        console.error("Fetch error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!trades || trades.length === 0) break;

      totalScanned += trades.length;

      // Compute the new session per trade and only update changed ones
      for (const t of trades) {
        if (!t.entry_time) continue;
        const newSession = classify(t.entry_time, sessions);
        counts[newSession] = (counts[newSession] || 0) + 1;
        if (newSession !== t.session) {
          const { error: updateError } = await supabase
            .from("trades")
            .update({ session: newSession })
            .eq("id", t.id);
          if (updateError) {
            console.error("Update failed for trade", t.id, updateError);
          } else {
            totalUpdated++;
          }
        }
      }

      if (trades.length < pageSize) break;
      from += pageSize;
    }

    console.log("Reclassify complete:", { totalScanned, totalUpdated, counts });

    return new Response(
      JSON.stringify({
        success: true,
        scanned: totalScanned,
        updated: totalUpdated,
        sessions_used: sessions.length,
        breakdown: counts,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("reclassify-sessions error:", error);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
