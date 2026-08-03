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
import { runMonteCarlo, extractRSample } from "./quant/vendor/propFirmMonteCarlo.ts";

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

// NOTE: statistics are NOT computed in TypeScript any more. Every win rate,
// expectancy and P&L the Coach is allowed to say comes from the SQL engine
// `public.journal_cohort`, which also emits pre-rendered `facts[]` strings.
// Re-deriving numbers here is what produced the "63.8% NY Continuation"
// hallucination — the model saw two slightly different roll-ups and invented
// a third. One engine, one number.


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
        "Filter trades by structured criteria. Returns up to 50 compact rows plus a rollup (sample, win rate, expectancy R). Use for numeric/factual queries; use searchJournal for anything written in prose or on chart screenshots.",
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
      name: "getStats",
      description:
        "THE ONLY source of performance numbers. Runs the SQL cohort engine and returns stats, an optional grouped breakdown, tier coverage, and a `facts[]` array of pre-rendered strings. You may state a number ONLY by quoting a facts[].text verbatim. Never add, average, round or re-derive. Defaults to journaled+partial trades and ALWAYS reports the raw (unjournaled) tier in coverage — mention it whenever you give portfolio-level advice.",
      parameters: {
        type: "object",
        properties: {
          tiers: {
            type: "array",
            items: { type: "string", enum: ["journaled", "partial", "raw"] },
            description:
              "journaled = has a playbook AND a written review; partial = one of the two; raw = broker-synced only. Default ['journaled','partial'].",
          },
          groupBy: {
            type: "string",
            enum: ["symbol", "session", "weekday", "hour", "direction", "playbook", "tier", "month"],
          },
          playbook: { type: "string" },
          symbol: { type: "string" },
          session: { type: "string" },
          direction: { type: "string", enum: ["buy", "sell"] },
          days: { type: "integer", minimum: 1, maximum: 1460 },
          dateFrom: { type: "string", description: "ISO date (YYYY-MM-DD)" },
          dateTo: { type: "string", description: "ISO date (YYYY-MM-DD)" },
        },
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
      name: "searchJournal",
      description:
        "Hybrid keyword + semantic search over EVERY piece of written journal prose: trade review mistakes/did-well/to-improve/thoughts/psychology, CHART SCREENSHOT CAPTIONS (with their timeframe), trade comments, and AI review sections. Use this for any style, concept or phrasing question ('reaction from HVN', 'fading ranges', 'felt FOMO'). Returns `quotes[]` — the ONLY strings you are allowed to put inside quotation marks when attributing words to the user.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Phrase or concept to find, e.g. 'reaction from HVN'." },
          source: { type: "string", enum: ["review", "screenshot", "comment", "ai_review"], description: "Restrict to one note source." },
          timeframe: { type: "string", description: "Screenshot timeframe filter, e.g. 4H, 15m." },
          symbol: { type: "string" },
          dateFrom: { type: "string", description: "ISO date (YYYY-MM-DD)" },
          dateTo: { type: "string", description: "ISO date (YYYY-MM-DD)" },
          k: { type: "integer", minimum: 1, maximum: 40, default: 12 },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyzeCohort",
      description:
        "Statistics for the trades matching a prose search (or explicit trade_ids). Runs the search unbounded, then hands the ids to the same SQL cohort engine as getStats, so its facts[] follow the same quoting contract.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Used when trade_ids is not supplied." },
          trade_ids: { type: "array", items: { type: "string" }, description: "Trade ids from searchJournal." },
          groupBy: { type: "string", enum: ["symbol", "session", "weekday", "hour", "direction", "playbook", "tier", "month"] },
          source: { type: "string", enum: ["review", "screenshot", "comment", "ai_review"] },
          timeframe: { type: "string" },
          symbol: { type: "string" },
          dateFrom: { type: "string" },
          dateTo: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "simulateChallenge",
      description:
        "Monte-Carlo a prop-firm challenge on the user's OWN R distribution (same engine as the Pair Lab / Challenge Planner). Use this for ANY question about pass odds, account rotation, risk sizing or drawdown — never estimate pass probability yourself.",
      parameters: {
        type: "object",
        properties: {
          accountSize: { type: "number", description: "Starting balance per account, $." },
          numAccounts: { type: "integer", minimum: 1, maximum: 20, default: 1 },
          riskPerTrade: { type: "number", description: "Dollar risk per trade. Converted to a fraction of accountSize." },
          riskPct: { type: "number", description: "Alternative to riskPerTrade: risk as % of account, e.g. 0.75." },
          targetAmount: { type: "number", description: "Profit target in $ (e.g. 3000)." },
          maxLossAmount: { type: "number", description: "Max drawdown in $ (e.g. 2000)." },
          dailyLossAmount: { type: "number", description: "Daily loss cap in $. Omit if the firm has none." },
          maxLossMode: { type: "string", enum: ["static", "trailing"], default: "static" },
          tradesPerDay: { type: "number", minimum: 0.1, maximum: 20, default: 2 },
          maxDays: { type: "integer", minimum: 5, maximum: 365, default: 60 },
          rotationModel: {
            type: "string",
            enum: ["one_only", "simultaneous", "stay_on_winner", "round_robin"],
            default: "stay_on_winner",
          },
          tiers: { type: "array", items: { type: "string", enum: ["journaled", "partial", "raw"] } },
          playbook: { type: "string", description: "Restrict the R sample to one playbook." },
          symbol: { type: "string" },
          session: { type: "string" },
          days: { type: "integer", minimum: 30, maximum: 1460 },
        },
        required: ["accountSize", "targetAmount", "maxLossAmount"],
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

// ---------- The one statistics engine ----------

export interface CohortArgs {
  tiers?: string[] | null;
  playbook?: string;
  symbol?: string;
  session?: string;
  direction?: string;
  days?: number;
  dateFrom?: string;
  dateTo?: string;
  groupBy?: string;
  trade_ids?: string[];
  includeOpen?: boolean;
}

/** Calls public.journal_cohort. All Coach numbers originate here. */
export async function runCohort(ctx: ToolExecCtx, a: CohortArgs) {
  const explicitIds = Array.isArray(a.trade_ids) && a.trade_ids.length > 0;
  const { data, error } = await ctx.admin.rpc("journal_cohort", {
    _user_id: ctx.userId,
    // With explicit ids the caller already picked the population, so do not
    // silently drop raw-tier trades out of it.
    _tiers: explicitIds ? null : (a.tiers === null ? null : (a.tiers ?? ["journaled", "partial"])),
    _playbook: a.playbook ?? null,
    _symbol: a.symbol ?? null,
    _session: a.session ?? null,
    _direction: a.direction ?? null,
    _from: a.dateFrom ? new Date(a.dateFrom).toISOString() : null,
    _to: a.dateTo ? new Date(`${a.dateTo}T23:59:59Z`).toISOString() : null,
    _days: a.days != null ? Math.min(Math.max(Number(a.days), 1), 1460) : null,
    _trade_ids: explicitIds ? a.trade_ids : null,
    _group_by: a.groupBy ?? null,
    _include_open: !!a.includeOpen,
  });
  if (error) throw new Error(`journal_cohort failed: ${error.message}`);
  return data as any;
}

async function tool_getStats(ctx: ToolExecCtx, args: any): Promise<ToolResult> {
  const cohort = await runCohort(ctx, args ?? {});
  const n = Number(cohort?.stats?.n ?? 0);
  return {
    ok: true,
    data: {
      ...cohort,
      guidance: n === 0
        ? "Empty cohort — say so plainly and quote nothing."
        : n < 10
        ? "Anecdotal (n<10): describe it as a hint, never as an edge, and do not prescribe rules from it."
        : n < 30
        ? "Indicative (n<30): state the sample size in the same sentence as any number."
        : "Established sample. Still quote facts[] verbatim.",
    },
  };
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
      note: "These matches are the top-k for display only. For any statistic call analyzeCohort with the SAME query (not these trade_ids) so the cohort is not truncated by k.",
    },
  };
}

