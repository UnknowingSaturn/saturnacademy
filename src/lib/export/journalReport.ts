/**
 * Pure Markdown generator for an LLM-ready journal report.
 * Inputs are plain DB rows so it runs both in the browser and in scripts.
 */

export interface ReportTradeRow {
  id: string;
  symbol: string;
  direction: string;
  trade_type?: string | null;
  is_archived?: boolean | null;
  is_open?: boolean | null;
  group_key?: string | null;
  group_role?: string | null;
  trade_number?: number | null;
  session?: string | null;
  entry_time: string;
  exit_time?: string | null;
  total_lots?: number | null;
  entry_price?: number | null;
  exit_price?: number | null;
  sl_initial?: number | null;
  sl_final?: number | null;
  tp_initial?: number | null;
  tp_final?: number | null;
  gross_pnl?: number | null;
  commission?: number | null;
  swap?: number | null;
  net_pnl?: number | null;
  r_multiple_planned?: number | null;
  r_multiple_actual?: number | null;
  risk_percent?: number | null;
  duration_seconds?: number | null;
  playbook_id?: string | null;
  actual_playbook_id?: string | null;
  profile?: string | null;
  actual_profile?: string | null;
  actual_regime?: string | null;
  alignment?: string[] | null;
  entry_timeframes?: string[] | null;
  custom_fields?: Record<string, unknown> | null;
}

export interface ReportReviewRow {
  trade_id: string;
  playbook_id?: string | null;
  checklist_answers?: Record<string, unknown> | null;
  score?: number | null;
  regime?: string | null;
  news_risk?: string | null;
  emotional_state_before?: string | null;
  emotional_state_after?: string | null;
  psychology_notes?: string | null;
  mistakes?: unknown;
  did_well?: unknown;
  to_improve?: unknown;
  actionable_steps?: unknown;
  thoughts?: string | null;
  screenshots?: unknown;
}

export interface ReportPlaybookRow {
  id: string;
  name: string;
  description?: string | null;
  session_filter?: string[] | null;
  symbol_filter?: string[] | null;
  valid_regimes?: string[] | null;
  entry_zone_rules?: unknown;
  confirmation_rules?: string[] | null;
  invalidation_rules?: string[] | null;
  management_rules?: string[] | null;
  failure_modes?: string[] | null;
  max_r_per_trade?: number | null;
  max_daily_loss_r?: number | null;
  max_trades_per_session?: number | null;
  checklist_questions?: unknown;
}

export interface ReportFieldDef {
  key: string;
  label: string;
}

export interface ReportCommentRow {
  trade_id: string;
  content: string;
  created_at: string;
}

export interface JournalReportInput {
  trades: ReportTradeRow[];
  reviews: ReportReviewRow[];
  playbooks: ReportPlaybookRow[];
  fieldDefs: ReportFieldDef[];
  comments?: ReportCommentRow[];
  generatedAt?: Date;
}

/** One logical trade = all legs sharing a group_key (or a lone trade). */
export interface LogicalTrade {
  primary: ReportTradeRow;
  legs: ReportTradeRow[];
}

export function eligibleTrades(trades: ReportTradeRow[]): ReportTradeRow[] {
  return trades.filter(
    (t) => (t.trade_type ?? "executed") === "executed" && !t.is_archived,
  );
}

export function groupLegs(trades: ReportTradeRow[]): LogicalTrade[] {
  const map = new Map<string, ReportTradeRow[]>();
  for (const t of trades) {
    const k = t.group_key || t.id;
    const arr = map.get(k);
    if (arr) arr.push(t);
    else map.set(k, [t]);
  }
  const out: LogicalTrade[] = [];
  for (const legs of map.values()) {
    legs.sort((a, b) => a.entry_time.localeCompare(b.entry_time));
    const primary = legs.find((l) => l.group_role === "primary") ?? legs[0];
    out.push({ primary, legs });
  }
  out.sort((a, b) => a.primary.entry_time.localeCompare(b.primary.entry_time));
  return out;
}

