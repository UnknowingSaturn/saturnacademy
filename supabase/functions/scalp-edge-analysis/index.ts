// Scalp Edge Analysis
// Adapts the markov-hedge-fund-method state-labeller to user-journaled trades.
//
// Output shape (v2 — backward compatible):
//   - cells: joint-context cells with sample size, win rate, expected R, Wilson
//     lower bound, GO/SKIP/REVIEW verdict, plus shrunk E[R] + confidence chip
//     for low-sample cells.
//   - marginals: per-dimension single-tag stats — always emitted so users with
//     small samples still get actionable signal even when joint cells are empty.
//   - joint_coverage_pct / marginal_coverage_pct: honest two-number coverage.
//   - suggestion: smart "coarsen / complete / none" recommendation.
//
// Legacy fields (`coverage_pct`, `suggested_next_tag`, `suggested_next_tag_coverage`)
// are preserved so existing consumers (strategy-lab summarizer, older UI) keep
// rendering.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Mode = "conservative" | "aggressive";
type Confidence = "high" | "moderate" | "low";

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
  expected_R_shrunk: number;
  std_R: number;
  wilson_low: number;
  verdict: "GO" | "SKIP" | "REVIEW";
  confidence: Confidence;
}

interface MarginalValue {
  value: string;
  n: number;
  wins: number;
  win_rate: number;
  expected_R: number;
  expected_R_shrunk: number;
  wilson_low: number;
  verdict: "GO" | "SKIP" | "REVIEW";
  confidence: Confidence;
}

interface Marginal {
  dim: string;
  values: MarginalValue[];
}

