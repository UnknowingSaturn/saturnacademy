// Shared embedding helper for the Trading Coach.
// Builds the canonical text-to-embed for a trade, hashes it, and calls the
// Lovable AI Gateway to produce a 1536-dim vector (openai/text-embedding-3-small).
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/embeddings";
const EMBED_MODEL = "openai/text-embedding-3-small";
export const EMBED_DIMS = 1536;

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function joinArr(v: unknown): string {
  if (!v) return "";
  if (Array.isArray(v)) return v.filter(Boolean).join(" | ");
  return String(v);
}

/** Build the canonical text used for embedding one trade. Returns null if
 * there's no prose worth embedding (numbers alone don't need semantic recall). */
export async function buildTradeContent(
  admin: SupabaseClient,
  tradeId: string,
): Promise<{ content: string; preview: string } | null> {
  // Columns must match public.trades / trade_reviews / ai_reviews exactly —
  // a bad column here fails the whole select and silently kills recall.
  const { data: trade } = await admin
    .from("trades")
    .select(`
      id, symbol, direction, net_pnl, r_multiple_actual, r_multiple_planned, entry_time, exit_time, session,
      playbook:playbooks!trades_playbook_id_fkey(name),
      trade_reviews(mistakes, did_well, to_improve, actionable_steps, thoughts, psychology_notes,
                    emotional_state_before, emotional_state_after, regime, news_risk),
      ai_reviews(technical_review, mistake_attribution, psychology_analysis, actionable_guidance, raw_analysis),
      trade_comments(content)
    `)
    .eq("id", tradeId)
    .maybeSingle();
  if (!trade) return null;

  const t: any = trade;
  const reviews: any[] = Array.isArray(t.trade_reviews) ? t.trade_reviews : t.trade_reviews ? [t.trade_reviews] : [];
  const ai: any[] = Array.isArray(t.ai_reviews) ? t.ai_reviews : t.ai_reviews ? [t.ai_reviews] : [];
  const comments: any[] = Array.isArray(t.trade_comments) ? t.trade_comments : [];

  const jsonProse = (v: unknown): string => {
    if (!v) return "";
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return v.map((x) => jsonProse(x)).filter(Boolean).join(" | ");
    if (typeof v === "object") {
      return Object.entries(v as Record<string, unknown>)
        .map(([k, val]) => {
          const s = jsonProse(val);
          return s ? `${k}: ${s}` : "";
        })
        .filter(Boolean).join("; ");
    }
    return String(v);
  };

  const proseParts: string[] = [];
  for (const r of reviews) {
    if (r.mistakes) proseParts.push(`mistakes: ${jsonProse(r.mistakes)}`);
    if (r.did_well) proseParts.push(`did well: ${jsonProse(r.did_well)}`);
    if (r.to_improve) proseParts.push(`to improve: ${jsonProse(r.to_improve)}`);
    if (r.actionable_steps) proseParts.push(`actions: ${jsonProse(r.actionable_steps)}`);
    if (r.thoughts) proseParts.push(`thoughts: ${r.thoughts}`);
    if (r.psychology_notes) proseParts.push(`psychology: ${r.psychology_notes}`);
    if (r.emotional_state_before) proseParts.push(`felt before: ${r.emotional_state_before}`);
    if (r.emotional_state_after) proseParts.push(`felt after: ${r.emotional_state_after}`);
    if (r.regime) proseParts.push(`regime: ${r.regime}`);
    if (r.news_risk && r.news_risk !== "none") proseParts.push(`news risk: ${r.news_risk}`);
  }
  for (const a of ai) {
    const bits = [
      jsonProse(a.technical_review),
      jsonProse(a.mistake_attribution),
      jsonProse(a.psychology_analysis),
      jsonProse(a.actionable_guidance),
    ].filter(Boolean);
    if (bits.length) proseParts.push(`ai review: ${bits.join(" ")}`);
    else if (a.raw_analysis) proseParts.push(`ai review: ${String(a.raw_analysis).slice(0, 1500)}`);
  }
  for (const c of comments) if (c.content) proseParts.push(`comment: ${c.content}`);

  if (proseParts.length === 0) return null;

  const r = t.r_multiple_actual ?? t.r_multiple_planned;
  const netPnl = t.net_pnl == null ? null : Number(t.net_pnl);
  const header = [
    t.symbol,
    t.direction,
    netPnl == null ? "unknown" : netPnl > 0 ? "win" : netPnl < 0 ? "loss" : "breakeven",
    r != null ? `${Number(r).toFixed(2)}R` : null,
    t.session ? `session: ${t.session}` : null,
    t.entry_time ? new Date(t.entry_time).toISOString().slice(0, 10) : null,
    t.playbook?.name ? `playbook: ${t.playbook.name}` : null,
  ].filter(Boolean).join(" | ");

  const content = [header, ...proseParts].join("\n");
  const preview = content.slice(0, 240);
  return { content, preview };
}

async function embedText(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Embedding failed ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  const vec = json?.data?.[0]?.embedding;
  if (!Array.isArray(vec) || vec.length !== EMBED_DIMS) {
    throw new Error(`Unexpected embedding shape (len=${vec?.length})`);
  }
  return vec;
}

/** Embed a single trade if content changed. Returns 'embedded' | 'skipped' | 'no-content'. */
export async function embedTradeIfNeeded(
  admin: SupabaseClient,
  tradeId: string,
  userId: string,
  apiKey: string,
): Promise<"embedded" | "skipped" | "no-content"> {
  const built = await buildTradeContent(admin, tradeId);
  if (!built) {
    // Remove any stale embedding row so recall doesn't return empty prose.
    await admin.from("trade_embeddings").delete().eq("trade_id", tradeId);
    return "no-content";
  }
  const hash = await sha256(built.content);

  const { data: existing } = await admin
    .from("trade_embeddings")
    .select("content_hash")
    .eq("trade_id", tradeId)
    .maybeSingle();
  if (existing?.content_hash === hash) return "skipped";

  const embedding = await embedText(built.content, apiKey);

  const { error } = await admin.from("trade_embeddings").upsert({
    trade_id: tradeId,
    user_id: userId,
    content_hash: hash,
    content_preview: built.preview,
    embedding: embedding as any,
    model_version: EMBED_MODEL,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Upsert embedding failed: ${error.message}`);
  return "embedded";
}

/** Embed an ad-hoc query string (used for recall RPC). */
export async function embedQuery(text: string, apiKey: string): Promise<number[]> {
  return embedText(text, apiKey);
}

export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}
