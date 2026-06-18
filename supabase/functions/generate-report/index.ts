// Generate a Sensei trading report for a given user/period.
// Computes deterministic metrics + clusters + psychology, then calls Lovable AI
// with strict tool-calling for the narrative section. Anti-hallucination: every
// LLM-cited trade ID is validated against the input set.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { resolvePairLabFieldKeys, buildBuckets, type BucketReport, type PropFirmContext } from "../_shared/quant/pairLabMath.ts";
import { replayAllPresets, MIN_ELIGIBLE_SAMPLE, type PresetReplayResult } from "../_shared/quant/pairLabSimulator.ts";

const BANNED_PHRASES = [
  "stay disciplined",
  "trust the process",
  "manage risk",
  "you got this",
  "trading is a journey",
  "consistency is key",
  "let your winners run",
  "cut your losses",
  "trust your edge",
  "stick to the plan",
  "patience is a virtue",
  "the market is always right",
  "considerable decline",
  "substantial negative",
  "needs improvement",
  "indicating a need for",
  "review trades like",
  "for entry optimizations",
  "moving forward",
  "going forward",
  "in conclusion",
  "overall performance",
  "based on my analysis",
];

const BANNED_OPENERS = [
  "your total r was",
  "this period saw",
  "it is observed that",
  "this week saw",
  "this month saw",
  "during this period",
  "overall, ",
  "in summary",
];

// Humanize raw labels for the LLM so it never parrots `new_york_am · XAGUSD · unknown (No playbook)`.
const SESSION_NAMES: Record<string, string> = {
  tokyo: "Tokyo",
  london: "London",
  new_york: "NY",
  new_york_am: "NY-AM",
  new_york_pm: "NY-PM",
  overlap_london_ny: "London/NY overlap",
  off_hours: "off-hours",
  unknown: "untagged session",
};

const SYMBOL_NICKNAMES: Record<string, string> = {
  XAUUSD: "Gold",
  XAGUSD: "Silver",
  US30: "Dow",
  NAS100: "Nasdaq",
  SPX500: "S&P",
  SP500: "S&P",
  GER40: "DAX",
  UK100: "FTSE",
  BTCUSD: "Bitcoin",
  ETHUSD: "Ethereum",
};

function humanSession(s: string | null | undefined): string {
  if (!s) return "untagged session";
  return SESSION_NAMES[s] ?? s.replace(/_/g, " ");
}
function humanSymbol(s: string): string {
  return SYMBOL_NICKNAMES[s.toUpperCase()] ?? s;
}
function humanizeClusterLabel(session: string, symbol: string, emotion: string, playbook: string): string {
  const parts = [humanSession(session), humanSymbol(symbol)];
  if (emotion && emotion !== "unknown") parts.push(`feeling ${emotion}`);
  if (playbook && playbook !== "No playbook" && playbook !== "Unnamed") parts.push(`playbook "${playbook}"`);
  return parts.join(", ");
}
function formatClock(iso: string): string {
  const d = new Date(iso);
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}
function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// ------------------------------ helpers ------------------------------

function safeDiv(a: number, b: number, fallback = 0) { return b === 0 ? fallback : a / b; }
function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

interface TradeRow {
  id: string;
  trade_number: number | null;
  symbol: string;
  direction: string;
  entry_time: string;
  exit_time: string | null;
  net_pnl: number | null;
  r_multiple_actual: number | null;
  risk_percent: number | null;
  session: string | null;
  playbook_id: string | null;
  is_open: boolean | null;
  trade_type: string;
  total_lots: number;
  actual_playbook_id?: string | null;
  actual_profile?: string | null;
  actual_regime?: string | null;
  profile?: string | null;
}

interface ReviewRow {
  trade_id: string;
  emotional_state_before: string | null;
  emotional_state_after: string | null;
  psychology_notes: string | null;
  thoughts: string | null;
  mistakes: any;
  did_well: any;
  to_improve: any;
  checklist_answers: any;
  playbook_id: string | null;
  score: number | null;
  regime: string | null;
}

function tradeRef(t: TradeRow) {
  return {
    id: t.id,
    trade_number: t.trade_number,
    symbol: t.symbol,
    date: t.entry_time,
    net_pnl: t.net_pnl,
    r: t.r_multiple_actual,
  };
}

// ------------------------------ metrics block ------------------------------

function metricsBlock(trades: TradeRow[], reviews: Map<string, ReviewRow>) {
  const closed = trades.filter(t => !t.is_open && t.trade_type === 'executed');
  const wins = closed.filter(t => (t.net_pnl ?? 0) > 0);
  const losses = closed.filter(t => (t.net_pnl ?? 0) < 0);
  const total_pnl = closed.reduce((s, t) => s + (t.net_pnl ?? 0), 0);
  const total_r = closed.reduce((s, t) => s + (t.r_multiple_actual ?? 0), 0);
  const win_pnl = wins.reduce((s, t) => s + (t.net_pnl ?? 0), 0);
  const loss_pnl = Math.abs(losses.reduce((s, t) => s + (t.net_pnl ?? 0), 0));
  const win_r = wins.reduce((s, t) => s + (t.r_multiple_actual ?? 0), 0);
  const loss_r = Math.abs(losses.reduce((s, t) => s + (t.r_multiple_actual ?? 0), 0));

  // running drawdown in R
  const sorted = [...closed].sort((a, b) => a.entry_time.localeCompare(b.entry_time));
  let peak = 0, equity = 0, maxDD = 0;
  for (const t of sorted) {
    equity += (t.r_multiple_actual ?? 0);
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }

  const reviewed = closed.filter(t => reviews.has(t.id));
  let compliance: number | null = null;
  if (reviewed.length > 0) {
    let totalQs = 0, satisfied = 0;
    for (const t of reviewed) {
      const r = reviews.get(t.id)!;
      const ans = r.checklist_answers && typeof r.checklist_answers === "object" ? r.checklist_answers : {};
      const keys = Object.keys(ans);
      totalQs += keys.length;
      satisfied += keys.filter(k => ans[k] === true || ans[k] === "yes").length;
    }
    if (totalQs > 0) compliance = (satisfied / totalQs) * 100;
  }

  const risks = closed.map(t => t.risk_percent).filter((x): x is number => x != null);

  return {
    total_pnl,
    total_r,
    trade_count: closed.length,
    win_rate: safeDiv(wins.length, closed.length) * 100,
    profit_factor: safeDiv(win_pnl, loss_pnl, win_pnl > 0 ? Infinity : 0),
    expectancy_r: safeDiv(total_r, closed.length),
    max_drawdown_r: maxDD,
    checklist_compliance_pct: compliance,
    avg_winner_r: safeDiv(win_r, wins.length),
    avg_loser_r: -safeDiv(loss_r, losses.length),
    avg_risk_pct: risks.length ? risks.reduce((a, b) => a + b, 0) / risks.length : null,
  };
}

// ------------------------------ clusters ------------------------------

function emotionFor(t: TradeRow, reviews: Map<string, ReviewRow>): string {
  const r = reviews.get(t.id);
  return (r?.emotional_state_before || "unknown").toLowerCase();
}

function clusterTrades(trades: TradeRow[], reviews: Map<string, ReviewRow>, playbookNames: Map<string, string>) {
  const closed = trades.filter(t => !t.is_open && t.trade_type === 'executed');
  const map = new Map<string, TradeRow[]>();
  for (const t of closed) {
    const playbook = t.playbook_id ? (playbookNames.get(t.playbook_id) || 'Unnamed') : 'No playbook';
    const session = t.session || 'unknown';
    const emotion = emotionFor(t, reviews);
    const key = `${session}|${t.symbol}|${emotion}|${playbook}`;
    const arr = map.get(key) ?? [];
    arr.push(t);
    map.set(key, arr);
  }

  const edges: any[] = [];
  const leakClusters: any[] = [];
  for (const [key, ts] of map) {
    if (ts.length < 3) continue;
    const [session, symbol, emotion, playbook] = key.split('|');
    const wins = ts.filter(t => (t.net_pnl ?? 0) > 0).length;
    const total_r = ts.reduce((s, t) => s + (t.r_multiple_actual ?? 0), 0);
    const total_pnl = ts.reduce((s, t) => s + (t.net_pnl ?? 0), 0);
    const expectancy_r = total_r / ts.length;
    const cluster = {
      label: humanizeClusterLabel(session, symbol, emotion, playbook),
      dimensions: { session, symbol, emotion, playbook },
      trades: ts.length,
      wins,
      total_r,
      total_pnl,
      expectancy_r,
      trade_ids: ts.map(t => t.id),
      trade_refs: ts.map(tradeRef),
    };
    if (expectancy_r > 0.2) edges.push(cluster);
    if (expectancy_r < -0.2) leakClusters.push({
      ...cluster,
      pattern_type: 'cluster',
      description: `Cluster underperformed: avg ${expectancy_r.toFixed(2)}R across ${ts.length} trades`,
      worst_offender: tradeRef([...ts].sort((a, b) => (a.r_multiple_actual ?? 0) - (b.r_multiple_actual ?? 0))[0]),
    });
  }
  edges.sort((a, b) => b.expectancy_r * b.trades - a.expectancy_r * a.trades);
  leakClusters.sort((a, b) => a.expectancy_r * a.trades - b.expectancy_r * b.trades);
  return { edges: edges.slice(0, 5), clusterLeaks: leakClusters.slice(0, 5) };
}