interface Suggestion {
  kind: "coarsen" | "complete" | "none";
  dim: string | null;
  reason: string;
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

function sessionPhase(mins: number | null | undefined): string | null {
  if (mins == null || Number.isNaN(mins)) return null;
  if (mins < 60) return "open";
  if (mins < 180) return "mid";
  return "late";
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

// State labeller — drops `time_bucket` (cardinality 96 was starving cells);
// uses `session_phase` (open / mid / late) instead.
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
  const phase = sessionPhase(feature?.time_since_session_open_mins ?? null);
  if (phase) ctx.session_phase = phase;

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

function classifyConfidence(n: number, minN: number): Confidence {
  if (n >= minN) return "high";
  if (n >= Math.ceil(minN / 2)) return "moderate";
  return "low";
}

function shrunkR(rs: number[], globalMeanR: number, minN: number): number {
  const n = rs.length;
  if (n === 0) return globalMeanR;
  const sum = rs.reduce((s, r) => s + r, 0);
  return (sum + minN * globalMeanR) / (n + minN);
}

function verdictFor(
  n: number,
  wins: number,
  expectedR: number,
  wilsonLow: number,
  mode: Mode,
  minN: number
): "GO" | "SKIP" | "REVIEW" {
  if (mode === "conservative") {
    if (n >= minN && wilsonLow > 0 && expectedR > 0) return "GO";
    if (n >= minN && expectedR < 0) return "SKIP";
    return "REVIEW";
  }
  if (n >= minN && expectedR > 0) return "GO";
  if (n >= minN && expectedR < 0) return "SKIP";
  return "REVIEW";
}

// Coarsen `cf_*` values that appear on <10% of trades into `other`. Keeps the
// dim usable instead of fragmenting it into singleton buckets.
function coarsenSparseCustomFields(
  labelled: Array<{ ctx: Record<string, string>; r: number }>,
  minShare = 0.1
): void {
  const N = labelled.length;
  if (N === 0) return;
  const dimValueCounts = new Map<string, Map<string, number>>();
  for (const { ctx } of labelled) {
    for (const [k, v] of Object.entries(ctx)) {
      if (!k.startsWith("cf_")) continue;
      const inner = dimValueCounts.get(k) ?? new Map<string, number>();
      inner.set(v, (inner.get(v) ?? 0) + 1);
      dimValueCounts.set(k, inner);
    }
  }
  const threshold = Math.max(2, Math.ceil(N * minShare));
  for (const { ctx } of labelled) {
    for (const k of Object.keys(ctx)) {
      if (!k.startsWith("cf_")) continue;
      const counts = dimValueCounts.get(k);
      if (!counts) continue;
      const c = counts.get(ctx[k]) ?? 0;
      if (c < threshold) ctx[k] = "other";
    }
  }
}

function buildCells(
  labelled: Array<{ ctx: Record<string, string>; r: number }>,
  dimensions: string[],
  globalMeanR: number,
  minN: number,
  mode: Mode
): Cell[] {
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
    const expected_R_shrunk = shrunkR(rs, globalMeanR, minN);
    const variance = n > 1 ? rs.reduce((s, r) => s + (r - expected_R) ** 2, 0) / (n - 1) : 0;
    const std_R = Math.sqrt(variance);
    const wilson_low = wilsonLowerBound(wins, n);
    cells.push({
      context: ctx,
      n,
      wins,
      win_rate,
      expected_R,
      expected_R_shrunk,
      std_R,
      wilson_low,
      verdict: verdictFor(n, wins, expected_R, wilson_low, mode, minN),
      confidence: classifyConfidence(n, minN),
    });
  }
  return cells;
}

function buildMarginals(
  labelled: Array<{ ctx: Record<string, string>; r: number }>,
  dimensions: string[],
  globalMeanR: number,
  minN: number,
  mode: Mode
): Marginal[] {
  const result: Marginal[] = [];
  for (const dim of dimensions) {
    const buckets = new Map<string, number[]>();
    let winsByVal = new Map<string, number>();
    for (const { ctx, r } of labelled) {
      const v = ctx[dim];
      if (v === undefined) continue;
      const arr = buckets.get(v) ?? [];
      arr.push(r);
      buckets.set(v, arr);
      if (r > 0) winsByVal.set(v, (winsByVal.get(v) ?? 0) + 1);
    }
    const values: MarginalValue[] = [];
    for (const [value, rs] of buckets.entries()) {
      const n = rs.length;
      const wins = winsByVal.get(value) ?? 0;
      const win_rate = n ? wins / n : 0;
      const expected_R = n ? rs.reduce((s, r) => s + r, 0) / n : 0;
      const expected_R_shrunk = shrunkR(rs, globalMeanR, minN);
      const wilson_low = wilsonLowerBound(wins, n);
      values.push({
        value,
        n,
        wins,
        win_rate,
        expected_R,
        expected_R_shrunk,
        wilson_low,
        verdict: verdictFor(n, wins, expected_R, wilson_low, mode, minN),
        confidence: classifyConfidence(n, minN),
      });
    }
    // sort: GO > REVIEW > SKIP, then |E[R]| desc
    values.sort((a, b) => {
      const order = { GO: 0, REVIEW: 1, SKIP: 2 } as const;
      if (order[a.verdict] !== order[b.verdict]) return order[a.verdict] - order[b.verdict];
      return Math.abs(b.expected_R) - Math.abs(a.expected_R);
    });
    if (values.length > 0) result.push({ dim, values });
  }
  // Order dims by "useful spread": max |E[R]| difference between any two high-conf values
  result.sort((a, b) => {
    const spread = (m: Marginal) => {
      const hi = m.values.filter((v) => v.confidence !== "low").map((v) => v.expected_R);
      if (hi.length < 2) return 0;
      return Math.max(...hi) - Math.min(...hi);
    };
    return spread(b) - spread(a);
  });
  return result;
}

// Rank dims by statistical *power*: how much confident-mass each candidate
// dim would carve out, weighted by how much its values separate from the
// global mean. Falls back to entropy×coverage when nothing scores.
function rankDimensionsByPower(
  labelled: Array<{ ctx: Record<string, string>; r: number }>,
  candidates: string[],
  globalMeanR: number,
  minN: number
): string[] {
  type Scored = { dim: string; score: number; cardinality: number; coverage: number };
  const scored: Scored[] = [];
  const N = labelled.length;

  for (const dim of candidates) {
    const buckets = new Map<string, number[]>();
    let presentCount = 0;
    for (const { ctx, r } of labelled) {
      const v = ctx[dim];
      if (v === undefined) continue;
      presentCount++;
      const arr = buckets.get(v) ?? [];
      arr.push(r);
      buckets.set(v, arr);
    }
    let power = 0;
    for (const rs of buckets.values()) {
      if (rs.length < minN) continue;
      const mu = rs.reduce((s, x) => s + x, 0) / rs.length;
      power += rs.length * Math.abs(mu - globalMeanR);
    }
    scored.push({
      dim,
      score: power,
      cardinality: buckets.size,
      coverage: N ? presentCount / N : 0,
    });
  }

  const positivePower = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  if (positivePower.length > 0) return positivePower.map((s) => s.dim);

  // Fallback: entropy × coverage (original behaviour)
  return scored
    .map((s) => {
      const entropy = Math.log2(Math.max(1, s.cardinality)); // proxy
      return { dim: s.dim, key: entropy * s.coverage };
    })
    .sort((a, b) => b.key - a.key)
    .map((s) => s.dim);
}

function chooseAdaptiveDepth(
  rankedDims: string[],
  cardinalityByDim: Map<string, number>,
  N: number,
  minN: number
): string[] {
  if (rankedDims.length === 0) return [];
  const targetCells = Math.max(3, Math.floor(N / minN));
  const cap = targetCells * 2;
  let product = 1;
  const chosen: string[] = [];
  for (const d of rankedDims) {
    const c = cardinalityByDim.get(d) ?? 2;
    const next = product * c;
    if (chosen.length > 0 && next > cap) break;
    chosen.push(d);
    product = next;
    if (chosen.length >= 4) break; // hard cap
  }
  return chosen;
}

function buildSuggestion(
  labelled: Array<{ ctx: Record<string, string>; r: number }>,
  allDims: string[],
  usedDims: string[],
  coverageByDim: Record<string, number>,
  cardinalityByDim: Map<string, number>,
  marginals: Marginal[],
  minN: number
): Suggestion {
  const marginalsByDim = new Map(marginals.map((m) => [m.dim, m]));

  // Coarsen candidate: any well-populated dim that fragments without separating
  for (const dim of allDims) {
    const cov = coverageByDim[dim] ?? 0;
    const card = cardinalityByDim.get(dim) ?? 0;
    if (cov < 0.6 || card < 6) continue;
    const m = marginalsByDim.get(dim);
    if (!m) continue;
    const hi = m.values.filter((v) => v.confidence !== "low").map((v) => v.expected_R);
    const spread = hi.length >= 2 ? Math.max(...hi) - Math.min(...hi) : 0;
    if (spread < 0.3) {
      return {
        kind: "coarsen",
        dim,
        reason: `${card} distinct values on ${Math.round(cov * 100)}% of trades but expected-R spread is only ${spread.toFixed(2)}R. Collapse into 3 buckets.`,
      };
    }
  }

  // Complete candidate: under-populated dim whose present values already separate
  for (const dim of allDims) {
    if (usedDims.includes(dim)) continue;
    const cov = coverageByDim[dim] ?? 0;
    if (cov >= 0.6 || cov < 0.05) continue;
    const m = marginalsByDim.get(dim);
    if (!m) continue;
    const maxAbs = Math.max(...m.values.map((v) => Math.abs(v.expected_R)), 0);
    if (maxAbs >= 0.4) {
      return {
        kind: "complete",
        dim,
        reason: `Only ${Math.round(cov * 100)}% of trades tagged but separation looks real (|E[R]| up to ${maxAbs.toFixed(2)}R). Tag more trades with this.`,
      };
    }
  }

  return { kind: "none", dim: null, reason: "No obvious gap — keep journaling to grow sample size." };
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
      marginals: [],
      coverage_pct: 0,
      joint_coverage_pct: 0,
      marginal_coverage_pct: 0,
      suggested_next_tag: null,
      suggested_next_tag_coverage: null,
      suggestion: { kind: "none", dim: null, reason: "No closed trades in lookback window." } satisfies Suggestion,
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
    let r = t.r_multiple_actual != null ? Number(t.r_multiple_actual) : null;
    if (r == null || Number.isNaN(r)) {
      const pnl = t.net_pnl != null ? Number(t.net_pnl) : 0;
      r = pnl === 0 ? 0 : pnl > 0 ? 1 : -1;
    }
    labelled.push({ ctx, r });
  }

