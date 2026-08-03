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
  getStats: { groupBy: "playbook" },
  getOpenTrades: {},
  searchJournal: { query: "HVN", k: 5 },
  analyzeCohort: { query: "HVN" },
  simulateChallenge: {
    accountSize: 50000, numAccounts: 5, riskPerTrade: 300,
    targetAmount: 3000, maxLossAmount: 2000, rotationModel: "stay_on_winner",
  },
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
    const res = await executeTool(name, ARGS[name] ?? {}, ctx);
    if (!res.ok) failures.push(`${name}: ${res.error}`);
  }
  assert(failures.length === 0, `Broken coach tools:\n${failures.join("\n")}`);
});

Deno.test("journal_notes exposes screenshot captions with their timeframe", async () => {
  if (!url || !key) return;
  const admin = createClient(url, key);
  const { data, error } = await admin
    .from("journal_notes").select("note_key, source, label, body").eq("source", "screenshot").limit(5);
  assert(!error, `journal_notes read failed: ${error?.message}`);
  assert((data ?? []).length > 0, "no screenshot notes surfaced — the view or the JSON shape drifted");
});

Deno.test("searchJournal finds a phrase that exists in a real note", async () => {
  if (!url || !key) return;
  const admin = createClient(url, key);
  const { data: note } = await admin
    .from("journal_notes").select("user_id, trade_id, body").limit(1).maybeSingle();
  if (!note) return;
  const phrase = String((note as any).body).split(/\s+/).slice(0, 4).join(" ");
  const ctx: ToolExecCtx = { admin, userId: (note as any).user_id, lovableApiKey: apiKey };
  const res = await executeTool("searchJournal", { query: phrase, k: 20 }, ctx);
  assert(res.ok, `searchJournal failed: ${res.error}`);
  const ids: string[] = ((res.data as any)?.trade_ids ?? []);
  assert(ids.includes((note as any).trade_id), `phrase "${phrase}" did not retrieve its own note`);
});

Deno.test("analyzeCohort n matches the closed trades among the ids passed in", async () => {
  if (!url || !key) return;
  const admin = createClient(url, key);
  const { data: trades } = await admin
    .from("trades")
    .select("id, user_id")
    .eq("is_open", false).not("net_pnl", "is", null).eq("trade_type", "executed")
    .limit(7);
  if (!trades || trades.length === 0) return;
  const userId = (trades[0] as any).user_id;
  const ids = (trades as any[]).filter((t) => t.user_id === userId).map((t) => t.id);
  const ctx: ToolExecCtx = { admin, userId, lovableApiKey: apiKey };
  const res = await executeTool("analyzeCohort", { trade_ids: ids }, ctx);
  assert(res.ok, `analyzeCohort failed: ${res.error}`);
  assert((res.data as any).stats.n === ids.length, "cohort n disagrees with the ids passed in");
});

Deno.test("getStats never hides the raw tier and emits quotable facts", async () => {
  if (!url || !key) return;
  const admin = createClient(url, key);
  const { data: t } = await admin
    .from("trades").select("user_id").eq("is_open", false).limit(1).maybeSingle();
  if (!t) return;
  const ctx: ToolExecCtx = { admin, userId: (t as any).user_id, lovableApiKey: apiKey };
  const res = await executeTool("getStats", { groupBy: "playbook" }, ctx);
  assert(res.ok, `getStats failed: ${res.error}`);
  const d = res.data as any;
  assert(d.coverage && typeof d.coverage === "object", "coverage missing — the raw tier can be hidden again");
  assert(Array.isArray(d.facts) && d.facts.length >= 2, "facts[] missing — the model would compute its own numbers");
  assert(String(d.facts[1].text).startsWith("coverage by tier"), "tier coverage is not a quotable fact");
});