// ------------------------------ behavioral leaks ------------------------------

function behavioralLeaks(trades: TradeRow[]): any[] {
  const closed = [...trades.filter(t => !t.is_open && t.trade_type === 'executed')]
    .sort((a, b) => a.entry_time.localeCompare(b.entry_time));
  const leaks: any[] = [];

  // Revenge: trades opened within 30 min of a prior loss
  const revenge: TradeRow[] = [];
  for (let i = 1; i < closed.length; i++) {
    const prev = closed[i - 1];
    if ((prev.net_pnl ?? 0) >= 0) continue;
    const gap = (new Date(closed[i].entry_time).getTime() - new Date(prev.exit_time || prev.entry_time).getTime()) / 60000;
    if (gap >= 0 && gap <= 30) revenge.push(closed[i]);
  }
  if (revenge.length >= 3) {
    const wins = revenge.filter(t => (t.net_pnl ?? 0) > 0).length;
    const total_r = revenge.reduce((s, t) => s + (t.r_multiple_actual ?? 0), 0);
    const total_pnl = revenge.reduce((s, t) => s + (t.net_pnl ?? 0), 0);
    leaks.push({
      label: `Revenge entries within 30 minutes of a loss`,
      pattern_type: 'revenge',
      description: `${revenge.length} trades opened within 30 minutes of a prior loss. ${wins} wins, ${(total_r).toFixed(1)}R total.`,
      trades: revenge.length,
      wins,
      total_r,
      total_pnl,
      trade_ids: revenge.map(t => t.id),
      trade_refs: revenge.map(tradeRef),
      worst_offender: tradeRef([...revenge].sort((a, b) => (a.r_multiple_actual ?? 0) - (b.r_multiple_actual ?? 0))[0]),
    });
  }

  // Oversize: risk_percent > 1.5x median for that user (within window)
  const risks = closed.map(t => t.risk_percent).filter((x): x is number => x != null).sort((a, b) => a - b);
  if (risks.length >= 5) {
    const median = risks[Math.floor(risks.length / 2)];
    const oversize = closed.filter(t => (t.risk_percent ?? 0) > median * 1.5);
    if (oversize.length >= 3) {
      const total_r = oversize.reduce((s, t) => s + (t.r_multiple_actual ?? 0), 0);
      const total_pnl = oversize.reduce((s, t) => s + (t.net_pnl ?? 0), 0);
      const wins = oversize.filter(t => (t.net_pnl ?? 0) > 0).length;
      leaks.push({
        label: `Oversized positions (>1.5× your median risk)`,
        pattern_type: 'oversize',
        description: `${oversize.length} trades sized at >1.5× your median ${median.toFixed(2)}% risk. ${total_r.toFixed(1)}R outcome.`,
        trades: oversize.length, wins, total_r, total_pnl,
        trade_ids: oversize.map(t => t.id),
        trade_refs: oversize.map(tradeRef),
        worst_offender: tradeRef([...oversize].sort((a, b) => (a.r_multiple_actual ?? 0) - (b.r_multiple_actual ?? 0))[0]),
      });
    }
  }

  return leaks;
}

// ------------------------------ consistency ------------------------------

function consistencyAudit(trades: TradeRow[], baselineTradesPerDay: number) {
  const closed = trades.filter(t => !t.is_open && t.trade_type === 'executed');
  const bySession = new Map<string, number[]>();
  for (const t of closed) {
    const s = t.session || 'unknown';
    const h = new Date(t.entry_time).getUTCHours();
    const arr = bySession.get(s) ?? [];
    arr.push(h);
    bySession.set(s, arr);
  }
  const entry_hour_stddev_per_session: Record<string, number> = {};
  const flagged_sessions: string[] = [];
  for (const [s, hs] of bySession) {
    const sd = stddev(hs);
    entry_hour_stddev_per_session[s] = +sd.toFixed(2);
    if (hs.length >= 4 && sd > 2) flagged_sessions.push(s);
  }

  // HHI on symbols
  const counts = new Map<string, number>();
  for (const t of closed) counts.set(t.symbol, (counts.get(t.symbol) ?? 0) + 1);
  const total = closed.length || 1;
  let hhi = 0;
  let topSym: string | null = null;
  let topShare = 0;
  for (const [sym, c] of counts) {
    const s = c / total;
    hhi += s * s;
    if (s > topShare) { topShare = s; topSym = sym; }
  }

  const risks = closed.map(t => t.risk_percent).filter((x): x is number => x != null);
  const risk_pct_stddev = +stddev(risks).toFixed(3);

  // frequency drift: trades/day in this window vs baseline
  const days = new Set(closed.map(t => t.entry_time.slice(0, 10))).size || 1;
  const tpd = closed.length / days;
  const drift_ratio = baselineTradesPerDay > 0 ? tpd / baselineTradesPerDay : 1;

  return {
    time_discipline: { entry_hour_stddev_per_session, flagged_sessions },
    pair_concentration: {
      hhi: +hhi.toFixed(3),
      top_symbol: topSym,
      top_symbol_share: +topShare.toFixed(3),
      flagged: hhi > 0.5,
    },
    risk_consistency: {
      risk_pct_stddev,
      flagged: risks.length >= 5 && risk_pct_stddev > 0.5,
      sample_size: risks.length,
    },
    frequency_drift: {
      trades_per_day: +tpd.toFixed(2),
      baseline_trades_per_day: +baselineTradesPerDay.toFixed(2),
      drift_ratio: +drift_ratio.toFixed(2),
      flagged: drift_ratio > 1.4 || drift_ratio < 0.6,
    },
  };
}

// ------------------------------ psychology ------------------------------