  // Coarsen sparse cf_* values BEFORE computing freq / marginals
  coarsenSparseCustomFields(labelled, 0.1);

  // Dimension stats
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
  const globalMeanR = labelled.reduce((s, x) => s + x.r, 0) / Math.max(1, N);
  const cardinalityByDim = new Map<string, number>();
  for (const [k, vs] of dimFreq.entries()) cardinalityByDim.set(k, vs.size);

  const usableDims = [...dimFreq.entries()]
    .filter(([, vs]) => vs.size >= 2)
    .filter(([k]) => (dimCount.get(k) ?? 0) / N >= 0.3)
    .map(([k]) => k);

  // Rank by power, then adaptive depth
  const ranked = rankDimensionsByPower(labelled, usableDims, globalMeanR, minSamples);
  const chosenDims = chooseAdaptiveDepth(ranked, cardinalityByDim, N, minSamples);

  // Joint cells
  const cells = buildCells(labelled, chosenDims, globalMeanR, minSamples, mode);

  // Marginals — always computed over ALL usable dims, not just the chosen joint dims
  const marginals = buildMarginals(labelled, usableDims, globalMeanR, minSamples, mode);

  // Resolve playbook names for friendlier rendering
  for (const c of cells) {
    if (c.context.playbook_id) {
      const pb = playbooksById.get(c.context.playbook_id);
      if (pb) c.context.playbook = pb.name;
    }
  }
  for (const m of marginals) {
    if (m.dim === "playbook_id") {
      for (const v of m.values) {
        const pb = playbooksById.get(v.value);
        if (pb) v.value = pb.name;
      }
    }
  }