const num = (v: unknown) => (typeof v === "number" ? v : v == null || v === "" ? null : Number(v));
const sum = (legs: ReportTradeRow[], f: (l: ReportTradeRow) => unknown) => {
  let s = 0;
  let any = false;
  for (const l of legs) {
    const n = num(f(l));
    if (n != null && !Number.isNaN(n)) {
      s += n;
      any = true;
    }
  }
  return any ? s : null;
};
const fmt = (v: unknown, dp = 2): string => {
  const n = num(v);
  if (n == null || Number.isNaN(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(dp).replace(/\.?0+$/, "");
};
const fmtPrice = (v: unknown) => fmt(v, 5);
const txt = (v: unknown) => (v == null || v === "" ? "—" : String(v).replace(/\s+/g, " ").trim());
const utc = (iso?: string | null) => (iso ? new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—");

function list(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? x : x && typeof x === "object" ? (x as any).text ?? (x as any).label ?? JSON.stringify(x) : String(x)))
    .map((s) => String(s).trim())
    .filter(Boolean);
}

/** Summed R across legs (each leg's R is relative to its own risk); P&L summed. */
function aggregateR(legs: ReportTradeRow[]): number | null {
  // Legs share one idea and one stop: average R weighted by lots.
  let w = 0;
  let acc = 0;
  for (const l of legs) {
    const r = num(l.r_multiple_actual);
    const lots = num(l.total_lots) ?? 1;
    if (r == null || Number.isNaN(r)) continue;
    acc += r * lots;
    w += lots;
  }
  return w > 0 ? acc / w : null;
}

interface Stat {
  n: number;
  wins: number;
  pnl: number;
  rSum: number;
  rN: number;
}
const emptyStat = (): Stat => ({ n: 0, wins: 0, pnl: 0, rSum: 0, rN: 0 });

function statLine(label: string, s: Stat) {
  const wr = s.n ? ((s.wins / s.n) * 100).toFixed(1) + "%" : "—";
  const avgR = s.rN ? (s.rSum / s.rN).toFixed(2) : "—";
  return `| ${label} | ${s.n} | ${wr} | ${s.pnl.toFixed(2)} | ${avgR} |`;
}

export function buildJournalReport(input: JournalReportInput): string {
  const { reviews, playbooks, fieldDefs, comments = [] } = input;
  const generatedAt = input.generatedAt ?? new Date();
  const groups = groupLegs(eligibleTrades(input.trades));
  const reviewBy = new Map(reviews.map((r) => [r.trade_id, r]));
  const pbBy = new Map(playbooks.map((p) => [p.id, p]));
  const labelBy = new Map(fieldDefs.map((f) => [f.key, f.label]));
  const commentsBy = new Map<string, ReportCommentRow[]>();
  for (const c of comments) {
    const a = commentsBy.get(c.trade_id) ?? [];
    a.push(c);
    commentsBy.set(c.trade_id, a);
  }
  const labelFor = (key: string) => labelBy.get(key) ?? key;
  const pbName = (id?: string | null) => (id ? pbBy.get(id)?.name ?? "(deleted playbook)" : "none");

  const L: string[] = [];
  const first = groups[0]?.primary.entry_time;
  const last = groups[groups.length - 1]?.primary.entry_time;

  // Header
  L.push("# Trading Journal Report (LLM input)");
  L.push("");
  L.push(`Generated: ${utc(generatedAt.toISOString())}`);
  L.push(`Period: ${utc(first)} → ${utc(last)}`);
  L.push(`Trades: ${groups.length} logical executed trades (${groups.reduce((a, g) => a + g.legs.length, 0)} broker legs). Archived, idea, paper and missed trades excluded.`);
  L.push("");
  L.push("Conventions: all times UTC. Prices in instrument quote units. P&L in account currency (net = gross + commission + swap). R = realised profit ÷ initial risk (entry→initial SL). Multi-TP legs of one idea are merged into one trade; P&L is summed, R is lot-weighted across legs. '—' means not recorded.");
  L.push("");

  // Playbooks
  L.push("## Playbooks (strategy rules)");
  L.push("");
  if (!playbooks.length) L.push("_No playbooks defined._");
  for (const p of playbooks) {
    L.push(`### ${p.name}`);
    if (p.description) L.push(txt(p.description));
    const row = (k: string, v: unknown) => {
      const items = Array.isArray(v) ? list(v) : v == null || v === "" ? [] : [typeof v === "object" ? JSON.stringify(v) : String(v)];
      if (items.length) L.push(`- **${k}:** ${items.join("; ")}`);
    };
    row("Sessions", p.session_filter);
    row("Symbols", p.symbol_filter);
    row("Valid regimes", p.valid_regimes);
    row("Entry zone", p.entry_zone_rules);
    row("Confirmation", p.confirmation_rules);
    row("Invalidation", p.invalidation_rules);
    row("Management", p.management_rules);
    row("Failure modes", p.failure_modes);
    row("Max R per trade", p.max_r_per_trade);
    row("Max daily loss (R)", p.max_daily_loss_r);
    row("Max trades per session", p.max_trades_per_session);
    const qs = Array.isArray(p.checklist_questions)
      ? (p.checklist_questions as any[]).map((q) => q?.question).filter(Boolean)
      : [];
    if (qs.length) L.push(`- **Checklist:** ${qs.join(" | ")}`);
    L.push("");
  }

  // Summary
  const all = emptyStat();
  const by: Record<string, Map<string, Stat>> = { Playbook: new Map(), Symbol: new Map(), Session: new Map(), Direction: new Map() };
  const closed = groups.filter((g) => g.legs.every((l) => !l.is_open));
  for (const g of closed) {
    const p = g.primary;
    const pnl = sum(g.legs, (l) => l.net_pnl) ?? 0;
    const r = aggregateR(g.legs);
    const keys = {
      Playbook: pbName(reviewBy.get(p.id)?.playbook_id ?? p.actual_playbook_id ?? p.playbook_id),
      Symbol: p.symbol,
      Session: p.session ?? "unknown",
      Direction: p.direction,
    };
    for (const s of [all, ...Object.entries(keys).map(([dim, k]) => {
      const m = by[dim];
      if (!m.has(k)) m.set(k, emptyStat());
      return m.get(k)!;
    })]) {
      s.n++;
      if (pnl > 0) s.wins++;
      s.pnl += pnl;
      if (r != null) {
        s.rSum += r;
        s.rN++;
      }
    }
  }
  L.push("## Summary (closed trades)");
  L.push("");
  L.push("| Group | Trades | Win rate | Net P&L | Avg R (expectancy) |");
  L.push("|---|---|---|---|---|");
  L.push(statLine("ALL", all));
  for (const [dim, m] of Object.entries(by)) {
    for (const [k, s] of [...m.entries()].sort((a, b) => b[1].n - a[1].n)) L.push(statLine(`${dim}: ${k}`, s));
  }
  L.push("");

  // Trades
  L.push("## Trades");
  L.push("");
  groups.forEach((g, i) => {
    const p = g.primary;
    const rv = g.legs.map((l) => reviewBy.get(l.id)).find(Boolean);
    const pnl = sum(g.legs, (l) => l.net_pnl);
    const r = aggregateR(g.legs);
    const open = g.legs.some((l) => l.is_open);
    L.push(`### ${i + 1}. ${p.symbol} ${p.direction.toUpperCase()} — ${utc(p.entry_time)}${p.trade_number ? ` (#${p.trade_number})` : ""}`);
    L.push(`- **Outcome:** ${open ? "OPEN" : pnl == null ? "—" : pnl > 0 ? "WIN" : pnl < 0 ? "LOSS" : "BREAKEVEN"} | Net P&L ${fmt(pnl)} | R ${fmt(r)} (planned ${fmt(p.r_multiple_planned)})`);
    L.push(`- **Session:** ${txt(p.session)} | Exit ${utc(p.exit_time)} | Duration ${p.duration_seconds != null ? Math.round(p.duration_seconds / 60) + " min" : "—"}`);
    L.push(`- **Size:** ${fmt(sum(g.legs, (l) => l.total_lots))} lots across ${g.legs.length} leg(s) | Risk ${fmt(p.risk_percent)}%`);
    L.push(`- **Prices:** entry ${fmtPrice(p.entry_price)} | SL ${fmtPrice(p.sl_initial)} → ${fmtPrice(p.sl_final)} | TP ${fmtPrice(p.tp_initial)} → ${fmtPrice(p.tp_final)} | exit ${fmtPrice(p.exit_price)}`);
    if (g.legs.length > 1) {
      L.push(`- **Legs:** ${g.legs.map((l) => `${fmt(l.total_lots)}L exit ${fmtPrice(l.exit_price)} TP ${fmtPrice(l.tp_initial)} P&L ${fmt(l.net_pnl)} R ${fmt(l.r_multiple_actual)}`).join("; ")}`);
    }
    L.push(`- **Costs:** commission ${fmt(sum(g.legs, (l) => l.commission))} | swap ${fmt(sum(g.legs, (l) => l.swap))}`);
    L.push(`- **Model:** planned playbook ${pbName(rv?.playbook_id ?? p.playbook_id)} / profile ${txt(p.profile)} | actual playbook ${pbName(p.actual_playbook_id)} / profile ${txt(p.actual_profile)}`);
    L.push(`- **Context:** regime ${txt(rv?.regime ?? p.actual_regime)} | news risk ${txt(rv?.news_risk)} | alignment ${(p.alignment ?? []).join(", ") || "—"} | entry TFs ${(p.entry_timeframes ?? []).join(", ") || "—"}`);
    const cf = Object.entries(p.custom_fields ?? {}).filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && !v.length));
    if (cf.length) L.push(`- **Custom fields:** ${cf.map(([k, v]) => `${labelFor(k)} = ${Array.isArray(v) ? v.join(", ") : txt(v)}`).join(" | ")}`);
    if (rv) {
      L.push(`- **Emotion:** before ${txt(rv.emotional_state_before)} → after ${txt(rv.emotional_state_after)}${rv.psychology_notes ? ` — ${txt(rv.psychology_notes)}` : ""}`);
      const pb = pbBy.get(rv.playbook_id ?? p.playbook_id ?? "");
      const ans = rv.checklist_answers ?? {};
      if (Object.keys(ans).length) {
        const qs = Array.isArray(pb?.checklist_questions) ? (pb!.checklist_questions as any[]) : [];
        const qText = (k: string) => {
          const q = qs.find((x) => x?.id === k);
          if (q) return q.question;
          const m = /^(confirmation|invalidation|management)_(\d+)$/.exec(k);
          const rules = m ? (pb as any)?.[`${m[1]}_rules`] : null;
          return m && Array.isArray(rules) && rules[+m[2]] ? `${m[1]}: ${rules[+m[2]]}` : k;
        };
        L.push(`- **Checklist${rv.score != null ? ` (score ${rv.score})` : ""}:** ${Object.entries(ans).map(([k, v]) => `${qText(k)} = ${v === true ? "yes" : v === false ? "no" : txt(v)}`).join(" | ")}`);
      }
      const block = (k: string, v: unknown) => {
        const items = list(v);
        if (items.length) L.push(`- **${k}:** ${items.join("; ")}`);
      };
      block("Did well", rv.did_well);
      block("Mistakes", rv.mistakes);
      block("To improve", rv.to_improve);
      block("Action steps", rv.actionable_steps);
      if (rv.thoughts) L.push(`- **Thoughts:** ${txt(rv.thoughts)}`);
      const shots = Array.isArray(rv.screenshots) ? (rv.screenshots as any[]) : [];
      const described = shots.filter((s) => s?.description || s?.timeframe || s?.label);
      if (described.length) {
        L.push(`- **Screenshots:**`);
        for (const s of described) L.push(`  - [${txt(s.timeframe ?? s.label)}] ${txt(s.description)}`);
      }
    }
    const cs = g.legs.flatMap((l) => commentsBy.get(l.id) ?? []);
    if (cs.length) L.push(`- **Comments:** ${cs.map((c) => txt(c.content)).join(" | ")}`);
    L.push("");
  });

  // Data dictionary
  L.push("## Data dictionary");
  L.push("");
  L.push("- **Outcome**: WIN if summed net P&L > 0, LOSS if < 0.");
  L.push("- **SL a → b / TP a → b**: initial level at entry → final level at exit (shows stop moves / trailing).");
  L.push("- **Planned vs actual model**: what the trader intended before entry vs what the trade turned out to be in review.");
  L.push("- **Checklist**: answers to the playbook's pre-trade questions/rules; 'no' means the rule was not satisfied.");
  L.push("- **Screenshots**: chart captures; text is the trader's own description, bracket is the chart timeframe.");
  for (const f of fieldDefs.filter((f) => f.key.startsWith("cf_"))) {
    L.push(`- **${f.label}**: trader-defined custom field (key \`${f.key}\`).`);
  }
  L.push("");
  return L.join("\n");
}