function lemma(s: string): string {
  return s.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

function asArray(x: any): string[] {
  if (!x) return [];
  if (Array.isArray(x)) return x.map(item => typeof item === 'string' ? item : (item?.text || item?.content || '')).filter(Boolean);
  if (typeof x === 'string') return [x];
  return [];
}

function psychologyAnalysis(trades: TradeRow[], reviews: Map<string, ReviewRow>) {
  const closed = trades.filter(t => !t.is_open && t.trade_type === 'executed');
  const emotionTrades = new Map<string, TradeRow[]>();
  for (const t of closed) {
    const r = reviews.get(t.id);
    const e = r?.emotional_state_before;
    if (!e) continue;
    const arr = emotionTrades.get(e) ?? [];
    arr.push(t);
    emotionTrades.set(e, arr);
  }
  const top_emotions = Array.from(emotionTrades.entries())
    .map(([state, ts]) => ({
      state,
      count: ts.length,
      avg_r: ts.reduce((s, t) => s + (t.r_multiple_actual ?? 0), 0) / ts.length,
      sample_size_ok: ts.length >= 5,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const phraseCount = new Map<string, { count: number; cost_r: number; trade_ids: string[] }>();
  for (const t of closed) {
    const r = reviews.get(t.id);
    if (!r) continue;
    for (const m of asArray(r.mistakes)) {
      const key = lemma(m);
      if (key.length < 4) continue;
      const cur = phraseCount.get(key) ?? { count: 0, cost_r: 0, trade_ids: [] };
      cur.count += 1;
      cur.cost_r += (t.r_multiple_actual ?? 0);
      cur.trade_ids.push(t.id);
      phraseCount.set(key, cur);
    }
  }
  const common_mistake_phrases = Array.from(phraseCount.entries())
    .filter(([, v]) => v.count >= 2)
    .map(([phrase, v]) => ({ phrase, ...v, cost_r: +v.cost_r.toFixed(2) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const emotion_outcome_correlations = top_emotions
    .filter(e => e.sample_size_ok)
    .map(e => {
      const ts = emotionTrades.get(e.state)!;
      const wins = ts.filter(t => (t.net_pnl ?? 0) > 0).length;
      return { state: e.state, n: ts.length, win_rate: +(wins / ts.length * 100).toFixed(1), avg_r: +e.avg_r.toFixed(2) };
    });

  // Tilt sequences: consecutive losses with degrading review scores
  const sorted = [...closed].sort((a, b) => a.entry_time.localeCompare(b.entry_time));
  const tilts: any[] = [];
  let run: TradeRow[] = [];
  for (const t of sorted) {
    if ((t.net_pnl ?? 0) < 0) {
      run.push(t);
    } else {
      if (run.length >= 3) {
        tilts.push({
          started_at: run[0].entry_time,
          length: run.length,
          cumulative_r: +run.reduce((s, x) => s + (x.r_multiple_actual ?? 0), 0).toFixed(2),
          trade_ids: run.map(x => x.id),
        });
      }
      run = [];
    }
  }
  if (run.length >= 3) {
    tilts.push({
      started_at: run[0].entry_time,
      length: run.length,
      cumulative_r: +run.reduce((s, x) => s + (x.r_multiple_actual ?? 0), 0).toFixed(2),
      trade_ids: run.map(x => x.id),
    });
  }

  return {
    top_emotions: top_emotions.map(e => ({ ...e, avg_r: +e.avg_r.toFixed(2) })),
    common_mistake_phrases,
    emotion_outcome_correlations,
    tilt_sequences: tilts,
    reviewed_count: closed.filter(t => reviews.has(t.id)).length,
    unreviewed_count: closed.filter(t => !reviews.has(t.id)).length,
  };
}

// ------------------------------ schema suggestions ------------------------------

// Hardcoded set of journal fields that already exist on every trade/review and should
// never be re-suggested. Keys + their normalized labels.
const SYSTEM_FIELD_SIGNATURES: Array<{ key: string; labelTokens: string[] }> = [
  { key: "mistakes", labelTokens: ["mistake", "mistakes", "primary cause of mistake", "mistake category", "cause of mistake"] },
  { key: "did_well", labelTokens: ["did well", "what went well", "what i did well"] },
  { key: "to_improve", labelTokens: ["to improve", "what to improve"] },
  { key: "psychology_notes", labelTokens: ["psychology", "psychology notes", "mental notes"] },
  { key: "thoughts", labelTokens: ["thoughts", "trade thoughts", "notes"] },
  { key: "emotional_state_before", labelTokens: ["emotion", "emotional state", "feeling", "emotional state before", "how are you feeling"] },
  { key: "emotional_state_after", labelTokens: ["emotional state after", "feeling after"] },
  { key: "news_risk", labelTokens: ["news", "news risk", "high impact news", "news event", "red folder news"] },
  { key: "regime", labelTokens: ["regime", "market regime"] },
  { key: "score", labelTokens: ["score", "checklist score"] },
  { key: "checklist_answers", labelTokens: ["checklist", "checklist answers"] },
  { key: "session", labelTokens: ["session", "trading session"] },
  { key: "playbook_id", labelTokens: ["playbook", "setup", "model"] },
  { key: "actual_playbook_id", labelTokens: ["actual playbook", "actual setup"] },
  { key: "profile", labelTokens: ["profile", "market profile"] },
  { key: "actual_profile", labelTokens: ["actual profile"] },
];

function normalizeLabel(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildExistingFieldKeys(
  liveQuestions: any[],
  customFields: any[],
): { keys: Set<string>; labelTokens: Set<string> } {
  const keys = new Set<string>();
  const labelTokens = new Set<string>();

  // Live trade questions
  for (const q of liveQuestions || []) {
    if (!q) continue;
    if (q.id) keys.add(String(q.id));
    if (q.label) labelTokens.add(normalizeLabel(q.label));
  }

  // Custom field definitions
  for (const f of customFields || []) {
    if (!f) continue;
    if (f.key) keys.add(String(f.key));
    if (f.label) labelTokens.add(normalizeLabel(f.label));
  }

  // System fields
  for (const sig of SYSTEM_FIELD_SIGNATURES) {
    keys.add(sig.key);
    for (const t of sig.labelTokens) labelTokens.add(normalizeLabel(t));
  }

  return { keys, labelTokens };
}

function suggestionAlreadyExists(
  suggestion: any,
  existing: { keys: Set<string>; labelTokens: Set<string> },
): boolean {
  const id = suggestion?.proposed_question?.id;
  const label = suggestion?.proposed_question?.label;
  const missing = suggestion?.missing_field;
  if (id && existing.keys.has(String(id))) return true;
  if (missing && existing.keys.has(String(missing))) return true;
  if (label) {
    const norm = normalizeLabel(label);
    if (existing.labelTokens.has(norm)) return true;
    // Substring match — e.g. "Primary cause of mistake" contains "mistake"
    for (const tok of existing.labelTokens) {
      if (tok && (norm.includes(tok) || tok.includes(norm))) return true;
    }
  }
  return false;
}

function schemaSuggestions(
  trades: TradeRow[],
  reviews: Map<string, ReviewRow>,
  liveQuestions: any[],
  customFields: any[],
) {
  const closed = trades.filter(t => !t.is_open && t.trade_type === 'executed');
  const losses = closed.filter(t => (t.net_pnl ?? 0) < 0).sort((a, b) => (a.r_multiple_actual ?? 0) - (b.r_multiple_actual ?? 0));
  const worstLosses = losses.slice(0, Math.min(6, losses.length));
  const candidates: any[] = [];
  const existing = buildExistingFieldKeys(liveQuestions || [], customFields || []);

  // 1) time_since_last_trade_minutes
  if (worstLosses.length >= 3) {
    candidates.push({
      missing_field: 'time_since_last_trade_minutes',
      reason: `${worstLosses.length} of your worst losses lack timing context vs the prior trade. Capturing this would let next month's report quantify revenge patterns directly.`,
      proposed_widget: 'number',
      example_trade_ids: worstLosses.map(t => t.id),
      proposed_question: {
        id: 'time_since_last_trade_minutes',
        label: 'Minutes since your last trade',
        type: 'number',
      },
    });
  }

  // 2) mistake_category — only if user has NOT logged free-text mistakes recently
  // (mistakes already exist as a field, so this is really a *categorization* suggestion)
  const reviewedLossesWithMistakes = closed.filter(t => {
    const r = reviews.get(t.id);
    return r && asArray(r.mistakes).length > 0 && (t.net_pnl ?? 0) < 0;
  });
  if (reviewedLossesWithMistakes.length >= 3) {
    candidates.push({
      missing_field: 'mistake_category',
      reason: `You logged free-text mistakes on ${reviewedLossesWithMistakes.length} losing trades but never tagged the underlying cause. A category select lets the report attribute leaks precisely (technical vs psychological vs execution).`,
      proposed_widget: 'select',
      proposed_options: ['Technical', 'Psychological', 'Execution', 'External'],
      example_trade_ids: reviewedLossesWithMistakes.slice(0, 5).map(t => t.id),
      proposed_question: {
        id: 'mistake_category',
        label: 'Primary cause of mistake category',
        type: 'select',
        options: ['Technical', 'Psychological', 'Execution', 'External'],
      },
    });
  }

  // 3) news_risk — only if user has not added a news field yet
  const lossesWithNoNews = closed.filter(t => {
    const r = reviews.get(t.id);
    return (t.net_pnl ?? 0) < 0 && (!r || !r['news_risk' as keyof ReviewRow]);
  });
  if (lossesWithNoNews.length >= 4) {
    candidates.push({
      missing_field: 'pre_news_entry',
      reason: `${lossesWithNoNews.length} losses had no news-context tag. A simple boolean "entered within 30min of red-folder news?" would isolate this leak in future reports.`,
      proposed_widget: 'boolean',
      example_trade_ids: lossesWithNoNews.slice(0, 5).map(t => t.id),
      proposed_question: {
        id: 'pre_news_entry',
        label: 'Entered within 30 min of high-impact news?',
        type: 'boolean',
      },
    });
  }

  // Filter out anything that collides with an existing journal field
  return candidates.filter(c => !suggestionAlreadyExists(c, existing));
}

// ------------------------------ LLM call ------------------------------

function wordCount(s: string): number {
  return (s || "").trim().split(/\s+/).filter(Boolean).length;
}
function alphaRatio(s: string): number {
  if (!s) return 0;
  const letters = (s.match(/[a-zA-Z]/g) || []).length;
  return letters / s.length;
}
function rewriteVerdict(v: string): string {
  let out = (v || "").trim();
  const lower = out.toLowerCase();
  for (const opener of BANNED_OPENERS) {
    if (lower.startsWith(opener)) {
      // strip the opener and capitalise the next clause
      out = out.slice(opener.length).replace(/^[\s,:-]+/, "");
      if (out.length) out = out[0].toUpperCase() + out.slice(1);
      break;
    }
  }
  return out;
}

interface SenseiResult {
  verdict: string;
  grade: string;
  sections: any[];
  goals: any[];
  quant_advice: any[];
  modelUsed: string;
}

async function callGateway(model: string, apiKey: string, systemPrompt: string, userPrompt: string, tools: any[]) {
  return await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools,
      tool_choice: { type: "function", function: { name: "publish_sensei_report" } },
    }),
  });
}

function tryExtractToolArgs(data: any): any | null {
  const call = data?.choices?.[0]?.message?.tool_calls?.[0];
  if (call?.function?.arguments) {
    try { return JSON.parse(call.function.arguments); } catch { /* fallthrough */ }
  }
  // Fallback: some models emit the structured payload inline as content despite tool_choice.
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { /* fallthrough */ }
    }
  }
  return null;
}

async function callSensei(payload: any, primaryModel: string): Promise<SenseiResult> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

  const validTradeIds: string[] = payload._valid_trade_ids;
  const validEmotions: string[] = payload._valid_emotions;
  const validSymbols: string[] = payload._valid_symbols;
  const quant = payload.quant; // optional QuantBlock — when present, require 6 sections incl. "The Math"
  const hasQuant = !!quant && (quant.buckets_top?.length || quant.buckets_bottom?.length || quant.strategy_replay?.length);

  const sectionsList = hasQuant
    ? `produce these 6 sections, in this order, with these exact headings:
  1. "The Verdict" — single paragraph (≤80 words). Names the single most important thing about the period in plain language.
  2. "The Edge" — what specifically worked AND your honest read on *why* it likely worked.
  3. "The Bleed" — the dominant leak named as a behavior, not a cluster.
  4. "The Pattern Underneath" — cross-reference tilt sequences + emotion notes + revenge entries to name the meta-pattern.
  5. "The One Thing" — single highest-leverage behavioral change for next period.
  6. "The Math" — quant findings. Call out best/worst bucket by edge (cite expectedR & sample n), the single highest-leverage *parameter* change (tighten SL / trail higher / scale risk to Kelly), and any strategy preset that demonstrably beats current. Every claim MUST reference a deterministic number from the QUANT block. Do NOT invent numbers.`
    : `produce these 5 sections, in this order, with these exact headings:
  1. "The Verdict" — single paragraph (≤80 words).
  2. "The Edge"
  3. "The Bleed"
  4. "The Pattern Underneath"
  5. "The One Thing"`;

  const systemPrompt = `You are a senior trading mentor — a sensei — debriefing one specific trader after their week or month. You have read every trade in the file. You write like a coach who watched the tape over their shoulder, not a report generator.

VOICE
- Direct, second person ("you"), conversational. Dry wit allowed. Short sentences welcome.
- Name the *behavior*, not the cluster. "You doubled down on Silver after losing on it" — not "the Silver cluster underperformed."
- Quote the trader's own review words when they're vivid. Use them as evidence.
- No hedging. No corporate speak. No motivational filler.

HARD RULES (non-negotiable)
1. EVERY section (except "The Verdict") must cite 1–3 specific trade IDs from the whitelist in the cited_trade_ids array. Reference those trades in prose by their trade_number and date — e.g., "trade #29 on Dec 11 lost -17.4R" — NEVER paste the raw UUID string into the body.
2. NEVER invent numbers. Only use values that appear verbatim in the supplied data.
3. NEVER start the verdict or any section body with: "Your total R was…", "This period saw…", "It is observed that…", "During this period…", "Overall, …", "In summary…", "Based on my analysis…".
4. NEVER use generic coaching clichés ("stay disciplined", "trust the process", "manage risk", "consistency is key", "trust your edge", "cut your losses", "let your winners run", "needs improvement", "indicating a need for", "moving forward", "for entry optimizations").
5. Symbols, emotions, and playbook names you reference MUST appear in the whitelists.
6. If a sample is small (n < 10), say so explicitly inside the paragraph.
7. Each section body must be at least 50 words of actual prose.
8. NO raw UUIDs anywhere in body text.

EVIDENCE-ONLY DISCIPLINE
9. If a number is not in the supplied data, do NOT speculate. Say "I don't have enough evidence yet to call this".
10. If \`edge_clusters\` is empty, "The Edge" must say so explicitly.
11. If both \`leak_clusters\` and behavioral patterns are empty, "The Bleed" must name the single largest losing trade from \`worst_trade_narratives\`.
12. "The Math" (when present) must only reference numbers in the QUANT block. If the QUANT block is empty, say plainly there isn't enough labelled data (MFE/MAE/SL) to run quant yet, and tell the user which fields to fill.

REQUIRED STRUCTURE — ${sectionsList}

VERDICT FIELD = a punchy 1-sentence headline ≤25 words. "The Verdict" section expands on it.

QUANT_ADVICE (separate structured output): list each actionable parameter change derived from the QUANT block, with current → suggested values, the expected R uplift, and confidence. Cite the trade IDs that prove the finding. Empty array when no quant signal.

OUTPUT: Use the provided tool to return structured JSON. No prose outside the tool call.`;

  const userPrompt = `Here is the trader's data for this period. Coach them.

PRECOMPUTED METRICS (the only numbers you may cite):
${JSON.stringify(payload.metrics, null, 2)}

WHAT WORKED — edge clusters:
${JSON.stringify(payload.edge_clusters, null, 2)}

WHAT BLED — leak clusters & behavioral patterns:
${JSON.stringify(payload.leak_clusters, null, 2)}

CONSISTENCY AUDIT:
${JSON.stringify(payload.consistency, null, 2)}

PSYCHOLOGY:
${JSON.stringify(payload.psychology, null, 2)}

SYMBOL-LEVEL EXPECTANCY:
${JSON.stringify(payload.symbol_expectancy, null, 2)}

WORST TRADES — narrative context:
${JSON.stringify(payload.worst_trade_narratives, null, 2)}

LONGEST TILT SEQUENCE:
${payload.tilt_narrative || "No qualifying tilt sequence (no 3+ consecutive losses)."}

JOURNALING GAPS:
- Reviewed trades: ${payload.psychology?.reviewed_count ?? 0}
- Unreviewed trades: ${payload.psychology?.unreviewed_count ?? 0}
- R impact of unreviewed trades: ${payload.unreviewed_r_impact ?? 0}R

REVIEW EXCERPTS:
${JSON.stringify((payload.review_excerpts || []).slice(0, 20), null, 2)}

QUANT (deterministic Pair-Lab analysis — these numbers are computed, NOT estimated by you):
${hasQuant ? JSON.stringify(quant, null, 2) : "No quant block available (insufficient labelled data — MFE/MAE/SL fields not filled on enough trades)."}

Whitelisted trade IDs: ${validTradeIds.length} ids available.
Whitelisted symbols: ${validSymbols.join(', ')}
Whitelisted emotions: ${validEmotions.join(', ')}

Write the ${hasQuant ? 6 : 5} sections, the headline verdict, the letter grade, 3 measurable goals, and the quant_advice array.`;

  const sectionsSchema = {
    type: "array",
    items: {
      type: "object",
      properties: {
        heading: { type: "string" },
        body: { type: "string", description: "Markdown prose (≥50 words)." },
        cited_trade_ids: { type: "array", items: { type: "string" } },
      },
      required: ["heading", "body", "cited_trade_ids"],
      additionalProperties: false,
    },
    minItems: hasQuant ? 6 : 5,
    maxItems: hasQuant ? 6 : 5,
  };

  const tools = [{
    type: "function",
    function: {
      name: "publish_sensei_report",
      description: "Publish the structured sensei coaching output.",
      parameters: {
        type: "object",
        properties: {
          verdict: { type: "string", description: "ONE punchy headline sentence (≤25 words)." },
          grade: { type: "string", enum: ["A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D", "F"] },
          sections: sectionsSchema,
          goals: {
            type: "array",
            items: {
              type: "object",
              properties: {
                text: { type: "string" },
                metric: { type: "string" },
                baseline: { type: "number" },
                target: { type: "number" },
                comparator: { type: "string", enum: ["lte", "gte", "eq"] },
              },
              required: ["text", "metric", "baseline", "target", "comparator"],
              additionalProperties: false,
            },
            minItems: 3,
            maxItems: 3,
          },
          quant_advice: {
            type: "array",
            description: "Actionable parameter changes derived from QUANT. Empty if QUANT block empty.",
            items: {
              type: "object",
              properties: {
                bucket_label: { type: "string", description: "e.g. 'London / Gold' or 'All sessions / Silver'" },
                finding: { type: "string", description: "Plain-English finding referencing the quant numbers." },
                parameter: { type: "string", enum: ["sl", "tp", "risk", "strategy"] },
                current_value: { type: "string" },
                suggested_value: { type: "string" },
                expected_uplift_r: { type: "number", description: "Per-trade R uplift. Use 0 if not quantifiable." },
                confidence: { type: "string", enum: ["high", "medium", "low"] },
                cited_trade_ids: { type: "array", items: { type: "string" } },
              },
              required: ["bucket_label", "finding", "parameter", "current_value", "suggested_value", "expected_uplift_r", "confidence", "cited_trade_ids"],
              additionalProperties: false,
            },
          },
        },
        required: ["verdict", "grade", "sections", "goals", "quant_advice"],
        additionalProperties: false,
      },
    },
  }];

  // Fallback ladder: primary → flash → inline-JSON-from-content
  const fallbackChain: string[] = [primaryModel];
  if (primaryModel !== "google/gemini-3-flash-preview") fallbackChain.push("google/gemini-3-flash-preview");

  let args: any = null;
  let modelUsed = primaryModel;
  let lastErr = "No tool call returned by model";

  for (const m of fallbackChain) {
    modelUsed = m;
    let resp = await callGateway(m, apiKey, systemPrompt, userPrompt, tools);
    // Single retry on 429
    if (resp.status === 429) {
      await new Promise(r => setTimeout(r, 2000));
      resp = await callGateway(m, apiKey, systemPrompt, userPrompt, tools);
    }
    if (!resp.ok) {
      const txt = await resp.text();
      lastErr = `AI gateway ${resp.status}: ${txt.slice(0, 300)}`;
      console.warn(`[callSensei] ${m} failed: ${lastErr}`);
      continue;
    }
    const data = await resp.json();
    const extracted = tryExtractToolArgs(data);
    if (extracted) { args = extracted; break; }
    lastErr = "No tool call returned by model";
    console.warn(`[callSensei] ${m} returned no tool_call; trying fallback.`);
  }

  if (!args) throw new Error(lastErr);

  // Validate citations & enforce prose-quality (soft — keep partial sections, only hard-drop on banned opener)
  const validIdSet = new Set(validTradeIds);
  const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
  const stripUuids = (s: string) => s
    .replace(UUID_RE, "")
    .replace(/\(\s*trade\s*id\s*:\s*[`'"]*\s*[`'"]*\s*\)/gi, "")
    .replace(/\(\s*[`'"]*\s*[`'"]*\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();

  const rawSections = (args.sections || []).map((s: any) => ({
    heading: s.heading || "",
    body: stripUuids(s.body || ""),
    cited_trade_ids: (s.cited_trade_ids || []).filter((id: string) => validIdSet.has(id)),
  }));

  const isVerdictSection = (heading: string) => /verdict/i.test(heading);
  const minSections = hasQuant ? 6 : 5;

  const filtered = rawSections.filter((s: any) => {
    const lower = s.body.toLowerCase().trim();
    if (BANNED_OPENERS.some(o => lower.startsWith(o))) return false;
    if (!isVerdictSection(s.heading) && s.cited_trade_ids.length === 0) {
      (s as any)._quality_warning = "missing_citations";
    }
    if (BANNED_PHRASES.some(p => s.body.toLowerCase().includes(p))) {
      (s as any)._quality_warning = "banned_phrase";
    }
    if (wordCount(s.body) < 40) (s as any)._quality_warning = "short_body";
    if (alphaRatio(s.body) < 0.55) (s as any)._quality_warning = "low_alpha";
    return true;
  });

  const sections = filtered.length >= minSections ? filtered : rawSections;

  const goals = (args.goals || []).map((g: any) => ({
    id: crypto.randomUUID(),
    ...g,
    status: 'pending' as const,
  }));

  // Filter cited_trade_ids in quant_advice the same way
  const quant_advice = (args.quant_advice || []).map((a: any) => ({
    ...a,
    cited_trade_ids: Array.isArray(a.cited_trade_ids) ? a.cited_trade_ids.filter((id: string) => validIdSet.has(id)) : [],
  }));

  return {
    verdict: rewriteVerdict(stripUuids(args.verdict || "")),
    grade: args.grade,
    sections,
    goals,
    quant_advice,
    modelUsed,
  };
}


// ------------------------------ LLM context builder (shared) ------------------------------
// Builds the rich worst-trade narrative + tilt narrative + symbol expectancy + review excerpts
// from raw trades/reviews. Used by both initial generation and rerun-sensei.
async function fetchPropFirmContext(
  admin: any,
  account_id: string | null,
): Promise<PropFirmContext | null> {
  if (!account_id) return null;
  try {
    const { data: acct } = await admin
      .from('accounts')
      .select('prop_firm, balance_start, equity_current')
      .eq('id', account_id)
      .maybeSingle();
    if (!acct?.prop_firm) return null;
    const balance = Number(acct.balance_start ?? acct.equity_current ?? 0);
    if (!(balance > 0)) return null;
    const { data: rules } = await admin
      .from('prop_firm_rules')
      .select('rule_type, value, is_percentage')
      .eq('firm', acct.prop_firm);
    if (!rules) return null;
    const toDollars = (r: any): number | null => {
      const v = Number(r.value);
      if (!isFinite(v) || v <= 0) return null;
      return r.is_percentage ? (v / 100) * balance : v;
    };
    let dailyLossDollars: number | null = null;
    let maxDrawdownDollars: number | null = null;
    let profitTargetDollars: number | null = null;
    for (const r of rules as any[]) {
      if (r.rule_type === 'daily_loss') dailyLossDollars = toDollars(r);
      else if (r.rule_type === 'max_drawdown') maxDrawdownDollars = toDollars(r);
      else if (r.rule_type === 'profit_target') profitTargetDollars = toDollars(r);
    }
    return {
      firm: acct.prop_firm,
      balance,
      dailyLossDollars,
      maxDrawdownDollars,
      profitTargetDollars,
    };
  } catch (e) {
    console.warn('prop firm context fetch failed:', e);
    return null;
  }
}

async function computeQuantBlock(
  admin: any,
  targetUserId: string,
  period_start: string,
  period_end: string,
  account_id: string | null,
): Promise<any> {
  try {
    let qQ = admin.from('trades')
      .select('id, symbol, session, entry_time, net_pnl, r_multiple_actual, sl_initial, entry_price, custom_fields, is_open, is_archived, trade_type')
      .eq('user_id', targetUserId)
      .gte('entry_time', period_start)
      .lt('entry_time', period_end)
      .eq('trade_type', 'executed');
    if (account_id) qQ = qQ.eq('account_id', account_id);
    const { data: qTrades } = await qQ;

    const { data: cfDefs } = await admin
      .from('custom_field_definitions')
      .select('key,label')
      .eq('user_id', targetUserId)
      .eq('is_active', true);

    const keys = resolvePairLabFieldKeys((cfDefs as any[]) || []);
    const usableTrades = ((qTrades as any[]) || []).filter((t: any) => !t.is_open && !t.is_archived);
    if (usableTrades.length === 0) return null;

    const propFirm = await fetchPropFirmContext(admin, account_id);

    const { perCell, baseline } = buildBuckets(usableTrades, keys, propFirm);
    const total = usableTrades.length || 1;
    const slCov = usableTrades.filter((t: any) => t.sl_initial != null && t.entry_price != null).length / total;
    const mfeCov = baseline.loggedMfeCount / total;
    const maeCov = baseline.loggedMaeCount / total;

    const ranked = perCell.filter((b: BucketReport) => b.n >= 3)
      .sort((a, b) => b.expectedR * b.n - a.expectedR * a.n);
    const top = ranked.slice(0, 3);
    // Disjoint bottom — when fewer than 6 ranked buckets exist, skip bottom to
    // avoid presenting the same buckets as both "top" and "bottom" reversed.
    const bottom = ranked.length >= 6 ? ranked.slice(-3).reverse() : [];

    const presetResults: PresetReplayResult[] = replayAllPresets(usableTrades, keys);
    const current = presetResults.find(p => p.presetId === 'current');
    const baselineR = current ? current.expectancyR : 0;
    const replay = presetResults.map(p => {
      const intersectionDelta = p.expectancyROnIntersection != null && p.currentExpectancyROnIntersection != null
        ? +(p.expectancyROnIntersection - p.currentExpectancyROnIntersection).toFixed(3)
        : null;
      return {
        preset_id: p.presetId,
        label: p.label,
        n_eligible: p.nEligible,
        total_considered: p.totalConsidered,
        win_rate: +(p.winRate * 100).toFixed(1),
        expectancy_r: +p.expectancyR.toFixed(3),
        delta_vs_current: +(p.expectancyR - baselineR).toFixed(3),
        delta_vs_current_intersection: intersectionDelta,
        n_comparable: p.nComparable,
        bias_warning: p.biasWarning,
        mean_reached_r: p.meanReachedR != null ? +p.meanReachedR.toFixed(2) : null,
        ci: p.expectancyRCi ? [+p.expectancyRCi[0].toFixed(2), +p.expectancyRCi[1].toFixed(2)] : null,
      };
    });

    const summarizeBucket = (b: BucketReport) => ({
      label: `${b.key.symbol} / ${b.key.session}`,
      n: b.n,
      win_rate_pct: +(b.winRate * 100).toFixed(1),
      expected_r: +b.expectedR.toFixed(2),
      expected_r_ci: b.expectedRCi ? [+b.expectedRCi[0].toFixed(2), +b.expectedRCi[1].toFixed(2)] : null,
      mfe_p75_r: b.mfeP75 != null ? +b.mfeP75.toFixed(2) : null,
      mae_p75_r: b.maeP75 != null ? +b.maeP75.toFixed(2) : null,
      sl_drift: b.slDrift,
      most_common_tp_hit: b.mostCommonTpHit,
      suggested_sl_pips: b.suggestedSlPips != null ? +b.suggestedSlPips.toFixed(1) : null,
      sl_unit: b.slUnit,
      tp_ladder_r: b.tpLadderR,
      tp1_star: b.tp1Star ? { r: b.tp1Star.r, hit_rate_pct: +(b.tp1Star.hitRate * 100).toFixed(1), expectancy_r: +b.tp1Star.expectancyR.toFixed(2) } : null,
      suggested_risk_pct: b.suggestedRiskPct != null ? +b.suggestedRiskPct.toFixed(2) : null,
      suggested_risk_pct_propfirm_cap: b.suggestedRiskPctPropFirmCap,
      confidence: b.confidence,
      top_trade_ids: b.topTradeIds,
      bottom_trade_ids: b.bottomTradeIds,
    });

    return {
      coverage: { sl: +slCov.toFixed(2), mfe: +mfeCov.toFixed(2), mae: +maeCov.toFixed(2), total },
      baseline: summarizeBucket(baseline),
      buckets_top: top.map(summarizeBucket),
      buckets_bottom: bottom.map(summarizeBucket),
      strategy_replay: replay,
      min_eligible_sample: MIN_ELIGIBLE_SAMPLE,
      prop_firm_context: propFirm ? {
        firm: propFirm.firm,
        balance: propFirm.balance,
        daily_loss_dollars: propFirm.dailyLossDollars,
        max_drawdown_dollars: propFirm.maxDrawdownDollars,
        profit_target_dollars: propFirm.profitTargetDollars,
      } : null,
    };
  } catch (e) {
    console.error('quant compute failed:', e);
    return null;
  }
}

// ------------------------------ numeric hallucination grader ------------------------------
function gradeSenseiNumbers(sections: Array<{ heading: string; body: string }>, factSources: any[]): {
  ungrounded_numbers: Array<{ section: string; value: number }>;
  warnings: string[];
} {
  // Build a flat set of trusted numerical facts (rounded to 2dp).
  const facts = new Set<string>();
  const visit = (v: any) => {
    if (v == null) return;
    if (typeof v === 'number' && isFinite(v)) {
      facts.add(v.toFixed(2));
      facts.add(Math.round(v).toString());
      return;
    }
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (typeof v === 'object') { Object.values(v).forEach(visit); }
  };
  factSources.forEach(visit);

  // Numbers from prose: integers (≥2 digits) or decimals.
  const NUM_RE = /-?\d+(?:\.\d+)?/g;
  const ungrounded: Array<{ section: string; value: number }> = [];
  const TOL = 0.05; // ±5%
  for (const s of sections) {
    const matches = (s.body.match(NUM_RE) || []).map(Number).filter(Number.isFinite);
    for (const n of matches) {
      const absN = Math.abs(n);
      // Skip trivial small ints (likely trade #, ordinals, "1R", "3 trades").
      if (absN < 5 && Number.isInteger(n)) continue;
      const candidates = [n.toFixed(2), Math.round(n).toString()];
      if (candidates.some(c => facts.has(c))) continue;
      // Tolerance check: scan facts for ±5% match.
      let matched = false;
      for (const f of facts) {
        const fn = Number(f);
        if (!isFinite(fn) || fn === 0) continue;
        if (Math.abs(fn - n) / Math.abs(fn) <= TOL) { matched = true; break; }
      }
      if (!matched) ungrounded.push({ section: s.heading, value: n });
    }
  }
  const warnings: string[] = [];
  if (ungrounded.length > 0) warnings.push(`${ungrounded.length} numeric value(s) in Sensei prose don't match the deterministic data (±5%)`);
  return { ungrounded_numbers: ungrounded.slice(0, 12), warnings };
}

// ------------------------------ shared narrative builder ------------------------------
// Builds worst-trade narratives, tilt narrative, symbol expectancy, and unreviewed-R impact
// from raw trades+reviews+psychology. Single source of truth — used by both the main
// generation path and the rerun-sensei branch.
function buildNarratives(
  closedExec: TradeRow[],
  reviews: Map<string, ReviewRow>,
  psychology: any,
): {
  worstTradeNarratives: any[];
  tiltNarrative: string | null;
  symbolExpectancy: any[];
  unreviewedRImpact: number;
} {
  const sortedByR = [...closedExec].sort((a, b) => (a.r_multiple_actual ?? 0) - (b.r_multiple_actual ?? 0));
  const sortedByTime = [...closedExec].sort((a, b) => a.entry_time.localeCompare(b.entry_time));
  const worstTradeNarratives = sortedByR.slice(0, 3).map((t) => {
    const r = reviews.get(t.id);
    const idx = sortedByTime.findIndex((x) => x.id === t.id);
    const prior = idx > 0 ? sortedByTime[idx - 1] : null;
    const gapMin = prior ? Math.round((new Date(t.entry_time).getTime() - new Date(prior.exit_time || prior.entry_time).getTime()) / 60000) : null;
    return {
      trade_id: t.id,
      trade_number: t.trade_number,
      symbol: humanSymbol(t.symbol),
      date: formatDateShort(t.entry_time),
      clock: formatClock(t.entry_time),
      r_multiple: t.r_multiple_actual,
      net_pnl: t.net_pnl,
      session: humanSession(t.session),
      emotion_before: r?.emotional_state_before || null,
      thoughts: r?.thoughts?.slice(0, 400) || null,
      mistakes: asArray(r?.mistakes).slice(0, 5),
      psychology_notes: r?.psychology_notes?.slice(0, 300) || null,
      minutes_after_prior_trade: gapMin,
      prior_trade_outcome_r: prior?.r_multiple_actual ?? null,
    };
  });

  const longestTilt = [...((psychology?.tilt_sequences) || [])].sort((a: any, b: any) => b.length - a.length)[0];
  let tiltNarrative: string | null = null;
  if (longestTilt && longestTilt.trade_ids?.length) {
    const tiltTrades = longestTilt.trade_ids
      .map((id: string) => closedExec.find((t) => t.id === id))
      .filter(Boolean) as TradeRow[];
    tiltNarrative = tiltTrades
      .map((t) => `${formatClock(t.entry_time)} ${(t.r_multiple_actual ?? 0) >= 0 ? "won" : "lost"} ${(t.r_multiple_actual ?? 0).toFixed(1)}R on ${humanSymbol(t.symbol)}`)
      .join(" → ");
  }

  const bySymbol = new Map<string, TradeRow[]>();
  for (const t of closedExec) {
    const arr = bySymbol.get(t.symbol) ?? [];
    arr.push(t);
    bySymbol.set(t.symbol, arr);
  }
  const symbolExpectancy = Array.from(bySymbol.entries())
    .filter(([, ts]) => ts.length >= 2)
    .map(([sym, ts]) => {
      const total_r = ts.reduce((s, t) => s + (t.r_multiple_actual ?? 0), 0);
      const total_pnl = ts.reduce((s, t) => s + (t.net_pnl ?? 0), 0);
      const wins = ts.filter((t) => (t.net_pnl ?? 0) > 0).length;
      return {
        symbol: humanSymbol(sym),
        raw_symbol: sym,
        trades: ts.length,
        win_rate: +(wins / ts.length * 100).toFixed(1),
        expectancy_r: +(total_r / ts.length).toFixed(2),
        total_r: +total_r.toFixed(2),
        total_pnl: +total_pnl.toFixed(2),
      };
    })
    .sort((a, b) => b.expectancy_r - a.expectancy_r);

  const unreviewedRImpact = closedExec
    .filter((t) => !reviews.has(t.id))
    .reduce((s, t) => s + (t.r_multiple_actual ?? 0), 0);

  return { worstTradeNarratives, tiltNarrative, symbolExpectancy, unreviewedRImpact: +unreviewedRImpact.toFixed(2) };
}

async function buildLlmContext(
  admin: any,
  targetUserId: string,
  period_start: string,
  period_end: string,
  account_id: string | null,
  storedMetrics: any,
  storedEdges: any[],
  storedLeaks: any[],
  storedConsistency: any,
  storedPsychology: any,
) {
  let tradesQuery = admin
    .from('trades')
    .select('id, trade_number, symbol, direction, entry_time, exit_time, net_pnl, r_multiple_actual, risk_percent, session, playbook_id, is_open, trade_type, total_lots, account_id, profile, actual_playbook_id, actual_profile, actual_regime')
    .eq('user_id', targetUserId)
    .gte('entry_time', period_start)
    .lt('entry_time', period_end)
    .order('entry_time', { ascending: true });
  if (account_id) tradesQuery = tradesQuery.eq('account_id', account_id);
  const { data: trades } = await tradesQuery;
  if (!trades || trades.length === 0) return null;

  const tradeIds = trades.map((t: any) => t.id);
  const { data: reviewsArr } = await admin.from('trade_reviews').select('*').in('trade_id', tradeIds);
  const reviews = new Map<string, ReviewRow>((reviewsArr || []).map((r: any) => [r.trade_id, r as ReviewRow]));

  const reviewExcerpts = (reviewsArr || []).map((r: any) => ({
    trade_id: r.trade_id,
    mistakes: asArray(r.mistakes),
    did_well: asArray(r.did_well),
    to_improve: asArray(r.to_improve),
    thoughts: r.thoughts,
    psychology_notes: r.psychology_notes,
  })).filter((r: any) => r.mistakes.length || r.did_well.length || r.to_improve.length || r.thoughts || r.psychology_notes);

  const closedExec = (trades as TradeRow[]).filter(t => !t.is_open && t.trade_type === 'executed');
  const { worstTradeNarratives, tiltNarrative, symbolExpectancy, unreviewedRImpact } =
    buildNarratives(closedExec, reviews, storedPsychology);

  // Re-humanize stored cluster labels at LLM-time so older reports (saved before the humanizer) get clean English
  const rehumanize = (c: any) => {
    const d = c?.dimensions || {};
    if (d.session && d.symbol) {
      return { ...c, label: humanizeClusterLabel(d.session, d.symbol, d.emotion || "unknown", d.playbook || "No playbook") };
    }
    return c;
  };

  return {
    metrics: storedMetrics,
    edge_clusters: (storedEdges || []).map(rehumanize),
    leak_clusters: (storedLeaks || []).map(rehumanize),
    consistency: storedConsistency,
    psychology: storedPsychology,
    review_excerpts: reviewExcerpts,
    worst_trade_narratives: worstTradeNarratives,
    tilt_narrative: tiltNarrative,
    symbol_expectancy: symbolExpectancy,
    unreviewed_r_impact: unreviewedRImpact,
    _valid_trade_ids: tradeIds,
    _valid_symbols: Array.from(new Set(trades.map((t: any) => t.symbol))),
    _valid_emotions: Array.from(new Set(Array.from(reviews.values()).map((r: any) => r.emotional_state_before).filter(Boolean))) as string[],
  };
}

// ------------------------------ main ------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Auth: support both user-JWT (interactive "Generate now") and service-role (scheduler)
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    let authedUserId: string | null = null;
    let usingService = false;

    if (token === serviceKey) {
      usingService = true;
    } else if (token) {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      authedUserId = user.id;
    } else {
      return new Response(JSON.stringify({ error: "missing auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const admin = createClient(supabaseUrl, serviceKey);

    // ------------------------------ rerun_sensei branch ------------------------------
    if (body.action === "rerun_sensei") {
      const reportId = body.report_id;
      if (!reportId) {
        return new Response(JSON.stringify({ error: "report_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { data: existing, error: loadErr } = await admin.from('reports').select('*').eq('id', reportId).maybeSingle();
      if (loadErr || !existing) {
        return new Response(JSON.stringify({ error: "report not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (!usingService && existing.user_id !== authedUserId) {
        return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Skip empty-period reports — nothing to coach on
      if (!existing.metrics?.current) {
        return new Response(JSON.stringify({ error: "report has no trades to analyze" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const llmPayload = await buildLlmContext(
        admin,
        existing.user_id,
        existing.period_start,
        existing.period_end,
        existing.account_id,
        existing.metrics,
        existing.edge_clusters || [],
        existing.leak_clusters || [],
        existing.consistency || {},
        existing.psychology || {},
      );
      if (!llmPayload) {
        return new Response(JSON.stringify({ error: "no trades found in period" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Recompute quant block (uses live trade data) so rerun gets the elite "The Math" section.
      const quant = await computeQuantBlock(
        admin, existing.user_id, existing.period_start, existing.period_end, existing.account_id,
      );
      (llmPayload as any).quant = quant;

      // Reruns default to gemini-3-pro-preview with automatic fallback to flash inside callSensei.
      const model = body.model || 'google/gemini-3-pro-preview';

      const updatePayload: any = { sensei_regenerated_at: new Date().toISOString(), sensei_model: model };
      try {
        const result = await callSensei(llmPayload, model);
        updatePayload.sensei_notes = { sections: result.sections };
        updatePayload.verdict = result.verdict;
        updatePayload.grade = result.grade;
        updatePayload.goals = result.goals;
        updatePayload.sensei_model = result.modelUsed;
        const quality = gradeSenseiNumbers(result.sections || [], [
          existing.metrics?.current, existing.metrics?.deltas, quant,
        ]);
        updatePayload.quant = quant ? { ...quant, advice: result.quant_advice || [], sensei_quality: quality } : null;
        updatePayload.status = 'completed';
        updatePayload.error_message = null;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("Sensei rerun failed:", msg);
        updatePayload.status = 'failed';
        updatePayload.error_message = msg;
      }

      const { data: updated, error: updErr } = await admin
        .from('reports')
        .update(updatePayload)
        .eq('id', reportId)
        .select()
        .single();
      if (updErr) throw updErr;

      return new Response(JSON.stringify({ report: updated }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ------------------------------ standard generation ------------------------------
    const { period_start, period_end, report_type, account_id } = body;
    const targetUserId = usingService ? body.user_id : authedUserId;
    if (!targetUserId || !period_start || !period_end || !report_type) {
      return new Response(JSON.stringify({ error: "missing fields" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch trades in window
    let tradesQuery = admin
      .from('trades')
      .select('id, trade_number, symbol, direction, entry_time, exit_time, net_pnl, r_multiple_actual, risk_percent, session, playbook_id, is_open, trade_type, total_lots, account_id, profile, actual_playbook_id, actual_profile, actual_regime')
      .eq('user_id', targetUserId)
      .gte('entry_time', period_start)
      .lt('entry_time', period_end)
      .order('entry_time', { ascending: true });
    if (account_id) tradesQuery = tradesQuery.eq('account_id', account_id);
    const { data: trades, error: tradesErr } = await tradesQuery;
    if (tradesErr) throw tradesErr;

    if (!trades || trades.length === 0) {
      // Insert empty report so user sees "nothing this week" instead of error
      const { data: empty, error: insErr } = await admin.from('reports').insert({
        user_id: targetUserId,
        account_id: account_id || null,
        report_type,
        period_start,
        period_end,
        metrics: { current: null, prior: null, deltas: {}, prior_period_label: null },
        edge_clusters: [],
        leak_clusters: [],
        consistency: {},
        psychology: {},
        verdict: 'No trades recorded for this period.',
        grade: null,
        status: 'completed',
      }).select().single();
      if (insErr) throw insErr;
      return new Response(JSON.stringify({ report: empty }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const tradeIds = trades.map(t => t.id);
    const { data: reviewsArr } = await admin.from('trade_reviews').select('*').in('trade_id', tradeIds);
    const reviews = new Map<string, ReviewRow>((reviewsArr || []).map(r => [r.trade_id, r as ReviewRow]));

    const playbookIds = Array.from(new Set(trades.map(t => t.playbook_id).filter(Boolean))) as string[];
    const playbookNames = new Map<string, string>();
    if (playbookIds.length) {
      const { data: pbs } = await admin.from('playbooks').select('id, name').in('id', playbookIds);
      for (const p of pbs || []) playbookNames.set(p.id, p.name);
    }

    // Prior period
    const periodMs = new Date(period_end).getTime() - new Date(period_start).getTime();
    const priorStart = new Date(new Date(period_start).getTime() - periodMs).toISOString();
    let priorQ = admin.from('trades').select('id, net_pnl, r_multiple_actual, risk_percent, is_open, trade_type, entry_time, exit_time, symbol, direction, session, playbook_id, total_lots, trade_number').eq('user_id', targetUserId).gte('entry_time', priorStart).lt('entry_time', period_start);
    if (account_id) priorQ = priorQ.eq('account_id', account_id);
    const { data: priorTrades } = await priorQ;

    // 90-day baseline trades/day
    const baselineStart = new Date(new Date(period_end).getTime() - 90 * 86400000).toISOString();
    let baseQ = admin.from('trades').select('entry_time').eq('user_id', targetUserId).gte('entry_time', baselineStart).lt('entry_time', period_start).eq('trade_type', 'executed').eq('is_open', false);
    if (account_id) baseQ = baseQ.eq('account_id', account_id);
    const { data: baseTrades } = await baseQ;
    const baselineDays = new Set((baseTrades || []).map((t: any) => t.entry_time.slice(0, 10))).size || 1;
    const baselineTradesPerDay = (baseTrades?.length || 0) / baselineDays;

    // Live-question definitions for schema suggestions (live questions now live in
    // custom_field_definitions with scope='live_question')
    const { data: liveQuestionRows } = await admin
      .from('custom_field_definitions')
      .select('key,label,type,options,is_active')
      .eq('user_id', targetUserId)
      .eq('scope', 'live_question')
      .eq('is_active', true);
    const liveQuestions = ((liveQuestionRows as any[]) || []).map((r) => ({
      id: r.key,
      label: r.label,
      type: r.type,
      options: Array.isArray(r.options) ? r.options : [],
    }));

    const { data: priorReport } = await admin
      .from('reports')
      .select('goals, period_end')
      .eq('user_id', targetUserId)
      .eq('report_type', report_type)
      .lt('period_end', period_start)
      .order('period_end', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Compute everything
    const currentBlock = metricsBlock(trades as TradeRow[], reviews);
    const priorBlock = priorTrades ? metricsBlock(priorTrades as TradeRow[], new Map()) : null;
    const deltas: any = {};
    if (priorBlock) {
      for (const k of Object.keys(currentBlock) as (keyof typeof currentBlock)[]) {
        const a = (currentBlock as any)[k];
        const b = (priorBlock as any)[k];
        if (typeof a === 'number' && typeof b === 'number') deltas[k] = +(a - b).toFixed(3);
      }
    }
    const { edges, clusterLeaks } = clusterTrades(trades as TradeRow[], reviews, playbookNames);
    const behavioralLeakClusters = behavioralLeaks(trades as TradeRow[]);
    const allLeaks = [...behavioralLeakClusters, ...clusterLeaks].slice(0, 6);
    const consistency = consistencyAudit(trades as TradeRow[], baselineTradesPerDay);
    const psychology = psychologyAnalysis(trades as TradeRow[], reviews);
    // Fetch user's custom field definitions so we don't suggest fields they already added
    const { data: customFieldDefs } = await admin
      .from('custom_field_definitions')
      .select('key,label,is_active')
      .eq('user_id', targetUserId)
      .eq('scope', 'user')
      .eq('is_active', true);
    const suggestions = schemaSuggestions(
      trades as TradeRow[],
      reviews,
      liveQuestions,
      (customFieldDefs as any[]) || [],
    );

    // Evaluate prior goals (best-effort, simple metric mapping)
    let prior_goals_evaluation: any = null;
    if (priorReport?.goals && Array.isArray(priorReport.goals)) {
      const evaluated = (priorReport.goals as any[]).map((g: any) => {
        let actual = 0;
        const m = (g.metric || '').toLowerCase();
        if (m.includes('revenge')) actual = behavioralLeakClusters.find(b => b.pattern_type === 'revenge')?.trades || 0;
        else if (m.includes('win_rate')) actual = currentBlock.win_rate;
        else if (m.includes('expectancy')) actual = currentBlock.expectancy_r;
        else if (m.includes('drawdown')) actual = currentBlock.max_drawdown_r;
        else if (m.includes('trade_count')) actual = currentBlock.trade_count;
        else if (m.includes('compliance')) actual = currentBlock.checklist_compliance_pct ?? 0;
        const cmp = g.comparator || 'lte';
        const met = cmp === 'lte' ? actual <= g.target : cmp === 'gte' ? actual >= g.target : actual === g.target;
        return { ...g, status: met ? 'met' : 'missed', actual: +actual.toFixed(2) };
      });
      prior_goals_evaluation = { evaluated_at: new Date().toISOString(), goals: evaluated };
    }

    const metrics = {
      current: currentBlock,
      prior: priorBlock,
      deltas,
      prior_period_label: priorBlock ? `previous ${report_type === 'monthly' ? 'month' : report_type === 'weekly' ? 'week' : 'period'}` : null,
    };

    // Build LLM payload — enrich with worst-trade narrative, tilt narrative, symbol expectancy
    const reviewExcerpts = (reviewsArr || []).map((r: any) => ({
      trade_id: r.trade_id,
      mistakes: asArray(r.mistakes),
      did_well: asArray(r.did_well),
      to_improve: asArray(r.to_improve),
      thoughts: r.thoughts,
      psychology_notes: r.psychology_notes,
    })).filter((r: any) => r.mistakes.length || r.did_well.length || r.to_improve.length || r.thoughts || r.psychology_notes);

    // Read-quality summary — planned-vs-actual thesis grading (skipped if <5 graded trades)
    const gradedTrades = (trades as TradeRow[]).filter(t =>
      (t.playbook_id && t.actual_playbook_id) ||
      (t.profile && t.actual_profile) ||
      (reviews.get(t.id)?.playbook_id && t.actual_regime)
    );
    let readQualityBlock: any = null;
    if (gradedTrades.length >= 5) {
      let modelMatch = 0, modelMismatch = 0, modelPartial = 0;
      let modelMatchWins = 0, modelMatchTotal = 0, modelMismatchWins = 0, modelMismatchTotal = 0;
      const driftPairs: Record<string, number> = {};
      for (const t of gradedTrades) {
        const fields: Array<[any, any]> = [
          [t.playbook_id, t.actual_playbook_id],
          [t.profile, t.actual_profile],
          [reviews.get(t.id)?.regime, t.actual_regime],
        ].filter(([p, a]) => p && a) as Array<[any, any]>;
        if (!fields.length) continue;
        const matches = fields.filter(([p, a]) => p === a).length;
        const isWin = (t.net_pnl ?? 0) > 0 ? 1 : 0;
        if (matches === fields.length) {
          modelMatch++;
          modelMatchWins += isWin;
          modelMatchTotal++;
        } else if (matches === 0) {
          modelMismatch++;
          modelMismatchWins += isWin;
          modelMismatchTotal++;
        } else {
          modelPartial++;
        }
        if (t.playbook_id && t.actual_playbook_id && t.playbook_id !== t.actual_playbook_id) {
          const key = `${playbookNames.get(t.playbook_id) || 'Unknown'} → ${playbookNames.get(t.actual_playbook_id) || 'Unknown'}`;
          driftPairs[key] = (driftPairs[key] || 0) + 1;
        }
      }
      const topDrifts = Object.entries(driftPairs).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([pair, n]) => ({ pair, count: n }));
      readQualityBlock = {
        graded_count: gradedTrades.length,
        match: modelMatch,
        partial: modelPartial,
        mismatch: modelMismatch,
        win_rate_when_correctly_read: modelMatchTotal ? +(modelMatchWins / modelMatchTotal * 100).toFixed(1) : null,
        win_rate_when_misread: modelMismatchTotal ? +(modelMismatchWins / modelMismatchTotal * 100).toFixed(1) : null,
        top_misreads: topDrifts,
      };
    }

    // Worst-trade narratives, tilt, symbol expectancy, unreviewed-R — shared helper
    const closedExec = (trades as TradeRow[]).filter(t => !t.is_open && t.trade_type === 'executed');
    const { worstTradeNarratives, tiltNarrative, symbolExpectancy, unreviewedRImpact } =
      buildNarratives(closedExec, reviews, psychology);

    // ---- QUANT BLOCK (Pair-Lab math + strategy replay) ----
    const quant = await computeQuantBlock(admin, targetUserId, period_start, period_end, account_id);

    const llmPayload = {
      metrics,
      edge_clusters: edges,
      leak_clusters: allLeaks,
      consistency,
      psychology,
      review_excerpts: reviewExcerpts,
      worst_trade_narratives: worstTradeNarratives,
      tilt_narrative: tiltNarrative,
      symbol_expectancy: symbolExpectancy,
      read_quality: readQualityBlock,
      unreviewed_r_impact: unreviewedRImpact,
      quant,
      _valid_trade_ids: tradeIds,
      _valid_symbols: Array.from(new Set(trades.map(t => t.symbol))),
      _valid_emotions: Array.from(new Set(Array.from(reviews.values()).map(r => r.emotional_state_before).filter(Boolean))) as string[],
    };

    const model = report_type === 'custom' ? 'google/gemini-3-flash-preview' : 'google/gemini-3-pro-preview';

    let sensei = null;
    let verdict: string | null = null;
    let grade: string | null = null;
    let goals: any[] = [];
    let quant_advice: any[] = [];
    let modelUsed = model;
    let sensei_error: string | null = null;
    try {
      const result = await callSensei(llmPayload, model);
      sensei = { sections: result.sections };
      verdict = result.verdict;
      grade = result.grade;
      goals = result.goals;
      quant_advice = result.quant_advice;
      modelUsed = result.modelUsed;
    } catch (e) {
      sensei_error = e instanceof Error ? e.message : String(e);
      console.error("Sensei generation failed:", sensei_error);
    }

    const status = sensei_error ? 'failed' : 'completed';

    // Attach LLM-emitted advice + numeric grader onto the quant block so the UI gets a single payload.
    const sensei_quality = sensei ? gradeSenseiNumbers(sensei.sections || [], [metrics?.current, metrics?.deltas, quant]) : undefined;
    const quantWithAdvice = quant ? { ...quant, advice: quant_advice, ...(sensei_quality ? { sensei_quality } : {}) } : null;

    const { data: inserted, error: insErr } = await admin.from('reports').insert({
      user_id: targetUserId,
      account_id: account_id || null,
      report_type,
      period_start,
      period_end,
      metrics,
      edge_clusters: edges,
      leak_clusters: allLeaks,
      consistency,
      psychology,
      sensei_notes: sensei,
      sensei_model: modelUsed,
      schema_suggestions: suggestions,
      read_quality: readQualityBlock,
      quant: quantWithAdvice,
      goals,
      prior_goals_evaluation,
      verdict,
      grade,
      status,
      error_message: sensei_error,
    }).select().single();
    if (insErr) throw insErr;

    return new Response(JSON.stringify({ report: inserted }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("generate-report error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
