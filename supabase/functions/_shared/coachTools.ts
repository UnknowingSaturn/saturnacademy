// Tool definitions + executors for the Trading Coach.
// Each tool receives an admin client already scoped to a user_id at the caller
// (we always filter by user_id inside the tool — never trust the model's args).
//
// SINGLE SOURCE OF TRUTH: every tool projects trades through TRADE_SELECT +
// normalizeTrade(). The original bug in this file was the same (wrong) column
// list copy-pasted into six places — `outcome` and `r_multiple` do not exist on
// public.trades. Add columns here, never inline in a tool.
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
  /** Image URLs the chat loop should feed to the vision model this turn. */
  images?: string[];
  error?: string;
}

// ---------- Canonical trade projection ----------

export const TRADE_SELECT =
  "id, trade_number, symbol, direction, net_pnl, gross_pnl, commission, swap, " +
  "r_multiple_actual, r_multiple_planned, risk_percent, total_lots, " +
  "entry_price, exit_price, entry_time, exit_time, sl_initial, tp_initial, sl_final, tp_final, " +
  "session, duration_seconds, is_open, trade_type, profile, place, " +
  "playbook:playbooks!trades_playbook_id_fkey(name)";

export type Outcome = "win" | "loss" | "breakeven";

export function outcomeOf(netPnl: unknown): Outcome | null {
  if (netPnl == null) return null;
  const n = Number(netPnl);
  if (!Number.isFinite(n)) return null;
  if (n > 0) return "win";
  if (n < 0) return "loss";
  return "breakeven";
}

export function rOf(row: any): number | null {
  const r = row?.r_multiple_actual ?? row?.r_multiple_planned;
  return r == null ? null : Number(r);
}

export function normalizeTrade(row: any) {
  return {
    id: row.id,
    n: row.trade_number ?? null,
    date: row.entry_time,
    exit: row.exit_time ?? null,
    symbol: row.symbol,
    side: row.direction,
    outcome: outcomeOf(row.net_pnl),
    r: rOf(row),
    pnl: row.net_pnl != null ? Number(row.net_pnl) : null,
    lots: row.total_lots != null ? Number(row.total_lots) : null,
    risk_pct: row.risk_percent != null ? Number(row.risk_percent) : null,
    session: row.session ?? null,
    is_open: !!row.is_open,
    trade_type: row.trade_type ?? "executed",
    playbook: row.playbook?.name ?? null,
    entry_price: row.entry_price != null ? Number(row.entry_price) : null,
    exit_price: row.exit_price != null ? Number(row.exit_price) : null,
    sl: row.sl_final ?? row.sl_initial ?? null,
    tp: row.tp_final ?? row.tp_initial ?? null,
    duration_min: row.duration_seconds != null ? Math.round(row.duration_seconds / 60) : null,
  };
}

function summarize(rows: any[]) {
  const withR = rows.filter((t) => t.r != null);
  const n = rows.length;
  const wins = rows.filter((t) => t.outcome === "win").length;
  const losses = rows.filter((t) => t.outcome === "loss").length;
  const rs = withR.map((t) => Number(t.r));
  const grossR = rs.reduce((a, b) => a + b, 0);
  const pnl = rows.reduce((a, t) => a + (t.pnl ?? 0), 0);
  return {
    sample: n,
    r_sample: rs.length,
    winRate: n ? Number((wins / n).toFixed(3)) : null,
    wins,
    losses,
    expectancyR: rs.length ? Number((grossR / rs.length).toFixed(3)) : null,
    grossR: Number(grossR.toFixed(2)),
    netPnl: Number(pnl.toFixed(2)),
    bestR: rs.length ? Number(Math.max(...rs).toFixed(2)) : null,
    worstR: rs.length ? Number(Math.min(...rs).toFixed(2)) : null,
    low_confidence: n < 20,
  };
}

