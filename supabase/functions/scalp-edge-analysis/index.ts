// Scalp Edge Analysis
// Adapts the markov-hedge-fund-method state-labeller to user-journaled trades.
// Keeps the original matrix/stationary math conceptually intact: we treat each
// (context -> outcome) transition as a row in a transition matrix and rank
// contexts by their stationary expected R.
//
// What changes vs the original skill: the STATE LABELLER. Instead of labelling
// daily bars by return sign, we label each trade by an auto-detected context
// tuple drawn from:
//   - system fields: session, playbook_id, htf_bias, volatility_regime, time_bucket
//   - any user custom_fields keys present on the trade
//
// Output is per-cell stats with verdicts under two modes:
//   - "conservative": n >= 20 AND wilson_low > 0 -> GO
//   - "aggressive":   n >= 8  AND expected_R > 0 -> GO

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Mode = "conservative" | "aggressive";

interface RequestBody {
  playbook_id?: string;
  symbol?: string;
  lookback_days?: number;
  min_samples?: number;
  mode?: Mode;
  context?: Record<string, string>; // for context_lookup
}

interface TradeRow {
  id: string;
  symbol: string;
  direction: string;
  session: string | null;
  net_pnl: number | null;
  r_multiple_actual: number | null;
  entry_time: string;
  playbook_id: string | null;
  custom_fields: Record<string, unknown> | null;
}

interface FeatureRow {
  trade_id: string;
  htf_bias: string | null;
  volatility_regime: string | null;
  time_since_session_open_mins: number | null;
}

interface ReviewRow {
  trade_id: string;
  playbook_id: string | null;
  regime: string | null;
}

interface PlaybookRow {
  id: string;
  name: string;
  session_filter: string[] | null;
}

interface Cell {
  context: Record<string, string>;
  n: number;
  wins: number;
  win_rate: number;
  expected_R: number;
  std_R: number;
  wilson_low: number;
  verdict: "GO" | "SKIP" | "REVIEW";
}

// ---------------- helpers ----------------

function wilsonLowerBound(wins: number, n: number, z = 1.96): number {
  if (n === 0) return 0;
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return Math.max(0, (center - margin) / denom);
}

function bucketTimeOfDay(iso: string): string {
  // 15-min bucket using UTC; downstream UI can re-bucket per user TZ.
  const d = new Date(iso);
  const h = d.getUTCHours();
  const m = Math.floor(d.getUTCMinutes() / 15) * 15;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function normalizeValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    const t = v.trim();
    return t.length === 0 ? null : t;
  }
  if (Array.isArray(v)) {
    const items = v.map(String).filter((s) => s.length > 0).sort();
    return items.length ? items.join("|") : null;
  }
  return null;
}

// The state labeller — the only piece swapped from the original skill.
function labelTrade(
  trade: TradeRow,
  feature: FeatureRow | undefined,
  review: ReviewRow | undefined
): Record<string, string> {
  const ctx: Record<string, string> = {};
  if (trade.session) ctx.session = trade.session;
  if (trade.playbook_id) ctx.playbook_id = trade.playbook_id;
  if (trade.direction) ctx.direction = trade.direction;
  if (feature?.htf_bias) ctx.htf_bias = feature.htf_bias;
  if (feature?.volatility_regime) ctx.volatility_regime = feature.volatility_regime;
  if (review?.regime) ctx.regime = review.regime;
  ctx.time_bucket = bucketTimeOfDay(trade.entry_time);

  // Auto-discover custom_fields dimensions
  if (trade.custom_fields && typeof trade.custom_fields === "object") {
    for (const [k, v] of Object.entries(trade.custom_fields)) {
      const norm = normalizeValue(v);
      if (norm !== null) ctx[`cf_${k}`] = norm;
    }
  }
  return ctx;
}

function contextKey(ctx: Record<string, string>): string {
  return Object.keys(ctx)
    .sort()
    .map((k) => `${k}=${ctx[k]}`)
    .join("|");
}

function buildCells(
  labelled: Array<{ ctx: Record<string, string>; r: number }>,
  dimensions: string[]
): Cell[] {
  // Group by full-context key on detected dimensions
  const groups = new Map<string, { ctx: Record<string, string>; rs: number[] }>();
  for (const { ctx, r } of labelled) {
    const trimmed: Record<string, string> = {};
    for (const d of dimensions) if (ctx[d] !== undefined) trimmed[d] = ctx[d];
    const key = contextKey(trimmed);
    if (!key) continue;
    const g = groups.get(key) ?? { ctx: trimmed, rs: [] };
    g.rs.push(r);
    groups.set(key, g);
  }

  const cells: Cell[] = [];
  for (const { ctx, rs } of groups.values()) {
    const n = rs.length;
    const wins = rs.filter((r) => r > 0).length;
    const win_rate = n ? wins / n : 0;
    const expected_R = n ? rs.reduce((s, r) => s + r, 0) / n : 0;
    const variance = n > 1 ? rs.reduce((s, r) => s + (r - expected_R) ** 2, 0) / (n - 1) : 0;
    const std_R = Math.sqrt(variance);
    const wilson_low = wilsonLowerBound(wins, n);
    cells.push({
      context: ctx,
      n,
      wins,
      win_rate,
      expected_R,
      std_R,
      wilson_low,
      verdict: "REVIEW",
    });
  }
  return cells;
}

