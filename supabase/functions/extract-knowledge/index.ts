// Scrape a URL with Firecrawl, extract a detailed trading-knowledge report with
// Lovable AI, and persist images (with grounded descriptions) to storage.
// Idempotent: re-runs overwrite the entry.
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

    // 1. Firecrawl scrape (drop summary format — we'll generate our own detailed report)
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
          formats: ["markdown"],
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

    // Firecrawl v2: { success, data: { markdown, metadata: { title, author, publishedTime, ... } } }
    const data = firecrawlData?.data || firecrawlData;
    const markdown: string = data?.markdown || "";
    const metadata = data?.metadata || {};
    const title = metadata.title || metadata.ogTitle || url;
    const author = metadata.author || metadata.ogAuthor || null;
    const publishedTimeRaw = metadata.publishedTime || metadata.publishDate || null;
    const publishedDate = publishedTimeRaw ? safeDate(publishedTimeRaw) : null;

    // 2. Extract image URLs from markdown WITH surrounding context
    const imgRe = /!\[([^\]]*)\]\(([^)\s]+)/g;
    const imageEntries: Array<{ url: string; alt: string; nearby_text: string }> = [];
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = imgRe.exec(markdown)) !== null) {
      const u = m[2];
      if (!u || seen.has(u)) continue;
      if (!/^https?:\/\//i.test(u)) continue;
      if (/avatar|favicon|emoji|logo|icon|profile|spinner/i.test(u)) continue;
      seen.add(u);
      // Grab ~500 chars before and ~500 after, then strip image markdown noise
      const start = Math.max(0, m.index - 500);
      const end = Math.min(markdown.length, m.index + m[0].length + 500);
      const raw = markdown.slice(start, end);
      const cleaned = raw
        .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")     // remove images
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")    // unwrap links
        .replace(/[#>*_`~]+/g, " ")                  // strip md punctuation
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 800);
      imageEntries.push({ url: u, alt: m[1] || "", nearby_text: cleaned });
      if (imageEntries.length >= 12) break;
    }

    // 3. Download + upload images to storage (preserving order/index)
    const screenshots: Array<{
      url: string; caption: string; source_url: string;
      description: string; nearby_text: string;
    }> = [];
    for (const { url: imgUrl, alt, nearby_text } of imageEntries) {
      try {
        const r = await fetch(imgUrl);
        if (!r.ok) continue;
        const ct = r.headers.get("content-type") || "image/png";
        if (!ct.startsWith("image/")) continue;
        const buf = new Uint8Array(await r.arrayBuffer());
        if (buf.byteLength < 5000) continue;
        const ext = ct.split("/")[1]?.split(";")[0] || "png";
        const path = `knowledge/${user.id}/${entry_id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await admin.storage
          .from("trade-screenshots")
          .upload(path, buf, { contentType: ct, upsert: false });
        if (upErr) continue;
        const { data: pub } = admin.storage.from("trade-screenshots").getPublicUrl(path);
        screenshots.push({
          url: pub.publicUrl,
          caption: alt,
          source_url: imgUrl,
          description: "", // filled in by AI below
          nearby_text,
        });
      } catch { /* skip failed image */ }
    }

    // 4. Lovable AI structured extraction — INLINE ARTICLE with image placeholders
    // Build a markdown source where each successfully-uploaded image is replaced
    // with a stable {{IMG:N}} token (in the order they were uploaded). This
    // lets the AI faithfully re-flow the article while preserving image
    // positions, instead of generating a separate "report".
    let mdWithTokens = markdown;
    screenshots.forEach((s, i) => {
      // Replace the first occurrence of the source image URL in the markdown
      // with a placeholder on its own line.
      const escUrl = s.source_url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`!\\[[^\\]]*\\]\\(${escUrl}[^)]*\\)`);
      mdWithTokens = mdWithTokens.replace(re, `\n\n{{IMG:${i}}}\n\n`);
    });
    const truncatedMd = mdWithTokens.slice(0, 30000);

    const screenshotContext = screenshots.length
      ? screenshots.map((s, i) =>
          `Image #${i} (alt="${s.caption || "(none)"}")\nSurrounding text: ${s.nearby_text || "(no nearby text captured)"}`
        ).join("\n\n")
      : "(no images in article)";

    let aiData: any = null;
    try {
      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            {
              role: "system",
              content: [
                "You are a faithful article re-formatter for trading content.",
                "You are given the article's source markdown with image placeholders like {{IMG:0}}, {{IMG:1}} inserted where each image originally appeared.",
                "Your job is to return a CLEANED version of that same article in markdown — preserving the original structure, headings, numbered sections, paragraphs, lists, and the EXACT POSITION of every {{IMG:N}} placeholder relative to the surrounding text.",
                "Rules:",
                "- DO NOT summarize, condense, paraphrase aggressively, or reorder content. Keep paragraphs as full paragraphs.",
                "- DO NOT invent any text. If something isn't in the source, omit it.",
                "- Strip site chrome only: subscribe boxes, share/like buttons, footer nav, author bios, 'Read more', cookie banners, comment sections, related-post lists.",
                "- Keep every {{IMG:N}} token on its own line, in its original position. Do not remove, duplicate, or reorder them.",
                "- Use clean markdown: H2/H3 for sections, blank lines between paragraphs, `1.` `2.` for numbered lists, `-` for bullets, blockquotes for quoted material.",
                "- Light copy-edit only (fix obvious OCR-style artifacts, broken whitespace). Preserve the author's voice and wording.",
                "Also write a 1–3 sentence description for each image based ONLY on the article text immediately around it.",
              ].join("\n"),
            },
            {
              role: "user",
              content:
                `Title: ${title}\nURL: ${url}\n\n` +
                `=== ARTICLE MARKDOWN (with {{IMG:N}} placeholders) ===\n${truncatedMd}\n\n` +
                `=== IMAGES TO DESCRIBE ===\n${screenshotContext}\n\n` +
                `Return the cleaned article and per-image descriptions.`,
            },
          ],
          tools: [{
            type: "function",
            function: {
              name: "save_knowledge",
              description: "Save the cleaned inline article and metadata",
              parameters: {
                type: "object",
                properties: {
                  article_markdown: {
                    type: "string",
                    description:
                      "The cleaned full article in markdown. Must preserve original structure (headings, numbered sections, paragraphs, lists) AND include every {{IMG:N}} placeholder in its original position on its own line. Do NOT summarize or rewrite — just clean and re-flow.",
                  },
                  tldr: {
                    type: "string",
                    description: "A 2-3 sentence plain-English overview of what the article is about. Shown above the article as context.",
                  },
                  key_takeaways: {
                    type: "array",
                    items: { type: "string" },
                    description: "5-8 actionable lessons a trader can apply",
                  },
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
                  tags: {
                    type: "array",
                    items: { type: "string" },
                    description: "4-8 lowercase topical tags (e.g. 'volume profile', 'imbalance', 'NAS100')",
                  },
                  screenshot_descriptions: {
                    type: "array",
                    description: "One entry per image, in the same order as provided. Each describes what the image illustrates based on the article's surrounding text.",
                    items: {
                      type: "object",
                      properties: {
                        index: { type: "integer", description: "0-based image index from the input" },
                        description: { type: "string", description: "1-3 sentence description grounded in the article text near this image" },
                      },
                      required: ["index", "description"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["article_markdown", "tldr", "key_takeaways", "concepts", "tags", "screenshot_descriptions"],
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
        screenshots, raw_markdown: truncatedMd,
      }).eq("id", entry_id);
      return json({ error: msg }, 200);
    }

    // 5. Merge AI image descriptions into screenshots by index
    const descByIdx = new Map<number, string>();
    for (const item of (aiData?.screenshot_descriptions || []) as Array<{ index: number; description: string }>) {
      if (typeof item?.index === "number" && typeof item?.description === "string") {
        descByIdx.set(item.index, item.description.trim());
      }
    }
    const enrichedScreenshots = screenshots.map((s, i) => ({
      ...s,
      description: descByIdx.get(i) || "",
    }));

    // 6. Persist. The cleaned inline article (with {{IMG:N}} placeholders) is
    //    stored in `summary`. Optional TL;DR is prepended as a blockquote so
    //    the existing single-column renderer can show both without schema changes.
    const article = (aiData?.article_markdown || "").trim();
    const tldr = (aiData?.tldr || "").trim();
    const combined = tldr
      ? `> **TL;DR** — ${tldr}\n\n${article}`
      : article || null;

    await admin.from("knowledge_entries").update({
      status: "ready",
      error_message: null,
      source_title: title,
      source_author: author,
      source_published_at: publishedDate,
      summary: combined,
      key_takeaways: aiData?.key_takeaways || [],
      concepts: aiData?.concepts || [],
      tags: aiData?.tags || [],
      screenshots: enrichedScreenshots,
      raw_markdown: markdown.slice(0, 30000),
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