function collectScreenshots(v: unknown): string[] {
  const out: string[] = [];
  const push = (x: unknown) => {
    if (typeof x === "string" && /^https?:\/\//.test(x)) out.push(x);
    else if (x && typeof x === "object") {
      const u = (x as any).url ?? (x as any).src ?? (x as any).public_url;
      if (typeof u === "string" && /^https?:\/\//.test(u)) out.push(u);
    }
  };
  if (Array.isArray(v)) v.forEach(push);
  else if (v && typeof v === "object") Object.values(v as any).forEach((entry) => {
    if (Array.isArray(entry)) entry.forEach(push); else push(entry);
  });
  else push(v);
  return Array.from(new Set(out));
}

// ---------- Public JSON schema (OpenAI function-calling shape) ----------
export const COACH_TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "getUserContext",
      description:
        "Get the user's display timezone, session definitions, playbook names, and trade counts. Call this FIRST if you need to reason about time-of-day or reference a playbook by name.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "searchTrades",
      description:
        "Filter trades by structured criteria. Returns up to 50 compact rows plus a rollup (sample, win rate, expectancy R). Use for numeric/factual queries; use recallSimilarTrades for fuzzy prose queries.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Exact symbol match, e.g. GBPUSD" },
          side: { type: "string", enum: ["buy", "sell"] },
          outcome: { type: "string", enum: ["win", "loss", "breakeven"] },
          dateFrom: { type: "string", description: "ISO date (YYYY-MM-DD)" },
          dateTo: { type: "string", description: "ISO date (YYYY-MM-DD)" },
          session: { type: "string" },
          playbookName: { type: "string" },
          includeOpen: { type: "boolean", default: false },
          limit: { type: "integer", minimum: 1, maximum: 50, default: 50 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getTradeDetail",
      description:
        "Full detail for one trade: prices, SL/TP modifications, the user's own review prose (mistakes, did well, to improve, psychology), AI review, comments, and chart screenshots. Screenshots are shown to you as images — describe what is actually on them.",
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
        "Rollup of closed trades over the last N days: count, win rate, expectancy (mean R), gross R, best/worst R, per-symbol breakdown.",
      parameters: {
        type: "object",
        properties: { days: { type: "integer", minimum: 1, maximum: 730, default: 30 } },
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
      name: "getBreakdown",
      description:
        "Expectancy / win rate / sample grouped by one dimension across closed trades. Use this instead of pulling raw trades when the question is 'which X performs best'.",
      parameters: {
        type: "object",
        properties: {
          dimension: {
            type: "string",
            enum: ["symbol", "session", "weekday", "hour", "direction", "playbook", "emotion_before", "regime"],
          },
          days: { type: "integer", minimum: 1, maximum: 730, description: "Optional lookback window." },
        },
        required: ["dimension"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getOpenTrades",
      description: "Currently open positions with entry, SL/TP, planned R and risk %. Use when the user asks about what they are in right now.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
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
    .from("profiles").select("display_name, email").eq("id", ctx.userId).maybeSingle();
  const { data: settings } = await ctx.admin
    .from("user_settings").select("display_timezone").eq("user_id", ctx.userId).maybeSingle();
  const { data: sessions } = await ctx.admin
    .from("session_definitions")
    .select("name, key, start_hour, start_minute, end_hour, end_minute, timezone")
    .eq("user_id", ctx.userId)
    .eq("is_active", true);
  const { data: playbooks } = await ctx.admin
    .from("playbooks").select("name, description").eq("user_id", ctx.userId).eq("is_active", true).limit(50);
  const { count: closedCount } = await ctx.admin
    .from("trades").select("id", { count: "exact", head: true })
    .eq("user_id", ctx.userId).eq("is_open", false);
  const { count: openCount } = await ctx.admin
    .from("trades").select("id", { count: "exact", head: true })
    .eq("user_id", ctx.userId).eq("is_open", true);
  const { data: firstTrade } = await ctx.admin
    .from("trades").select("entry_time").eq("user_id", ctx.userId)
    .order("entry_time", { ascending: true }).limit(1).maybeSingle();

  return {
    ok: true,
    data: {
      profile,
      timezone: (settings as any)?.display_timezone ?? "UTC",
      sessions: sessions ?? [],
      playbooks: playbooks ?? [],
      closed_trades: closedCount ?? 0,
      open_trades: openCount ?? 0,
      journal_since: (firstTrade as any)?.entry_time ?? null,
      today: new Date().toISOString(),
    },
  };
}

async function tool_searchTrades(ctx: ToolExecCtx, args: any): Promise<ToolResult> {
  const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 50);
  let q = ctx.admin
    .from("trades").select(TRADE_SELECT)
    .eq("user_id", ctx.userId)
    .order("entry_time", { ascending: false })
    .limit(limit);
  if (!args.includeOpen) q = q.eq("is_open", false);
  if (args.symbol) q = q.ilike("symbol", args.symbol);
  if (args.side) q = q.eq("direction", args.side);
  if (args.session) q = q.ilike("session", args.session);
  if (args.dateFrom) q = q.gte("entry_time", args.dateFrom);
  if (args.dateTo) q = q.lte("entry_time", `${args.dateTo}T23:59:59Z`);
  // Outcome must filter in SQL, not after LIMIT — post-filtering silently
  // returns "the most recent loss" from only the last N rows.
  if (args.outcome === "win") q = q.gt("net_pnl", 0);
  else if (args.outcome === "loss") q = q.lt("net_pnl", 0);
  else if (args.outcome === "breakeven") q = q.eq("net_pnl", 0);
  if (args.playbookName) {
    const { data: pb } = await ctx.admin
      .from("playbooks").select("id").eq("user_id", ctx.userId)
      .ilike("name", args.playbookName).limit(1).maybeSingle();
    if ((pb as any)?.id) q = q.eq("playbook_id", (pb as any).id);
    else return { ok: true, data: { count: 0, note: `No playbook named "${args.playbookName}".`, trades: [] } };
  }
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  const rows = (data ?? []).map(normalizeTrade);
  return { ok: true, data: { count: rows.length, rollup: summarize(rows), trades: rows } };
}

async function tool_getTradeDetail(ctx: ToolExecCtx, args: any): Promise<ToolResult> {
  if (!args.trade_id) return { ok: false, error: "trade_id required" };
  const { data, error } = await ctx.admin
    .from("trades")
    .select(`
      ${TRADE_SELECT},
      account_id, ticket, group_key, group_role, custom_fields, alignment, entry_timeframes,
      trade_reviews(score, regime, news_risk, emotional_state_before, emotional_state_after,
                    psychology_notes, mistakes, did_well, to_improve, actionable_steps, thoughts,
                    checklist_answers, screenshots, reviewed_at),
      ai_reviews(confidence, setup_compliance_score, rule_violations, context_alignment_score,
                 technical_review, mistake_attribution, psychology_analysis, comparison_to_past,
                 actionable_guidance, thesis_evaluation, visual_analysis, strategy_refinement),
      trade_modifications(field, old_value, new_value, occurred_at),
      trade_comments(content, screenshot_url, created_at)
    `)
    .eq("id", args.trade_id)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Trade not found or not owned by you." };

  const row: any = data;
  const reviews: any[] = Array.isArray(row.trade_reviews) ? row.trade_reviews : row.trade_reviews ? [row.trade_reviews] : [];
  const comments: any[] = Array.isArray(row.trade_comments) ? row.trade_comments : [];
  const images = [
    ...reviews.flatMap((r) => collectScreenshots(r.screenshots)),
    ...comments.map((c) => c.screenshot_url).filter((u: unknown) => typeof u === "string" && /^https?:\/\//.test(u as string)),
  ].slice(0, 4);

  return {
    ok: true,
    images,
    data: {
      ...normalizeTrade(row),
      ticket: row.ticket ?? null,
      group_key: row.group_key ?? null,
      custom_fields: row.custom_fields ?? {},
      alignment: row.alignment ?? null,
      entry_timeframes: row.entry_timeframes ?? null,
      reviews,
      ai_reviews: row.ai_reviews ?? [],
      modifications: row.trade_modifications ?? [],
      comments,
      screenshots_attached: images.length,
    },
  };
}

async function tool_getRecentPerformance(ctx: ToolExecCtx, args: any): Promise<ToolResult> {
  const days = Math.min(Math.max(Number(args.days ?? 30), 1), 730);
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { data, error } = await ctx.admin
    .from("trades").select(TRADE_SELECT)
    .eq("user_id", ctx.userId).eq("is_open", false)
    .gte("entry_time", since)
    .limit(5000);
  if (error) return { ok: false, error: error.message };
  const rows = (data ?? []).map(normalizeTrade);
  if (rows.length === 0) return { ok: true, data: { days, sample: 0, message: "No closed trades in this window." } };

  const bySymbol: Record<string, any[]> = {};
  for (const t of rows) (bySymbol[t.symbol ?? "?"] ??= []).push(t);
  const symbols = Object.entries(bySymbol)
    .map(([symbol, list]) => ({ symbol, ...summarize(list) }))
    .sort((a, b) => (b.grossR ?? 0) - (a.grossR ?? 0))
    .slice(0, 10);

  return { ok: true, data: { days, ...summarize(rows), symbols } };
}

async function tool_getPlaybookStats(ctx: ToolExecCtx, args: any): Promise<ToolResult> {
  const { data: playbooks } = await ctx.admin
    .from("playbooks").select("id, name").eq("user_id", ctx.userId).eq("is_active", true);
  if (!playbooks || playbooks.length === 0) return { ok: true, data: { playbooks: [] } };
  const target = args.playbookName
    ? (playbooks as any[]).find((p) => p.name.toLowerCase() === String(args.playbookName).toLowerCase())
    : null;
  const ids = target ? [target.id] : (playbooks as any[]).map((p) => p.id);

  const { data: trades, error } = await ctx.admin
    .from("trades").select(`playbook_id, ${TRADE_SELECT}`)
    .eq("user_id", ctx.userId).eq("is_open", false).in("playbook_id", ids).limit(5000);
  if (error) return { ok: false, error: error.message };

  const byId: Record<string, any[]> = {};
  for (const t of (trades ?? []) as any[]) (byId[t.playbook_id] ??= []).push(normalizeTrade(t));
  const out = (playbooks as any[])
    .filter((p) => ids.includes(p.id) && (byId[p.id]?.length ?? 0) > 0)
    .map((p) => ({ name: p.name, ...summarize(byId[p.id]) }))
    .sort((a, b) => (b.expectancyR ?? -99) - (a.expectancyR ?? -99));
  return { ok: true, data: { playbooks: out } };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

async function tool_getBreakdown(ctx: ToolExecCtx, args: any): Promise<ToolResult> {
  const dim = String(args.dimension ?? "");
  const needsReview = dim === "emotion_before" || dim === "regime";
  const select = needsReview
    ? `${TRADE_SELECT}, trade_reviews(emotional_state_before, regime)`
    : TRADE_SELECT;
  let q = ctx.admin.from("trades").select(select)
    .eq("user_id", ctx.userId).eq("is_open", false).limit(5000);
  if (args.days) {
    const since = new Date(Date.now() - Math.min(Number(args.days), 730) * 86400_000).toISOString();
    q = q.gte("entry_time", since);
  }
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };

  const groups: Record<string, any[]> = {};
  for (const raw of (data ?? []) as any[]) {
    const t = normalizeTrade(raw);
    const rv = Array.isArray(raw.trade_reviews) ? raw.trade_reviews[0] : raw.trade_reviews;
    const d = t.date ? new Date(t.date) : null;
    let key: string;
    switch (dim) {
      case "symbol": key = t.symbol ?? "?"; break;
      case "session": key = t.session ?? "unassigned"; break;
      case "weekday": key = d ? WEEKDAYS[d.getUTCDay()] : "?"; break;
      case "hour": key = d ? `${String(d.getUTCHours()).padStart(2, "0")}:00 UTC` : "?"; break;
      case "direction": key = t.side ?? "?"; break;
      case "playbook": key = t.playbook ?? "no playbook"; break;
      case "emotion_before": key = rv?.emotional_state_before ?? "not logged"; break;
      case "regime": key = rv?.regime ?? "not logged"; break;
      default: return { ok: false, error: `Unsupported dimension: ${dim}` };
    }
    (groups[key] ??= []).push(t);
  }

  const rows = Object.entries(groups)
    .map(([key, list]) => ({ key, ...summarize(list) }))
    .sort((a, b) => (b.expectancyR ?? -99) - (a.expectancyR ?? -99));
  return { ok: true, data: { dimension: dim, groups: rows, note: "Groups with sample < 20 are flagged low_confidence." } };
}

async function tool_getOpenTrades(ctx: ToolExecCtx): Promise<ToolResult> {
  const { data, error } = await ctx.admin
    .from("trades").select(TRADE_SELECT)
    .eq("user_id", ctx.userId).eq("is_open", true)
    .order("entry_time", { ascending: false }).limit(50);
  if (error) return { ok: false, error: error.message };
  const rows = (data ?? []).map(normalizeTrade);
  return { ok: true, data: { count: rows.length, trades: rows } };
}

// ---------- Journal prose retrieval (hybrid keyword + vector) ----------

/** Runs the search_journal RPC. Vector arm is optional: if the note index is
 * empty or embedding fails, keyword + trigram still answers. */
async function runJournalSearch(ctx: ToolExecCtx, args: any) {
  const query = String(args.query ?? "").trim();
  const k = Math.min(Math.max(Number(args.k ?? 12), 1), 40);

  let embedding: number[] | null = null;
  const { count: indexed } = await ctx.admin
    .from("note_embeddings").select("note_key", { count: "exact", head: true })
    .eq("user_id", ctx.userId);
  if (indexed && query) {
    try {
      embedding = await embedQuery(query, ctx.lovableApiKey);
    } catch {
      embedding = null; // keyword arm still works — never fail the whole search
    }
  }

  const { data, error } = await ctx.admin.rpc("search_journal", {
    _user_id: ctx.userId,
    _query: query || null,
    _query_embedding: embedding as any,
    _k: k,
    _source: args.source ? String(args.source) : null,
    _timeframe: args.timeframe ? String(args.timeframe) : null,
    _symbol: args.symbol ? String(args.symbol) : null,
    _from: args.dateFrom ? new Date(args.dateFrom).toISOString() : null,
    _to: args.dateTo ? new Date(`${args.dateTo}T23:59:59Z`).toISOString() : null,
  });
  if (error) throw new Error(`search_journal failed: ${error.message}`);
  return { notes: (data ?? []) as any[], indexed: indexed ?? 0, vector_used: !!embedding };
}

async function tool_searchJournal(ctx: ToolExecCtx, args: any): Promise<ToolResult> {
  if (!String(args.query ?? "").trim()) return { ok: false, error: "query is required" };
  const { notes, indexed, vector_used } = await runJournalSearch(ctx, args);
  if (notes.length === 0) {
    return {
      ok: true,
      data: { indexed_notes: indexed, vector_used, matches: [], trade_count: 0,
        note: "No journal note matched. Say so plainly — do not substitute a guess." },
    };
  }

  const ids = Array.from(new Set(notes.map((n) => n.trade_id)));
  const { data: trades } = await ctx.admin
    .from("trades").select(TRADE_SELECT).in("id", ids).eq("user_id", ctx.userId);
  const tById = new Map<string, any>((trades ?? []).map((t: any) => [t.id, normalizeTrade(t)]));

  const matches = notes.map((n) => ({
    trade_id: n.trade_id,
    source: n.source,
    field: n.field,
    timeframe: n.source === "screenshot" ? n.label : null,
    snippet: String(n.body ?? "").slice(0, 400),
    score: n.score != null ? Number(Number(n.score).toFixed(4)) : null,
    matched_by: n.kw_rank != null && n.vec_rank != null ? "both" : n.kw_rank != null ? "keyword" : "semantic",
    trade: tById.get(n.trade_id) ?? null,
  }));

  return {
    ok: true,
    data: {
      indexed_notes: indexed,
      vector_used,
      trade_count: ids.length,
      trade_ids: ids,
      matches,
      note: "Pass trade_ids (or the same query) to analyzeCohort before making any statistical claim.",
    },
  };
}

async function tool_analyzeCohort(ctx: ToolExecCtx, args: any): Promise<ToolResult> {
  let ids: string[] = Array.isArray(args.trade_ids) ? args.trade_ids.map(String) : [];
  let via = "trade_ids";
  if (ids.length === 0) {
    if (!String(args.query ?? "").trim()) return { ok: false, error: "Provide trade_ids or query" };
    const { notes } = await runJournalSearch(ctx, { ...args, k: Math.min(Number(args.k ?? 40), 40) });
    ids = Array.from(new Set(notes.map((n) => n.trade_id)));
    via = "query";
  }
  if (ids.length === 0) return { ok: true, data: { via, sample: 0, note: "Empty cohort — no statistic can be quoted." } };

  const { data, error } = await ctx.admin.rpc("journal_cohort_stats", {
    _user_id: ctx.userId,
    _trade_ids: ids,
  });
  if (error) return { ok: false, error: error.message };
  const stats = Array.isArray(data) ? data[0] : data;

  let groups: any[] | undefined;
  if (args.groupBy) {
    const { data: rows } = await ctx.admin
      .from("trades").select(TRADE_SELECT).in("id", ids).eq("user_id", ctx.userId);
    const buckets: Record<string, any[]> = {};
    for (const raw of (rows ?? []) as any[]) {
      const t = normalizeTrade(raw);
      const d = t.date ? new Date(t.date) : null;
      const key = args.groupBy === "symbol" ? (t.symbol ?? "?")
        : args.groupBy === "session" ? (t.session ?? "unassigned")
        : args.groupBy === "direction" ? (t.side ?? "?")
        : args.groupBy === "playbook" ? (t.playbook ?? "no playbook")
        : args.groupBy === "weekday" ? (d ? WEEKDAYS[d.getUTCDay()] : "?")
        : "?";
      (buckets[key] ??= []).push(t);
    }
    groups = Object.entries(buckets).map(([key, list]) => ({ key, ...summarize(list) }))
      .sort((a, b) => (b.expectancyR ?? -99) - (a.expectancyR ?? -99));
  }

  return {
    ok: true,
    data: {
      via,
      sample: ids.length,
      trade_ids: ids.slice(0, 100),
      stats: stats ?? null,
      groups,
      low_confidence: ids.length < 20,
      anecdotal: ids.length < 5,
      note: "Always state the sample size (n) with any win rate or expectancy from this cohort.",
    },
  };
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
      case "getBreakdown": return await tool_getBreakdown(ctx, args ?? {});
      case "getOpenTrades": return await tool_getOpenTrades(ctx);
      case "searchJournal": return await tool_searchJournal(ctx, args ?? {});
      case "analyzeCohort": return await tool_analyzeCohort(ctx, args ?? {});
      default: return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Names of every executor — used by the smoke test so a schema rename fails loudly. */
export const COACH_TOOL_NAMES = COACH_TOOL_SCHEMAS.map((t) => t.function.name);