function applyVerdict(cells: Cell[], mode: Mode) {
  const nMin = mode === "conservative" ? 20 : 8;
  for (const c of cells) {
    if (mode === "conservative") {
      if (c.n >= nMin && c.wilson_low > 0 && c.expected_R > 0) c.verdict = "GO";
      else if (c.n >= nMin && c.expected_R < 0) c.verdict = "SKIP";
      else c.verdict = "REVIEW";
    } else {
      if (c.n >= nMin && c.expected_R > 0) c.verdict = "GO";
      else if (c.n >= nMin && c.expected_R < 0) c.verdict = "SKIP";
      else c.verdict = "REVIEW";
    }
  }
}

// Suggest which still-unused dimension would most reduce variance of top
// playbook cells. Very simple info-gain heuristic.
function suggestNextTag(
  labelled: Array<{ ctx: Record<string, string>; r: number }>,
  usedDimensions: string[],
  coverageByDim: Record<string, number>,
  maxCoverage = 0.6
): { dim: string; coverage: number } | null {
  const allDims = new Set<string>();
  for (const { ctx } of labelled) Object.keys(ctx).forEach((d) => allDims.add(d));
  const candidates = [...allDims].filter(
    (d) => !usedDimensions.includes(d) && (coverageByDim[d] ?? 0) < maxCoverage
  );
  if (candidates.length === 0) return null;

  const baselineVar = (() => {
    const rs = labelled.map((x) => x.r);
    const mu = rs.reduce((s, r) => s + r, 0) / rs.length;
    return rs.reduce((s, r) => s + (r - mu) ** 2, 0) / Math.max(1, rs.length - 1);
  })();

  let best: { dim: string; gain: number } | null = null;
  for (const dim of candidates) {
    const buckets = new Map<string, number[]>();
    for (const { ctx, r } of labelled) {
      const k = ctx[dim] ?? "__missing__";
      const arr = buckets.get(k) ?? [];
      arr.push(r);
      buckets.set(k, arr);
    }
    let weighted = 0;
    let total = 0;
    for (const rs of buckets.values()) {
      if (rs.length < 2) continue;
      const mu = rs.reduce((s, r) => s + r, 0) / rs.length;
      const v = rs.reduce((s, r) => s + (r - mu) ** 2, 0) / (rs.length - 1);
      weighted += v * rs.length;
      total += rs.length;
    }
    if (total === 0) continue;
    const condVar = weighted / total;
    const gain = baselineVar - condVar;
    if (!best || gain > best.gain) best = { dim, gain };
  }
  if (!best) return null;
  return { dim: best.dim, coverage: coverageByDim[best.dim] ?? 0 };
}

// ---------------- main analysis ----------------

