// Drain up to N pending embed jobs. Called at chat start (fresh recall)
// and on a schedule (backfill catch-up).
import { corsHeaders } from "../_shared/cors.ts";
import { json } from "../_shared/edgeAuth.ts";
import { adminClient, embedTradeIfNeeded } from "../_shared/coachEmbed.ts";

const MAX_PER_RUN = 20;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ error: "LOVABLE_API_KEY missing" }, 500);
    const admin = adminClient();

    let body: any = {};
    try { body = await req.json(); } catch { /* no body ok */ }
    const scopedUser: string | undefined = body?.user_id;
    const cap = Math.min(Math.max(Number(body?.max ?? MAX_PER_RUN), 1), 100);

    // Fetch a batch of jobs. If scoped to a user (drain-on-chat), only their rows.
    let q = admin.from("coach_embed_queue")
      .select("id, trade_id, user_id, attempts")
      .lt("attempts", 3)
      .order("enqueued_at", { ascending: true })
      .limit(cap);
    if (scopedUser) q = q.eq("user_id", scopedUser);
    const { data: jobs, error } = await q;
    if (error) return json({ error: error.message }, 500);
    if (!jobs || jobs.length === 0) return json({ processed: 0 });

    let ok = 0, skipped = 0, failed = 0;
    for (const job of jobs as any[]) {
      try {
        const s = await embedTradeIfNeeded(admin, job.trade_id, job.user_id, apiKey);
        await admin.from("coach_embed_queue").delete().eq("id", job.id);
        if (s === "embedded") ok += 1; else skipped += 1;
      } catch (e) {
        failed += 1;
        await admin.from("coach_embed_queue")
          .update({ attempts: (job.attempts ?? 0) + 1, last_error: (e as Error).message.slice(0, 500) })
          .eq("id", job.id);
      }
    }
    return json({ processed: jobs.length, embedded: ok, skipped, failed });
  } catch (e) {
    console.error("coach-drain-embeddings error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
