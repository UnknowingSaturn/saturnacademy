// Per-entry chat: answer follow-up questions grounded in the saved article.
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY is not configured" }, 500);

    const auth = req.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return json({ error: "Auth required" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Auth required" }, 401);

    const { entry_id, messages } = await req.json();
    if (!entry_id || !Array.isArray(messages) || messages.length === 0) {
      return json({ error: "entry_id and non-empty messages required" }, 400);
    }
    const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
    if (!lastUserMsg?.content) return json({ error: "No user message" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: entry } = await admin
      .from("knowledge_entries").select("*").eq("id", entry_id).maybeSingle();
    if (!entry) return json({ error: "Entry not found" }, 404);
    if (entry.user_id !== user.id) return json({ error: "Forbidden" }, 403);
    if (entry.status !== "ready") return json({ error: "Entry is still being extracted" }, 409);

    const takeaways = Array.isArray(entry.key_takeaways) ? entry.key_takeaways.join("\n- ") : "";
    const concepts = Array.isArray(entry.concepts)
      ? entry.concepts.map((c: any) => `${c.label}: ${c.definition}`).join("\n")
      : "";
    const sysPrompt = [
      `You are a trading study companion answering questions about a single article the user saved.`,
      `Article title: ${entry.source_title}`,
      `Source URL: ${entry.source_url}`,
      `Summary: ${entry.summary || "(none)"}`,
      `Key takeaways:\n- ${takeaways}`,
      `Concepts:\n${concepts}`,
      `Full body (truncated):\n${(entry.raw_markdown || "").slice(0, 18000)}`,
      ``,
      `Rules:`,
      `- Only answer using info in the article. If the user asks something it doesn't cover, say so honestly.`,
      `- Cite specific takeaways or concepts inline when relevant.`,
      `- Be concise — 3-6 sentences unless the user asks for depth.`,
      `- No generic trading platitudes ("stay disciplined", "trust the process", etc.).`,
    ].join("\n");

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: sysPrompt },
          ...messages.map((m: any) => ({ role: m.role, content: m.content })),
        ],
      }),
    });
    if (!aiRes.ok) {
      if (aiRes.status === 429) return json({ error: "Rate limit, try again in a minute." }, 429);
      if (aiRes.status === 402) return json({ error: "AI credits exhausted. Add credits in Settings." }, 402);
      const t = await aiRes.text();
      return json({ error: `AI error ${aiRes.status}: ${t.slice(0, 200)}` }, 500);
    }
    const aiJson = await aiRes.json();
    const reply = aiJson.choices?.[0]?.message?.content || "(no reply)";

    // Persist both the latest user message and the assistant reply
    await admin.from("knowledge_chat_messages").insert([
      { knowledge_entry_id: entry_id, user_id: user.id, role: "user", content: lastUserMsg.content },
      { knowledge_entry_id: entry_id, user_id: user.id, role: "assistant", content: reply },
    ]);

    return json({ reply });
  } catch (e) {
    console.error("knowledge-chat error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
