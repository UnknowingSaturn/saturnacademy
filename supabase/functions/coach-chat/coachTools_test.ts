// Smoke test: every Coach tool must execute against the real schema.
// This is the guard that would have caught the original bug — the tools were
// selecting columns (`trades.outcome`, `trades.r_multiple`, `playbooks.archived`,
// `trade_comments.body`, `ai_reviews.summary`) that do not exist, so every call
// returned ok:false and the model answered from nothing.
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { COACH_TOOL_NAMES, executeTool, type ToolExecCtx } from "../_shared/coachTools.ts";

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const apiKey = Deno.env.get("LOVABLE_API_KEY") ?? "";

const ARGS: Record<string, unknown> = {
  getUserContext: {},
  searchTrades: { limit: 5 },
  getTradeDetail: {}, // filled from a real trade below
  getRecentPerformance: { days: 90 },
  getPlaybookStats: {},
  getBreakdown: { dimension: "session" },
  getOpenTrades: {},
  recallSimilarTrades: { query: "trades where I entered late", k: 3 },
};

Deno.test("every coach tool runs against the live schema", async () => {
  if (!url || !key) {
    console.warn("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — skipping");
    return;
  }
  const admin = createClient(url, key);

  const { data: anyTrade } = await admin
    .from("trades").select("id, user_id").order("entry_time", { ascending: false }).limit(1).maybeSingle();
  if (!anyTrade) {
    console.warn("no trades in DB — skipping");
    return;
  }
  const ctx: ToolExecCtx = { admin, userId: (anyTrade as any).user_id, lovableApiKey: apiKey };
  ARGS.getTradeDetail = { trade_id: (anyTrade as any).id };

  const failures: string[] = [];
  for (const name of COACH_TOOL_NAMES) {
    // recall needs the AI gateway; skip only when no key is configured.
    if (name === "recallSimilarTrades" && !apiKey) continue;
    const res = await executeTool(name, ARGS[name] ?? {}, ctx);
    if (!res.ok) failures.push(`${name}: ${res.error}`);
  }
  assert(failures.length === 0, `Broken coach tools:\n${failures.join("\n")}`);
});