async function tool_analyzeCohort(ctx: ToolExecCtx, args: any): Promise<ToolResult> {
  let ids: string[] = Array.isArray(args.trade_ids) ? args.trade_ids.map(String) : [];
  let via = "trade_ids";
  if (ids.length === 0) {
    if (!String(args.query ?? "").trim()) return { ok: false, error: "Provide trade_ids or query" };
    // Cohorts must not be truncated by the display-oriented k of searchJournal.
    const { notes } = await runJournalSearch(ctx, { ...args, k: 200 });
    ids = Array.from(new Set(notes.map((n) => n.trade_id)));
    via = "query";
  }
  if (ids.length === 0) {
    return { ok: true, data: { via, stats: { n: 0 }, facts: [], note: "Empty cohort — no statistic can be quoted." } };
  }

  // Same SQL engine as getStats → identical numbers, identical quoting contract.
  const cohort = await runCohort(ctx, {
    trade_ids: ids,
    groupBy: args.groupBy,
    symbol: args.symbol,
    dateFrom: args.dateFrom,
    dateTo: args.dateTo,
  });
  return { ok: true, data: { via, matched_trade_ids: ids.slice(0, 100), ...cohort } };
}

// ---------- Prop-firm challenge simulation ----------

async function tool_simulateChallenge(ctx: ToolExecCtx, args: any): Promise<ToolResult> {
  const accountSize = Number(args.accountSize);
  const targetAmount = Number(args.targetAmount);
  const maxLossAmount = Number(args.maxLossAmount);
  if (!Number.isFinite(accountSize) || accountSize <= 0) return { ok: false, error: "accountSize must be > 0" };
  if (!Number.isFinite(targetAmount) || !Number.isFinite(maxLossAmount)) {
    return { ok: false, error: "targetAmount and maxLossAmount are required" };
  }

  // R sample comes from the same cohort definition as every other number.
  const tiers = Array.isArray(args.tiers) ? args.tiers : ["journaled", "partial"];
  const cohort = await runCohort(ctx, {
    tiers, playbook: args.playbook, symbol: args.symbol, session: args.session, days: args.days,
  });

  let q = ctx.admin
    .from("trades")
    .select("r_multiple_actual, entry_time, is_open, is_archived, playbook_id, actual_playbook_id, symbol, session")
    .eq("user_id", ctx.userId).eq("is_open", false)
    .not("r_multiple_actual", "is", null)
    .order("entry_time", { ascending: true })
    .limit(5000);
  if (args.symbol) q = q.ilike("symbol", args.symbol);
  if (args.session) q = q.ilike("session", args.session);
  if (args.days) q = q.gte("entry_time", new Date(Date.now() - Number(args.days) * 86400_000).toISOString());
  if (args.playbook) {
    const { data: pb } = await ctx.admin
      .from("playbooks").select("id").eq("user_id", ctx.userId).ilike("name", args.playbook).limit(1).maybeSingle();
    if ((pb as any)?.id) q = q.or(`playbook_id.eq.${(pb as any).id},actual_playbook_id.eq.${(pb as any).id}`);
    else return { ok: false, error: `No playbook named "${args.playbook}".` };
  }
  // Tier filter mirrors journal_cohort: journaled/partial require a playbook or review.
  const { data: rows, error } = await q;
  if (error) return { ok: false, error: error.message };
  let sampleRows = (rows ?? []) as any[];
  if (!tiers.includes("raw")) {
    sampleRows = sampleRows.filter((t) => t.playbook_id != null || t.actual_playbook_id != null);
  }
  const rSample = extractRSample(sampleRows);
  if (rSample.length < 20) {
    return {
      ok: true,
      data: {
        r_sample_size: rSample.length,
        note: "Fewer than 20 R values in this cohort — a Monte-Carlo pass probability would be noise. Say the sample is too thin instead of quoting odds.",
      },
    };
  }

  const riskFrac = args.riskPct != null
    ? Number(args.riskPct) / 100
    : args.riskPerTrade != null
    ? Number(args.riskPerTrade) / accountSize
    : 0.01;

  const params = {
    rSample,
    riskPerTradeFrac: riskFrac,
    numAccounts: Math.max(1, Number(args.numAccounts ?? 1)),
    accountSize,
    dailyLossPct: args.dailyLossAmount != null ? Number(args.dailyLossAmount) / accountSize : null,
    maxLossPct: maxLossAmount / accountSize,
    targetPct: targetAmount / accountSize,
    tradesPerDay: Number(args.tradesPerDay ?? 2),
    maxDays: Math.min(Math.max(Number(args.maxDays ?? 60), 5), 365),
    rotationModel: (args.rotationModel ?? "stay_on_winner") as any,
    paths: 4000,
    seed: 1337, // deterministic → the same question twice gives the same odds
    maxLossMode: (args.maxLossMode ?? "static") as "static" | "trailing",
  };
  const mc = runMonteCarlo(params);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

  return {
    ok: true,
    data: {
      inputs: {
        account_size: accountSize, accounts: params.numAccounts,
        risk_per_trade: Math.round(riskFrac * accountSize),
        risk_pct: Number((riskFrac * 100).toFixed(3)),
        target: targetAmount, max_loss: maxLossAmount,
        daily_loss: args.dailyLossAmount ?? null,
        trades_per_day: params.tradesPerDay, max_days: params.maxDays,
        rotation: params.rotationModel, max_loss_mode: params.maxLossMode,
        r_sample_size: rSample.length, tiers,
      },
      cohort_facts: cohort?.facts ?? [],
      results: {
        pass_prob: mc.passProb, fail_prob: mc.failProb, inconclusive_prob: mc.inconclusiveProb,
        risk_of_ruin: mc.riskOfRuin, avg_days_to_pass: mc.avgDaysToPass,
        avg_drawdown_pct: mc.avgDrawdownPct, cvar5_pct: mc.cvar5Pct,
        expected_return_pct: mc.expectedReturnPct,
        geometric_growth_per_trade_pct: mc.geometricMeanGrowthPct,
        account_survival_rate: mc.accountSurvivalRate,
      },
      facts: [
        { id: "s1", text: `simulation | ${params.numAccounts} × $${accountSize} | risk $${Math.round(riskFrac * accountSize)}/trade | target $${targetAmount} | max loss $${maxLossAmount} | rotation ${params.rotationModel} | R sample n=${rSample.length} | ${mc.paths} paths` },
        { id: "s2", text: `pass ${pct(mc.passProb)} (95% CI ${pct(mc.passProbCI[0])}–${pct(mc.passProbCI[1])}) | fail ${pct(mc.failProb)} | undecided in ${params.maxDays}d ${pct(mc.inconclusiveProb)}` },
        { id: "s3", text: `at least one account busts ${pct(mc.riskOfRuin)} | mean drawdown ${mc.avgDrawdownPct.toFixed(1)}% | worst-5% final equity ${mc.cvar5Pct.toFixed(1)}% | geometric growth ${mc.geometricMeanGrowthPct.toFixed(3)}%/trade` },
      ],
      contract: "Quote these odds only by copying facts[].text verbatim. Never round or restate them yourself.",
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
      case "getStats": return await tool_getStats(ctx, args ?? {});
      case "getOpenTrades": return await tool_getOpenTrades(ctx);
      case "searchJournal": return await tool_searchJournal(ctx, args ?? {});
      case "analyzeCohort": return await tool_analyzeCohort(ctx, args ?? {});
      case "simulateChallenge": return await tool_simulateChallenge(ctx, args ?? {});
      default: return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Names of every executor — used by the smoke test so a schema rename fails loudly. */
export const COACH_TOOL_NAMES = COACH_TOOL_SCHEMAS.map((t) => t.function.name);
