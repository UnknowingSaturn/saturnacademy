// Scrape a URL with Firecrawl, extract structured trading knowledge with Lovable AI,
// and persist images to storage. Idempotent: re-runs overwrite the entry.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY is not configured" }, 500);
    if (!FIRECRAWL_API_KEY) return json({ error: "FIRECRAWL_API_KEY is not configured" }, 500);

    // Auth: must be a logged-in user
    const auth = req.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return json({ error: "Auth required" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Auth required" }, 401);

    const { entry_id } = await req.json();
    if (!entry_id || typeof entry_id !== "string") return json({ error: "entry_id required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Load entry & verify ownership
    const { data: entry, error: eErr } = await admin
      .from("knowledge_entries").select("*").eq("id", entry_id).maybeSingle();
    if (eErr || !entry) return json({ error: "Entry not found" }, 404);
    if (entry.user_id !== user.id) return json({ error: "Forbidden" }, 403);

    const url: string = entry.source_url;

    // Reset to extracting state for re-runs
    await admin.from("knowledge_entries").update({
      status: "extracting", error_message: null, updated_at: new Date().toISOString(),
    }).eq("id", entry_id);

    // 1. Firecrawl scrape
    let firecrawlData: any;
    try {
      const fc = await fetch("https://api.firecrawl.dev/v2/scrape", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${FIRECRAWL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url,
          formats: ["markdown", "summary"],
          onlyMainContent: true,
        }),
      });
      if (!fc.ok) {
        const txt = await fc.text();
        if (fc.status === 402) throw new Error("Firecrawl credits exhausted. Add credits or use a different connection.");
        throw new Error(`Firecrawl error ${fc.status}: ${txt.slice(0, 200)}`);
      }
      firecrawlData = await fc.json();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await admin.from("knowledge_entries").update({
        status: "failed", error_message: `Scrape failed: ${msg}`,
      }).eq("id", entry_id);
      return json({ error: msg }, 200);
    }

    // Firecrawl v2 returns: { success, data: { markdown, summary, metadata: { title, author, publishedTime, ogImage }, links, images? } }
    const data = firecrawlData?.data || firecrawlData;
    const markdown: string = data?.markdown || "";
    const summary: string = data?.summary || "";
    const metadata = data?.metadata || {};
    const title = metadata.title || metadata.ogTitle || url;
    const author = metadata.author || metadata.ogAuthor || null;
    const publishedTimeRaw = metadata.publishedTime || metadata.publishDate || null;
    const publishedDate = publishedTimeRaw ? safeDate(publishedTimeRaw) : null;

    // 2. Extract image URLs from markdown
    const imgMatches = Array.from(markdown.matchAll(/!\[([^\]]*)\]\(([^)\s]+)/g));
    const imageUrls: Array<{ url: string; alt: string }> = [];
    const seen = new Set<string>();
    for (const m of imgMatches) {
      const u = m[2];
      if (!u || seen.has(u)) continue;
      if (!/^https?:\/\//i.test(u)) continue;
      // Skip tiny/likely-icon images by URL hint
      if (/avatar|favicon|emoji|logo|icon|profile|spinner/i.test(u)) continue;
      seen.add(u);
      imageUrls.push({ url: u, alt: m[1] || "" });
      if (imageUrls.length >= 12) break;
    }

    // 3. Download + upload images to storage
    const screenshots: Array<{ url: string; caption: string; source_url: string }> = [];
    for (const { url: imgUrl, alt } of imageUrls) {
      try {
        const r = await fetch(imgUrl);
        if (!r.ok) continue;
        const ct = r.headers.get("content-type") || "image/png";
        if (!ct.startsWith("image/")) continue;
        const buf = new Uint8Array(await r.arrayBuffer());
        if (buf.byteLength < 5000) continue; // skip <5kb (likely icon)
        const ext = ct.split("/")[1]?.split(";")[0] || "png";
        const path = `knowledge/${user.id}/${entry_id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await admin.storage
          .from("trade-screenshots")
          .upload(path, buf, { contentType: ct, upsert: false });
        if (upErr) continue;
        const { data: pub } = admin.storage.from("trade-screenshots").getPublicUrl(path);
        screenshots.push({ url: pub.publicUrl, caption: alt, source_url: imgUrl });
      } catch { /* skip failed image */ }
    }

    // 4. Lovable AI structured extraction (tool-calling)
    const truncatedMd = markdown.slice(0, 30000);
    let aiData: any = null;
    try {
      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: "You are a precise trading-knowledge extractor. From the article, extract ONLY what is explicitly stated. Never invent. If a section has no content, return an empty array." },
            { role: "user", content: `Title: ${title}\nURL: ${url}\n\nArticle:\n${truncatedMd}\n\nExtract the trading knowledge.` },
          ],
          tools: [{
            type: "function",
            function: {
              name: "save_knowledge",
              description: "Save extracted trading knowledge",
              parameters: {
                type: "object",
                properties: {
                  summary: { type: "string", description: "2-3 sentence summary of the article's core trading idea" },
                  key_takeaways: { type: "array", items: { type: "string" }, description: "5-8 actionable lessons a trader can apply" },
                  concepts: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        label: { type: "string" },
                        definition: { type: "string" },
                      },
                      required: ["label", "definition"],
                      additionalProperties: false,
                    },
                    description: "3-6 named trading concepts with concise definitions",
                  },
                  tags: { type: "array", items: { type: "string" }, description: "4-8 lowercase topical tags (e.g. 'volume profile', 'imbalance', 'NAS100')" },
                },
                required: ["summary", "key_takeaways", "concepts", "tags"],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "save_knowledge" } },
        }),
      });
      if (!aiRes.ok) {
        if (aiRes.status === 429) throw new Error("AI rate limit hit. Try again in a minute.");
        if (aiRes.status === 402) throw new Error("AI credits exhausted. Add credits in Settings → Workspace → Usage.");
        const t = await aiRes.text();
        throw new Error(`AI error ${aiRes.status}: ${t.slice(0, 200)}`);
      }
      const aiJson = await aiRes.json();
      const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall?.function?.arguments) {
        aiData = JSON.parse(toolCall.function.arguments);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await admin.from("knowledge_entries").update({
        status: "failed", error_message: `AI extraction failed: ${msg}`,
        source_title: title, source_author: author, source_published_at: publishedDate,
        summary: summary || null, screenshots, raw_markdown: truncatedMd,
      }).eq("id", entry_id);
      return json({ error: msg }, 200);
    }

    // 5. Persist
    await admin.from("knowledge_entries").update({
      status: "ready",
      error_message: null,
      source_title: title,
      source_author: author,
      source_published_at: publishedDate,
      summary: aiData?.summary || summary || null,
      key_takeaways: aiData?.key_takeaways || [],
      concepts: aiData?.concepts || [],
      tags: aiData?.tags || [],
      screenshots,
      raw_markdown: truncatedMd,
      updated_at: new Date().toISOString(),
    }).eq("id", entry_id);

    return json({ ok: true });
  } catch (e) {
    console.error("extract-knowledge error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function safeDate(s: string): string | null {
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch { return null; }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
