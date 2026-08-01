// Shared embedding helper for the Trading Coach.
// Embeds at NOTE granularity: every row of public.journal_notes (review prose,
// screenshot captions, comments, AI review sections) becomes its own vector so
// short chart captions aren't diluted inside a whole-trade blob.
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

export interface JournalNote {
  note_key: string;
  trade_id: string;
  user_id: string;
  source: string;
  field: string;
  label: string | null;
  body: string;
  occurred_at: string | null;
}

/** Short trade header prefixed to every note so a vector carries its context. */
async function tradeHeader(admin: SupabaseClient, tradeId: string): Promise<string> {
  const { data } = await admin
    .from("trades")
    .select("symbol, direction, net_pnl, r_multiple_actual, r_multiple_planned, entry_time, session, playbook:playbooks!trades_playbook_id_fkey(name)")
    .eq("id", tradeId)
    .maybeSingle();
  if (!data) return "";
  const t = data as any;
  const r = t.r_multiple_actual ?? t.r_multiple_planned;
  const netPnl = t.net_pnl == null ? null : Number(t.net_pnl);
  return [
    t.symbol,
    t.direction,
    netPnl == null ? "unknown" : netPnl > 0 ? "win" : netPnl < 0 ? "loss" : "breakeven",
    r != null ? `${Number(r).toFixed(2)}R` : null,
    t.session ? `session: ${t.session}` : null,
    t.entry_time ? new Date(t.entry_time).toISOString().slice(0, 10) : null,
    t.playbook?.name ? `playbook: ${t.playbook.name}` : null,
  ].filter(Boolean).join(" | ");
}

function noteText(header: string, note: JournalNote): string {
  const tag = [note.source, note.field, note.label].filter(Boolean).join(" / ");
  return [header, `${tag}: ${note.body}`].filter(Boolean).join("\n");
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

/** Embed every note of a trade whose text changed. Returns counts. */
export async function embedTradeIfNeeded(
  admin: SupabaseClient,
  tradeId: string,
  userId: string,
  apiKey: string,
): Promise<"embedded" | "skipped" | "no-content"> {
  const { data: notes, error } = await admin
    .from("journal_notes")
    .select("note_key, trade_id, user_id, source, field, label, body, occurred_at")
    .eq("trade_id", tradeId);
  if (error) throw new Error(`journal_notes read failed: ${error.message}`);

  const rows = (notes ?? []) as JournalNote[];
  const keys = rows.map((n) => n.note_key);

  // Drop vectors for notes that no longer exist (edited/deleted prose).
  const { data: existingRows } = await admin
    .from("note_embeddings")
    .select("note_key, content_hash")
    .eq("trade_id", tradeId);
  const existing = new Map((existingRows ?? []).map((r: any) => [r.note_key, r.content_hash]));
  const stale = [...existing.keys()].filter((k) => !keys.includes(k));
  if (stale.length) {
    await admin.from("note_embeddings").delete().in("note_key", stale);
  }

  if (rows.length === 0) return "no-content";

  const header = await tradeHeader(admin, tradeId);
  let embedded = 0;

  for (const note of rows) {
    const content = noteText(header, note);
    const hash = await sha256(`${EMBED_MODEL}:${content}`);
    if (existing.get(note.note_key) === hash) continue;

    const embedding = await embedText(content, apiKey);
    const { error: upErr } = await admin.from("note_embeddings").upsert({
      note_key: note.note_key,
      trade_id: tradeId,
      user_id: userId,
      source: note.source,
      field: note.field,
      label: note.label,
      content_hash: hash,
      content_preview: content.slice(0, 240),
      embedding: embedding as any,
      model_version: EMBED_MODEL,
      updated_at: new Date().toISOString(),
    });
    if (upErr) throw new Error(`Upsert note embedding failed: ${upErr.message}`);
    embedded++;
  }

  return embedded > 0 ? "embedded" : "skipped";
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