  // Coverage — two honest numbers
  const confidentJointN = cells
    .filter((c) => c.n >= minSamples)
    .reduce((s, c) => s + c.n, 0);
  const joint_coverage_pct = N ? (confidentJointN / N) * 100 : 0;

  const tradesCoveredByAnyHighMarginal = (() => {
    const highValuesByDim = new Map<string, Set<string>>();
    for (const m of marginals) {
      const set = new Set<string>();
      for (const v of m.values) if (v.confidence === "high") set.add(v.value);
      if (set.size > 0) highValuesByDim.set(m.dim, set);
    }
    let covered = 0;
    for (const { ctx } of labelled) {
      let hit = false;
      for (const [dim, set] of highValuesByDim.entries()) {
        const cv = ctx[dim];
        if (cv !== undefined && set.has(dim === "playbook_id" ? (playbooksById.get(cv)?.name ?? cv) : cv)) {
          hit = true;
          break;
        }
      }
      if (hit) covered++;
    }
    return covered;
  })();
  const marginal_coverage_pct = N ? (tradesCoveredByAnyHighMarginal / N) * 100 : 0;

  const coverageByDim: Record<string, number> = {};
  for (const [k, count] of dimCount.entries()) coverageByDim[k] = N ? count / N : 0;

  const suggestion = buildSuggestion(
    labelled,
    usableDims,
    chosenDims,
    coverageByDim,
    cardinalityByDim,
    marginals,
    minSamples
  );

  // Sort cells: GO first, then expected_R desc
  cells.sort((a, b) => {
    const order = { GO: 0, REVIEW: 1, SKIP: 2 } as const;
    if (order[a.verdict] !== order[b.verdict]) return order[a.verdict] - order[b.verdict];
    return b.expected_R - a.expected_R;
  });

  return {
    mode,
    sample_size: N,
    dimensions_detected: chosenDims,
    cells,
    marginals,
    coverage_pct: Number(joint_coverage_pct.toFixed(1)), // legacy alias
    joint_coverage_pct: Number(joint_coverage_pct.toFixed(1)),
    marginal_coverage_pct: Number(marginal_coverage_pct.toFixed(1)),
    suggestion,
    // Legacy fields for backward compat with strategy-lab summarizer / older UI
    suggested_next_tag: suggestion.dim,
    suggested_next_tag_coverage: suggestion.dim ? (coverageByDim[suggestion.dim] ?? null) : null,
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
