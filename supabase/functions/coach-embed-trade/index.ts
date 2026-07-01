// Embed a single trade on demand. Used by the drain job and (optionally)
// invoked directly after a trade is saved.
import { corsHeaders } from "../_shared/cors.ts";
import { requireUser, json } from "../_shared/edgeAuth.ts";
import { embedTradeIfNeeded } from "../_shared/coachEmbed.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ error: "LOVABLE_API_KEY missing" }, 500);
    const { userId, admin } = await requireUser(req);
    const { trade_id } = await req.json();
    if (!trade_id) return json({ error: "trade_id required" }, 400);

    // Verify ownership before embedding.
    const { data: t } = await admin.from("trades").select("id, user_id").eq("id", trade_id).maybeSingle();
    if (!t) return json({ error: "Trade not found" }, 404);
    if ((t as any).user_id !== userId) return json({ error: "Forbidden" }, 403);

    const status = await embedTradeIfNeeded(admin, trade_id, userId, apiKey);
    // Clear from queue on success.
    await admin.from("coach_embed_queue").delete().eq("trade_id", trade_id);
    return json({ status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("coach-embed-trade error:", msg);
    return json({ error: msg }, 500);
  }
});
