// Generate a Sensei trading report for a given user/period.
// Computes deterministic metrics + clusters + psychology, then calls Lovable AI
// with strict tool-calling for the narrative section. Anti-hallucination: every
// LLM-cited trade ID is validated against the input set.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }
function safeDiv(a: number, b: number, fallback = 0) { return b === 0 ? fallback : a / b; }
function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}
function bandLetter(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "A-";
  if (score >= 75) return "B+";
  if (score >= 65) return "B";
  if (score >= 55) return "B-";
  if (score >= 45) return "C+";
  if (score >= 35) return "C";
  if (score >= 25) return "C-";
  if (score >= 15) return "D";
  return "F";
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

function schemaSuggestions(trades: TradeRow[], reviews: Map<string, ReviewRow>, liveQuestions: any[]) {
  const closed = trades.filter(t => !t.is_open && t.trade_type === 'executed');
  const losses = closed.filter(t => (t.net_pnl ?? 0) < 0).sort((a, b) => (a.r_multiple_actual ?? 0) - (b.r_multiple_actual ?? 0));
  const worstLosses = losses.slice(0, Math.min(6, losses.length));
  const suggestions: any[] = [];
  const existingIds = new Set((liveQuestions || []).map(q => q?.id).filter(Boolean));

  // 1) time_since_last_trade_minutes
  if (worstLosses.length >= 3 && !existingIds.has('time_since_last_trade_minutes')) {
    suggestions.push({
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

  // 2) mistake_category
  const reviewedLossesWithMistakes = closed.filter(t => {
    const r = reviews.get(t.id);
    return r && asArray(r.mistakes).length > 0 && (t.net_pnl ?? 0) < 0;
  });
  if (reviewedLossesWithMistakes.length >= 3 && !existingIds.has('mistake_category')) {
    suggestions.push({
      missing_field: 'mistake_category',
      reason: `You logged free-text mistakes on ${reviewedLossesWithMistakes.length} losing trades but never tagged the underlying cause. A category select lets the report attribute leaks precisely (technical vs psychological vs execution).`,
      proposed_widget: 'select',
      proposed_options: ['Technical', 'Psychological', 'Execution', 'External'],
      example_trade_ids: reviewedLossesWithMistakes.slice(0, 5).map(t => t.id),
      proposed_question: {
        id: 'mistake_category',
        label: 'Primary cause of mistake',
        type: 'select',
        options: ['Technical', 'Psychological', 'Execution', 'External'],
      },
    });
  }

  // 3) news_risk if missing on losses
  const lossesWithNoNews = closed.filter(t => {
    const r = reviews.get(t.id);
    return (t.net_pnl ?? 0) < 0 && (!r || !r['news_risk' as keyof ReviewRow]);
  });
  if (lossesWithNoNews.length >= 4 && !existingIds.has('pre_news_entry')) {
    suggestions.push({
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

  return suggestions;
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

async function callSensei(payload: any, model: string) {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

  const validTradeIds: string[] = payload._valid_trade_ids;
  const validEmotions: string[] = payload._valid_emotions;
  const validSymbols: string[] = payload._valid_symbols;

  const systemPrompt = `You are a senior trading mentor — a sensei — debriefing one specific trader after their week or month. You have read every trade in the file. You write like a coach who watched the tape over their shoulder, not a report generator.

VOICE
- Direct, second person ("you"), conversational. Dry wit allowed. Short sentences welcome.
- Name the *behavior*, not the cluster. "You doubled down on Silver after losing on it" — not "the Silver cluster underperformed."
- Quote the trader's own review words when they're vivid. Use them as evidence.
- No hedging. No corporate speak. No motivational filler.

HARD RULES (non-negotiable)
1. EVERY section (except "The Verdict") must cite 1–3 specific trade IDs from the whitelist in the cited_trade_ids array. Reference those trades in prose by their trade_number and date — e.g., "trade #29 on Dec 11 lost -17.4R" — NEVER paste the raw UUID string into the body. The cited_trade_ids array handles linking; the prose names the trade by number+date.
2. NEVER invent numbers. Only use values that appear verbatim in the supplied data.
3. NEVER start the verdict or any section body with: "Your total R was…", "This period saw…", "It is observed that…", "During this period…", "Overall, …", "In summary…".
4. NEVER use generic coaching clichés ("stay disciplined", "trust the process", "manage risk", "consistency is key", "trust your edge", "cut your losses", "let your winners run", "needs improvement", "indicating a need for", "moving forward", "for entry optimizations").
5. Symbols, emotions, and playbook names you reference MUST appear in the whitelists. Use the humanized cluster labels in prose (e.g., "London session on Gold, feeling focused") — NEVER quote raw cluster keys like "new_york_am · XAGUSD · unknown".
6. If a sample is small (n < 10 for a pattern), say so explicitly inside the paragraph instead of asserting it as fact.
7. Each section body must be at least 50 words of actual prose — not a list of numbers and IDs.
8. NO raw UUIDs anywhere in body text. No "(trade ID: abc-123-...)". The chip system below the prose handles citation links.

REQUIRED STRUCTURE — produce these 5 sections, in this order, with these exact headings:
  1. "The Verdict" — single paragraph (≤80 words). Names the single most important thing about the period in plain language.
  2. "The Edge" — what specifically worked AND your honest read on *why* it likely worked, anchored in the cited trades' context (session, emotion, setup).
  3. "The Bleed" — the dominant leak named as a behavior, not a cluster. Tell the story of the worst single trade or sequence.
  4. "The Pattern Underneath" — cross-reference tilt sequences + emotion notes + revenge entries to name the *meta-pattern* the trader probably can't see themselves.
  5. "The One Thing" — single highest-leverage change for next period. One concrete behavior, not a list.

VERDICT (the one-liner returned in the verdict field) is separate from "The Verdict" section. The verdict field is a punchy 1-sentence headline ≤25 words. "The Verdict" section expands on it.

OUTPUT: Use the provided tool to return structured JSON. No prose outside the tool call.`;

  const userPrompt = `Here is the trader's data for this period. Coach them.

PRECOMPUTED METRICS (the only numbers you may cite):
${JSON.stringify(payload.metrics, null, 2)}

WHAT WORKED — edge clusters (already humanized labels):
${JSON.stringify(payload.edge_clusters, null, 2)}

WHAT BLED — leak clusters & behavioral patterns:
${JSON.stringify(payload.leak_clusters, null, 2)}

CONSISTENCY AUDIT:
${JSON.stringify(payload.consistency, null, 2)}

PSYCHOLOGY:
${JSON.stringify(payload.psychology, null, 2)}

SYMBOL-LEVEL EXPECTANCY (ranked best→worst — useful for "Gold pays you, Silver bleeds you" style insights):
${JSON.stringify(payload.symbol_expectancy, null, 2)}

WORST TRADES — narrative context for each (their own words):
${JSON.stringify(payload.worst_trade_narratives, null, 2)}

LONGEST TILT SEQUENCE (chronological, plain English):
${payload.tilt_narrative || "No qualifying tilt sequence (no 3+ consecutive losses)."}

JOURNALING GAPS:
- Reviewed trades: ${payload.psychology?.reviewed_count ?? 0}
- Unreviewed trades: ${payload.psychology?.unreviewed_count ?? 0}
- R impact of unreviewed trades: ${payload.unreviewed_r_impact ?? 0}R
${(payload.psychology?.unreviewed_count ?? 0) > 5 ? "→ Significant journaling gap. Mention it in The One Thing if relevant." : ""}

REVIEW EXCERPTS (the trader's own words across other trades):
${JSON.stringify((payload.review_excerpts || []).slice(0, 20), null, 2)}

Whitelisted trade IDs you may cite: ${validTradeIds.length} ids available.
Whitelisted symbols: ${validSymbols.join(', ')}
Whitelisted emotions: ${validEmotions.join(', ')}

Write the 5 sections, the headline verdict, the letter grade, and 3 measurable goals.`;

  const tools = [{
    type: "function",
    function: {
      name: "publish_sensei_report",
      description: "Publish the structured sensei coaching output.",
      parameters: {
        type: "object",
        properties: {
          verdict: { type: "string", description: "ONE punchy headline sentence (≤25 words). No banned openers." },
          grade: { type: "string", enum: ["A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D", "F"] },
          sections: {
            type: "array",
            items: {
              type: "object",
              properties: {
                heading: { type: "string" },
                body: { type: "string", description: "Markdown coaching prose (≥50 words). Anchor every paragraph in cited trades." },
                cited_trade_ids: { type: "array", items: { type: "string" } },
              },
              required: ["heading", "body", "cited_trade_ids"],
              additionalProperties: false,
            },
            minItems: 5,
            maxItems: 5,
          },
          goals: {
            type: "array",
            items: {
              type: "object",
              properties: {
                text: { type: "string" },
                metric: { type: "string", description: "machine-checkable metric name" },
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
        },
        required: ["verdict", "grade", "sections", "goals"],
        additionalProperties: false,
      },
    },
  }];

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools,
      tool_choice: { type: "function", function: { name: "publish_sensei_report" } },
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`AI gateway ${resp.status}: ${txt}`);
  }
  const data = await resp.json();
  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) throw new Error("No tool call returned by model");
  const args = JSON.parse(call.function.arguments);

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

  const filtered = rawSections.filter((s: any) => {
    const lower = s.body.toLowerCase().trim();
    // Hard-drop only on a banned opener (clear "recap-the-table" tell)
    if (BANNED_OPENERS.some(o => lower.startsWith(o))) return false;
    // Verdict section is allowed to summarize without citations
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

  // If filtering left us with <5, fall back to raw sections (with UUIDs stripped) — better partial than blank
  const sections = filtered.length >= 5 ? filtered : rawSections;

  // Goals stamped with status pending
  const goals = (args.goals || []).map((g: any) => ({
    id: crypto.randomUUID(),
    ...g,
    status: 'pending' as const,
  }));

  return {
    verdict: rewriteVerdict(stripUuids(args.verdict || "")),
    grade: args.grade,
    sections,
    goals,
  };
}

// ------------------------------ LLM context builder (shared) ------------------------------
// Builds the rich worst-trade narrative + tilt narrative + symbol expectancy + review excerpts
// from raw trades/reviews. Used by both initial generation and rerun-sensei.
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
    .select('id, trade_number, symbol, direction, entry_time, exit_time, net_pnl, r_multiple_actual, risk_percent, session, playbook_id, is_open, trade_type, total_lots, account_id')
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
  const sortedByR = [...closedExec].sort((a, b) => (a.r_multiple_actual ?? 0) - (b.r_multiple_actual ?? 0));
  const sortedByTime = [...closedExec].sort((a, b) => a.entry_time.localeCompare(b.entry_time));
  const worstTradeNarratives = sortedByR.slice(0, 3).map(t => {
    const r = reviews.get(t.id);
    const idx = sortedByTime.findIndex(x => x.id === t.id);
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

  const longestTilt = [...((storedPsychology?.tilt_sequences) || [])].sort((a: any, b: any) => b.length - a.length)[0];
  let tiltNarrative: string | null = null;
  if (longestTilt && longestTilt.trade_ids?.length) {
    const tiltTrades = longestTilt.trade_ids
      .map((id: string) => closedExec.find(t => t.id === id))
      .filter(Boolean) as TradeRow[];
    tiltNarrative = tiltTrades
      .map(t => `${formatClock(t.entry_time)} ${(t.r_multiple_actual ?? 0) >= 0 ? "won" : "lost"} ${(t.r_multiple_actual ?? 0).toFixed(1)}R on ${humanSymbol(t.symbol)}`)
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
      const wins = ts.filter(t => (t.net_pnl ?? 0) > 0).length;
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

  const unreviewedR = closedExec
    .filter(t => !reviews.has(t.id))
    .reduce((s, t) => s + (t.r_multiple_actual ?? 0), 0);

  return {
    metrics: storedMetrics,
    edge_clusters: storedEdges,
    leak_clusters: storedLeaks,
    consistency: storedConsistency,
    psychology: storedPsychology,
    review_excerpts: reviewExcerpts,
    worst_trade_narratives: worstTradeNarratives,
    tilt_narrative: tiltNarrative,
    symbol_expectancy: symbolExpectancy,
    unreviewed_r_impact: +unreviewedR.toFixed(2),
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

      const model = body.model || existing.sensei_model || (existing.report_type === 'custom' ? 'google/gemini-2.5-flash' : 'google/gemini-2.5-pro');

      const updatePayload: any = { sensei_regenerated_at: new Date().toISOString(), sensei_model: model };
      try {
        const result = await callSensei(llmPayload, model);
        updatePayload.sensei_notes = { sections: result.sections };
        updatePayload.verdict = result.verdict;
        updatePayload.grade = result.grade;
        updatePayload.goals = result.goals;
        updatePayload.status = 'completed';
        updatePayload.error_message = null;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("Sensei rerun failed:", msg);
        // Keep prior narrative — only flag failure
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
      .select('id, trade_number, symbol, direction, entry_time, exit_time, net_pnl, r_multiple_actual, risk_percent, session, playbook_id, is_open, trade_type, total_lots, account_id')
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

    // user_settings for schema suggestions + prior report for goal evaluation
    const { data: settings } = await admin.from('user_settings').select('live_trade_questions').eq('user_id', targetUserId).maybeSingle();

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
    const suggestions = schemaSuggestions(trades as TradeRow[], reviews, settings?.live_trade_questions as any[] || []);

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

    // Worst-trade narratives — top 3 losses with full review context + time gap to prior trade
    const closedExec = (trades as TradeRow[]).filter(t => !t.is_open && t.trade_type === 'executed');
    const sortedByR = [...closedExec].sort((a, b) => (a.r_multiple_actual ?? 0) - (b.r_multiple_actual ?? 0));
    const sortedByTime = [...closedExec].sort((a, b) => a.entry_time.localeCompare(b.entry_time));
    const worstTradeNarratives = sortedByR.slice(0, 3).map(t => {
      const r = reviews.get(t.id);
      const idx = sortedByTime.findIndex(x => x.id === t.id);
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

    // Tilt narrative — longest tilt sequence as plain English chronology
    const longestTilt = [...(psychology.tilt_sequences || [])].sort((a: any, b: any) => b.length - a.length)[0];
    let tiltNarrative: string | null = null;
    if (longestTilt && longestTilt.trade_ids?.length) {
      const tiltTrades = longestTilt.trade_ids
        .map((id: string) => closedExec.find(t => t.id === id))
        .filter(Boolean) as TradeRow[];
      tiltNarrative = tiltTrades
        .map(t => `${formatClock(t.entry_time)} ${(t.r_multiple_actual ?? 0) >= 0 ? "won" : "lost"} ${(t.r_multiple_actual ?? 0).toFixed(1)}R on ${humanSymbol(t.symbol)}`)
        .join(" → ");
    }

    // Symbol-level expectancy ranked
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
        const wins = ts.filter(t => (t.net_pnl ?? 0) > 0).length;
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

    // Unreviewed R impact
    const unreviewedR = closedExec
      .filter(t => !reviews.has(t.id))
      .reduce((s, t) => s + (t.r_multiple_actual ?? 0), 0);

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
      unreviewed_r_impact: +unreviewedR.toFixed(2),
      _valid_trade_ids: tradeIds,
      _valid_symbols: Array.from(new Set(trades.map(t => t.symbol))),
      _valid_emotions: Array.from(new Set(Array.from(reviews.values()).map(r => r.emotional_state_before).filter(Boolean))) as string[],
    };

    const model = report_type === 'custom' ? 'google/gemini-2.5-flash' : 'google/gemini-2.5-pro';

    let sensei = null;
    let verdict: string | null = null;
    let grade: string | null = null;
    let goals: any[] = [];
    let sensei_error: string | null = null;
    try {
      const result = await callSensei(llmPayload, model);
      sensei = { sections: result.sections };
      verdict = result.verdict;
      grade = result.grade;
      goals = result.goals;
    } catch (e) {
      sensei_error = e instanceof Error ? e.message : String(e);
      console.error("Sensei generation failed:", sensei_error);
    }

    const status = sensei_error ? 'failed' : 'completed';

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
      sensei_model: model,
      schema_suggestions: suggestions,
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
