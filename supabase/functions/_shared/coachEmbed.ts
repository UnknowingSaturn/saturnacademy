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
  const { data: trade } = await admin
    .from("trades")
    .select(`
      id, symbol, direction, outcome, r_multiple, net_pnl, entry_time, exit_time,
      thoughts, mistakes, notes,
      playbook:playbooks!trades_playbook_id_fkey(name),
      trade_reviews(mistakes, did_well, to_improve, notes, psychology_notes, general_notes, thoughts),
      ai_reviews(summary, strengths, weaknesses, recommendations),
      trade_comments(body)
    `)
    .eq("id", tradeId)
    .maybeSingle();
  if (!trade) return null;

  const t: any = trade;
  const reviews: any[] = Array.isArray(t.trade_reviews) ? t.trade_reviews : t.trade_reviews ? [t.trade_reviews] : [];
  const ai: any[] = Array.isArray(t.ai_reviews) ? t.ai_reviews : t.ai_reviews ? [t.ai_reviews] : [];
  const comments: any[] = Array.isArray(t.trade_comments) ? t.trade_comments : [];

  const proseParts: string[] = [];
  if (t.thoughts) proseParts.push(`thoughts: ${t.thoughts}`);
  if (t.notes) proseParts.push(`notes: ${t.notes}`);
  if (t.mistakes) proseParts.push(`mistakes: ${joinArr(t.mistakes)}`);
  for (const r of reviews) {
    if (r.mistakes?.length) proseParts.push(`review mistakes: ${joinArr(r.mistakes)}`);
    if (r.did_well?.length) proseParts.push(`review did well: ${joinArr(r.did_well)}`);
    if (r.to_improve?.length) proseParts.push(`review to improve: ${joinArr(r.to_improve)}`);
    if (r.psychology_notes) proseParts.push(`psychology: ${r.psychology_notes}`);
    if (r.general_notes) proseParts.push(`review notes: ${r.general_notes}`);
    if (r.thoughts) proseParts.push(`review thoughts: ${r.thoughts}`);
    if (r.notes) proseParts.push(`review body: ${r.notes}`);
  }
  for (const a of ai) {
    if (a.summary) proseParts.push(`ai summary: ${a.summary}`);
    if (a.strengths) proseParts.push(`ai strengths: ${joinArr(a.strengths)}`);
    if (a.weaknesses) proseParts.push(`ai weaknesses: ${joinArr(a.weaknesses)}`);
    if (a.recommendations) proseParts.push(`ai recs: ${joinArr(a.recommendations)}`);
  }
  for (const c of comments) if (c.body) proseParts.push(`comment: ${c.body}`);

  if (proseParts.length === 0) return null;

  const header = [
    t.symbol,
    t.direction,
    t.outcome ?? "unknown",
    t.r_multiple != null ? `${Number(t.r_multiple).toFixed(2)}R` : null,
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