async function runAnalysis(
  supabase: ReturnType<typeof createClient>,
  body: RequestBody
): Promise<Record<string, unknown>> {
  const mode: Mode = body.mode === "aggressive" ? "aggressive" : "conservative";
  const minSamples = body.min_samples ?? (mode === "conservative" ? 20 : 8);
  const lookbackDays = body.lookback_days ?? 365;
  const since = new Date(Date.now() - lookbackDays * 86400_000).toISOString();

  const tradesQuery = supabase
    .from("trades")
    .select(
      "id, symbol, direction, session, net_pnl, r_multiple_actual, entry_time, playbook_id, custom_fields"
    )
    .eq("is_open", false)
    .gte("entry_time", since)
    .order("entry_time", { ascending: false })
    .limit(1000);

  if (body.playbook_id) tradesQuery.eq("playbook_id", body.playbook_id);
  if (body.symbol) tradesQuery.eq("symbol", body.symbol);

  const { data: trades, error: tErr } = await tradesQuery;
  if (tErr) throw new Error(`trades: ${tErr.message}`);
  const tradeRows = (trades ?? []) as TradeRow[];

  if (tradeRows.length === 0) {
    return {
      mode,
      dimensions_detected: [],
      cells: [],
      coverage_pct: 0,
      suggested_next_tag: null,
      suggested_next_tag_coverage: null,
      sample_size: 0,
      message: "No closed trades in lookback window.",
    };
  }

  const tradeIds = tradeRows.map((t) => t.id);

  const [featRes, revRes, pbRes] = await Promise.all([
    supabase
      .from("trade_features")
      .select("trade_id, htf_bias, volatility_regime, time_since_session_open_mins")
      .in("trade_id", tradeIds),
    supabase
      .from("trade_reviews")
      .select("trade_id, playbook_id, regime")
      .in("trade_id", tradeIds),
    supabase.from("playbooks").select("id, name, session_filter"),
  ]);

  const featuresByTrade = new Map<string, FeatureRow>();
  for (const f of (featRes.data ?? []) as FeatureRow[]) featuresByTrade.set(f.trade_id, f);
  const reviewsByTrade = new Map<string, ReviewRow>();
  for (const r of (revRes.data ?? []) as ReviewRow[]) reviewsByTrade.set(r.trade_id, r);
  const playbooksById = new Map<string, PlaybookRow>();
  for (const p of (pbRes.data ?? []) as PlaybookRow[]) playbooksById.set(p.id, p);

  // Label
  const labelled: Array<{ ctx: Record<string, string>; r: number }> = [];
  for (const t of tradeRows) {
    const ctx = labelTrade(t, featuresByTrade.get(t.id), reviewsByTrade.get(t.id));
    // Prefer r_multiple_actual; fall back to sign(net_pnl)
    let r = t.r_multiple_actual != null ? Number(t.r_multiple_actual) : null;
    if (r == null || Number.isNaN(r)) {
      const pnl = t.net_pnl != null ? Number(t.net_pnl) : 0;
      r = pnl === 0 ? 0 : pnl > 0 ? 1 : -1;
    }
    labelled.push({ ctx, r });
  }

  // Auto-detect dimensions: keep ones with >= 2 distinct values and present on >= 30% of trades
  const dimFreq = new Map<string, Set<string>>();
  const dimCount = new Map<string, number>();
  for (const { ctx } of labelled) {
    for (const [k, v] of Object.entries(ctx)) {
      const set = dimFreq.get(k) ?? new Set<string>();
      set.add(v);
      dimFreq.set(k, set);
      dimCount.set(k, (dimCount.get(k) ?? 0) + 1);
    }
  }
  const N = labelled.length;
  const usableDims = [...dimFreq.entries()]
    .filter(([, vs]) => vs.size >= 2)
    .filter(([k]) => (dimCount.get(k) ?? 0) / N >= 0.3)
    .map(([k]) => k);

  // Greedy: build cells using all usable dims, but cap depth to avoid sparsity
  const MAX_DEPTH = 4;
  // Rank dims by entropy * coverage to choose top MAX_DEPTH
  const ranked = usableDims
    .map((d) => {
      const counts = new Map<string, number>();
      for (const { ctx } of labelled) {
        const v = ctx[d];
        if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      const total = [...counts.values()].reduce((s, x) => s + x, 0);
      const entropy = [...counts.values()].reduce((s, c) => {
        const p = c / total;
        return s - (p > 0 ? p * Math.log2(p) : 0);
      }, 0);
      return { d, entropy, coverage: total / N };
    })
    .sort((a, b) => b.entropy * b.coverage - a.entropy * a.coverage)
    .slice(0, MAX_DEPTH)
    .map((x) => x.d);

  const cells = buildCells(labelled, ranked);
  applyVerdict(cells, mode);

  // Attach playbook names for nicer rendering
  for (const c of cells) {
    if (c.context.playbook_id) {
      const pb = playbooksById.get(c.context.playbook_id);
      if (pb) c.context.playbook = pb.name;
    }
  }

  const confidentN = cells
    .filter((c) => c.n >= minSamples)
    .reduce((s, c) => s + c.n, 0);
  const coverage_pct = N ? (confidentN / N) * 100 : 0;

  const suggested_next_tag = suggestNextTag(labelled, ranked);

  // Sort: GO first, then expected_R desc
  cells.sort((a, b) => {
    const order = { GO: 0, REVIEW: 1, SKIP: 2 } as const;
    if (order[a.verdict] !== order[b.verdict]) return order[a.verdict] - order[b.verdict];
    return b.expected_R - a.expected_R;
  });

  return {
    mode,
    sample_size: N,
    dimensions_detected: ranked,
    cells,
    coverage_pct: Number(coverage_pct.toFixed(1)),
    suggested_next_tag,
  };
}

async function runLookup(
  supabase: ReturnType<typeof createClient>,
  body: RequestBody
): Promise<Record<string, unknown>> {
  const report = (await runAnalysis(supabase, body)) as {
    cells: Cell[];
    mode: Mode;
  };
  const target = body.context ?? {};
  const targetKeys = Object.keys(target);

  let best: Cell | null = null;
  let bestMatches = -1;
  for (const c of report.cells) {
    const matches = targetKeys.filter((k) => c.context[k] === target[k]).length;
    if (matches > bestMatches && matches > 0) {
      best = c;
      bestMatches = matches;
    }
  }

  return {
    mode: report.mode,
    query: target,
    match: best,
    matched_keys: bestMatches,
  };
}

// ---------------- HTTP ----------------

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
      error: uErr,
    } = await supabase.auth.getUser();
    if (uErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json().catch(() => ({}))) as RequestBody & { op?: string };
    const result =
      body.op === "lookup" ? await runLookup(supabase, body) : await runAnalysis(supabase, body);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("scalp-edge-analysis error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
