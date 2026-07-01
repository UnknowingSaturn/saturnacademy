// Tool definitions + executors for the Trading Coach.
// Each tool receives an admin client already scoped to a user_id at the caller
// (we always filter by user_id inside the tool — never trust the model's args).
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { embedQuery } from "./coachEmbed.ts";

export interface ToolExecCtx {
  admin: SupabaseClient;
  userId: string;
  lovableApiKey: string;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

// ---------- Public JSON schema (OpenAI function-calling shape) ----------
export const COACH_TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "getUserContext",
      description:
        "Get the user's timezone, base currency, session definitions, and playbook names. Call this FIRST if you need to reason about time-of-day, currency, or reference a playbook by name.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "searchTrades",
      description:
        "Filter closed trades by structured criteria. Returns up to 25 compact rows (id, date, symbol, side, outcome, R, session, playbook). Use for numeric/factual queries; use recallSimilarTrades for fuzzy prose queries.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Exact symbol match, e.g. GBPUSD" },
          side: { type: "string", enum: ["long", "short"] },
          outcome: { type: "string", enum: ["win", "loss", "breakeven"] },
          dateFrom: { type: "string", description: "ISO date (YYYY-MM-DD)" },
          dateTo: { type: "string", description: "ISO date (YYYY-MM-DD)" },
          playbookName: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 25, default: 25 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getTradeDetail",
      description: "Full detail for one trade including modifications, reviews, comments, and screenshot URLs.",
      parameters: {
        type: "object",
        properties: { trade_id: { type: "string" } },
        required: ["trade_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getRecentPerformance",
      description:
        "Rollup of closed trades over the last N days: count, win rate, expectancy (mean R), gross R, best/worst R, top symbols.",
      parameters: {
        type: "object",
        properties: { days: { type: "integer", minimum: 1, maximum: 365, default: 30 } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getPlaybookStats",
      description: "Aggregate stats grouped by playbook: sample size, win rate, expectancy, best/worst R.",
      parameters: {
        type: "object",
        properties: { playbookName: { type: "string", description: "Optional filter to one playbook." } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recallSimilarTrades",
      description:
        "Semantic recall over the user's journal prose (reviews, mistakes, psychology notes). Use for fuzzy questions like 'when I felt FOMO' or 'trades I entered late'. Returns top-K trade previews with similarity scores.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural-language description of the pattern to find." },
          k: { type: "integer", minimum: 1, maximum: 10, default: 5 },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
] as const;

// ---------- Executors ----------

async function tool_getUserContext(ctx: ToolExecCtx): Promise<ToolResult> {
  const { data: profile } = await ctx.admin
    .from("profiles")
    .select("display_name, email")
    .eq("id", ctx.userId)
    .maybeSingle();
  const { data: settings } = await ctx.admin
    .from("user_settings")
    .select("*")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  const { data: sessions } = await ctx.admin
    .from("session_definitions")
    .select("name, start_hour, end_hour, timezone, days")
    .eq("user_id", ctx.userId);
  const { data: playbooks } = await ctx.admin
    .from("playbooks")
    .select("name, description")
    .eq("user_id", ctx.userId)
    .eq("archived", false)
    .limit(50);
  const { count: tradeCount } = await ctx.admin
    .from("trades")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ctx.userId);

  return {
    ok: true,
    data: {
      profile,
      timezone: (settings as any)?.timezone ?? "America/New_York",
      base_currency: (settings as any)?.base_currency ?? "USD",
      sessions: sessions ?? [],
      playbooks: playbooks ?? [],
      total_trades: tradeCount ?? 0,
    },
  };
}

async function tool_searchTrades(ctx: ToolExecCtx, args: any): Promise<ToolResult> {
  const limit = Math.min(Math.max(Number(args.limit ?? 25), 1), 25);
  let q = ctx.admin
    .from("trades")
    .select(
      "id, symbol, direction, outcome, r_multiple, net_pnl, entry_time, exit_time, session, playbook:playbooks!trades_playbook_id_fkey(name)",
    )
    .eq("user_id", ctx.userId)
    .eq("is_open", false)
    .order("entry_time", { ascending: false })
    .limit(limit);
  if (args.symbol) q = q.ilike("symbol", args.symbol);
  if (args.side) q = q.eq("direction", args.side);
  if (args.outcome) q = q.eq("outcome", args.outcome);
  if (args.dateFrom) q = q.gte("entry_time", args.dateFrom);
  if (args.dateTo) q = q.lte("entry_time", `${args.dateTo}T23:59:59Z`);
  if (args.playbookName) {
    const { data: pb } = await ctx.admin
      .from("playbooks").select("id").eq("user_id", ctx.userId)
      .ilike("name", args.playbookName).maybeSingle();
    if ((pb as any)?.id) q = q.eq("playbook_id", (pb as any).id);
  }
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  const rows = (data ?? []).map((r: any) => ({
    id: r.id,
    date: r.entry_time,
    symbol: r.symbol,
    side: r.direction,
    outcome: r.outcome,
    r: r.r_multiple != null ? Number(r.r_multiple) : null,
    pnl: r.net_pnl != null ? Number(r.net_pnl) : null,
    session: r.session,
    playbook: r.playbook?.name ?? null,
  }));
  return { ok: true, data: { count: rows.length, trades: rows } };
}

async function tool_getTradeDetail(ctx: ToolExecCtx, args: any): Promise<ToolResult> {
  if (!args.trade_id) return { ok: false, error: "trade_id required" };
  const { data, error } = await ctx.admin
    .from("trades")
    .select(`
      *,
      playbook:playbooks!trades_playbook_id_fkey(name),
      trade_reviews(*),
      ai_reviews(summary, strengths, weaknesses, recommendations),
      trade_modifications(field, old_value, new_value, occurred_at),
      trade_comments(body, created_at)
    `)
    .eq("id", args.trade_id)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Trade not found or not owned by you." };
  return { ok: true, data };
}

async function tool_getRecentPerformance(ctx: ToolExecCtx, args: any): Promise<ToolResult> {
  const days = Math.min(Math.max(Number(args.days ?? 30), 1), 365);
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { data, error } = await ctx.admin
    .from("trades")
    .select("symbol, outcome, r_multiple, net_pnl, entry_time")
    .eq("user_id", ctx.userId)
    .eq("is_open", false)
    .gte("entry_time", since)
    .limit(5000);
  if (error) return { ok: false, error: error.message };
  const rows = (data ?? []).filter((r: any) => r.r_multiple != null);
  const count = rows.length;
  if (count === 0) return { ok: true, data: { days, count: 0, message: "No closed trades in this window." } };
  const wins = rows.filter((r: any) => r.outcome === "win").length;
  const rs = rows.map((r: any) => Number(r.r_multiple));
  const meanR = rs.reduce((a, b) => a + b, 0) / count;
  const grossR = rs.reduce((a, b) => a + b, 0);
  const bestR = Math.max(...rs);
  const worstR = Math.min(...rs);
  const bySymbol: Record<string, { n: number; grossR: number }> = {};
  for (const r of rows) {
    const s = (r as any).symbol ?? "?";
    if (!bySymbol[s]) bySymbol[s] = { n: 0, grossR: 0 };
    bySymbol[s].n += 1;
    bySymbol[s].grossR += Number(r.r_multiple);
  }
  const topSymbols = Object.entries(bySymbol)
    .sort((a, b) => b[1].grossR - a[1].grossR)
    .slice(0, 8)
    .map(([s, v]) => ({ symbol: s, trades: v.n, grossR: Number(v.grossR.toFixed(2)) }));
  return {
    ok: true,
    data: {
      days, count,
      winRate: count ? wins / count : 0,
      expectancyR: Number(meanR.toFixed(3)),
      grossR: Number(grossR.toFixed(2)),
      bestR: Number(bestR.toFixed(2)),
      worstR: Number(worstR.toFixed(2)),
      topSymbols,
    },
  };
}

async function tool_getPlaybookStats(ctx: ToolExecCtx, args: any): Promise<ToolResult> {
  const { data: playbooks } = await ctx.admin
    .from("playbooks").select("id, name").eq("user_id", ctx.userId).eq("archived", false);
  if (!playbooks || playbooks.length === 0) return { ok: true, data: { playbooks: [] } };
  const target = args.playbookName ? playbooks.find((p: any) => p.name.toLowerCase() === String(args.playbookName).toLowerCase()) : null;
  const ids = target ? [(target as any).id] : (playbooks as any[]).map((p) => p.id);

  const { data: trades, error } = await ctx.admin
    .from("trades")
    .select("playbook_id, outcome, r_multiple")
    .eq("user_id", ctx.userId)
    .eq("is_open", false)
    .in("playbook_id", ids);
  if (error) return { ok: false, error: error.message };

  const stats: Record<string, { name: string; n: number; wins: number; grossR: number; bestR: number; worstR: number }> = {};
  for (const p of playbooks as any[]) if (ids.includes(p.id)) stats[p.id] = { name: p.name, n: 0, wins: 0, grossR: 0, bestR: -Infinity, worstR: Infinity };
  for (const t of (trades ?? []) as any[]) {
    if (t.r_multiple == null || !stats[t.playbook_id]) continue;
    const r = Number(t.r_multiple);
    const s = stats[t.playbook_id];
    s.n += 1;
    if (t.outcome === "win") s.wins += 1;
    s.grossR += r;
    if (r > s.bestR) s.bestR = r;
    if (r < s.worstR) s.worstR = r;
  }
  const out = Object.values(stats)
    .filter((s) => s.n > 0)
    .map((s) => ({
      name: s.name, sample: s.n,
      winRate: Number((s.wins / s.n).toFixed(3)),
      expectancyR: Number((s.grossR / s.n).toFixed(3)),
      grossR: Number(s.grossR.toFixed(2)),
      bestR: Number(s.bestR.toFixed(2)),
      worstR: Number(s.worstR.toFixed(2)),
    }))
    .sort((a, b) => b.expectancyR - a.expectancyR);
  return { ok: true, data: { playbooks: out } };
}

async function tool_recallSimilarTrades(ctx: ToolExecCtx, args: any): Promise<ToolResult> {
  const query = String(args.query ?? "").trim();
  if (!query) return { ok: false, error: "query is required" };
  const k = Math.min(Math.max(Number(args.k ?? 5), 1), 10);

  // Ensure embeddings exist at all — if not, fall back to a plain trade list.
  const { count } = await ctx.admin
    .from("trade_embeddings").select("trade_id", { count: "exact", head: true })
    .eq("user_id", ctx.userId);
  if (!count) {
    const { data } = await ctx.admin
      .from("trades")
      .select("id, symbol, direction, outcome, r_multiple, entry_time")
      .eq("user_id", ctx.userId).eq("is_open", false)
      .order("entry_time", { ascending: false }).limit(k);
    return {
      ok: true,
      data: {
        fallback: true,
        note: "Semantic recall not indexed yet — showing recent trades instead.",
        trades: data ?? [],
      },
    };
  }

  const vec = await embedQuery(query, ctx.lovableApiKey);

  // The RPC uses auth.uid() internally, but we're on the service-role client.
  // Query directly via the table with the same math, filtered to this user.
  const { data, error } = await ctx.admin.rpc("match_user_trades" as any, {
    query_embedding: vec as any,
    match_count: k,
  });
  // Service-role bypasses RLS so auth.uid() is null inside the RPC. Instead,
  // do the query directly for reliability.
  let matches: any[] = Array.isArray(data) ? data : [];
  if (!data || matches.length === 0 || error) {
    const { data: rows } = await ctx.admin
      .from("trade_embeddings")
      .select("trade_id, content_preview, embedding")
      .eq("user_id", ctx.userId)
      .limit(500);
    if (!rows || rows.length === 0) return { ok: true, data: { matches: [] } };
    // Compute cosine similarity in JS (small N — up to 500).
    const q = vec;
    const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
    const norm = (a: number[]) => Math.sqrt(a.reduce((s, x) => s + x * x, 0));
    const qn = norm(q);
    const scored = rows.map((r: any) => {
      const e = r.embedding as any;
      const arr = typeof e === "string" ? JSON.parse(e) : e;
      const sim = dot(q, arr) / (qn * norm(arr) || 1);
      return { trade_id: r.trade_id, similarity: sim, content_preview: r.content_preview };
    });
    scored.sort((a, b) => b.similarity - a.similarity);
    matches = scored.slice(0, k);
  }

  // Hydrate lightweight trade info for each match.
  const ids = matches.map((m) => m.trade_id);
  if (ids.length === 0) return { ok: true, data: { matches: [] } };
  const { data: trades } = await ctx.admin
    .from("trades")
    .select("id, symbol, direction, outcome, r_multiple, entry_time")
    .in("id", ids)
    .eq("user_id", ctx.userId);
  const tById = new Map<string, any>((trades ?? []).map((t: any) => [t.id, t]));
  const out = matches
    .filter((m) => tById.has(m.trade_id))
    .map((m) => ({
      trade_id: m.trade_id,
      similarity: Number(Number(m.similarity).toFixed(3)),
      preview: m.content_preview,
      trade: tById.get(m.trade_id),
    }));
  return { ok: true, data: { matches: out } };
}

// ---------- Dispatcher ----------
export async function executeTool(
  name: string,
  args: any,
  ctx: ToolExecCtx,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "getUserContext": return await tool_getUserContext(ctx);
      case "searchTrades": return await tool_searchTrades(ctx, args ?? {});
      case "getTradeDetail": return await tool_getTradeDetail(ctx, args ?? {});
      case "getRecentPerformance": return await tool_getRecentPerformance(ctx, args ?? {});
      case "getPlaybookStats": return await tool_getPlaybookStats(ctx, args ?? {});
      case "recallSimilarTrades": return await tool_recallSimilarTrades(ctx, args ?? {});
      default: return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
