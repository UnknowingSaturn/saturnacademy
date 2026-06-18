import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TrendingUp, TrendingDown, AlertCircle, Target, Brain, Activity, Sparkles, Trophy, Skull, RefreshCw, Eye, Calculator, FlaskConical } from "lucide-react";
import { format, parseISO } from "date-fns";
import { CitedTradeChip } from "./CitedTradeChip";
import { SchemaSuggestionCard } from "./SchemaSuggestionCard";
import { useRerunSensei } from "@/hooks/useSenseiReports";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import type { Report, SchemaSuggestion } from "@/types/reports";

// Same dedupe logic as backend — keeps historical reports honest.
const SYSTEM_FIELD_KEYS = new Set([
  "mistakes", "did_well", "to_improve", "psychology_notes", "thoughts",
  "emotional_state_before", "emotional_state_after", "news_risk", "regime",
  "score", "checklist_answers", "session", "playbook_id", "actual_playbook_id",
  "profile", "actual_profile",
]);
const SYSTEM_FIELD_LABEL_TOKENS = new Set([
  "mistake", "mistakes", "primary cause of mistake", "what went well", "did well",
  "what to improve", "to improve", "psychology", "psychology notes", "thoughts",
  "emotion", "emotional state", "feeling", "how are you feeling",
  "news", "news risk", "high impact news", "regime", "score", "checklist",
  "session", "playbook", "setup", "model", "profile",
]);
function normalizeLabel(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function suggestionExists(
  s: SchemaSuggestion,
  keys: Set<string>,
  labels: Set<string>,
): boolean {
  const id = s.proposed_question?.id;
  const missing = s.missing_field;
  const label = s.proposed_question?.label;
  if (id && keys.has(id)) return true;
  if (missing && keys.has(missing)) return true;
  if (label) {
    const norm = normalizeLabel(label);
    if (labels.has(norm)) return true;
    for (const tok of labels) {
      if (tok && (norm.includes(tok) || tok.includes(norm))) return true;
    }
  }
  return false;
}

interface Props { report: Report }

function formatNum(n: number | null | undefined, digits = 2): string {
  if (n == null || !isFinite(n)) return "—";
  return n.toFixed(digits);
}

function gradeColors(grade: string | null | undefined) {
  if (!grade) return { text: "text-muted-foreground", from: "from-muted/30" };
  const l = grade[0];
  if (l === "A") return { text: "text-success", from: "from-success/15" };
  if (l === "B") return { text: "text-primary", from: "from-primary/15" };
  if (l === "C") return { text: "text-warning", from: "from-warning/15" };
  return { text: "text-destructive", from: "from-destructive/15" };
}

function DeltaCell({ value, invert = false, unit = "" }: { value: number | undefined; invert?: boolean; unit?: "$" | "R" | "%" | "" }) {
  if (value == null || !isFinite(value) || value === 0) return null;
  const positive = invert ? value < 0 : value > 0;
  const Icon = value > 0 ? TrendingUp : TrendingDown;
  const abs = Math.abs(value);
  const formatted =
    unit === "$"
      ? `${value > 0 ? "+" : "-"}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
      : unit === "R"
      ? `${value > 0 ? "+" : ""}${value.toFixed(2)}R`
      : unit === "%"
      ? `${value > 0 ? "+" : ""}${value.toFixed(1)}%`
      : `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs ${positive ? "text-success" : "text-destructive"}`}>
      <Icon className="w-3 h-3" />
      {formatted}
    </span>
  );
}

function InlineProse({ text }: { text: string }) {
  return (
    <div className="prose prose-sm max-w-none text-foreground/90 leading-relaxed
                    prose-p:my-3 prose-p:leading-[1.7]
                    prose-strong:text-foreground prose-strong:font-semibold
                    prose-em:text-foreground/80">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

export function ReportView({ report }: Props) {
  const isEmpty = report.metrics?.current == null;
  const m = report.metrics?.current;
  const d = report.metrics?.deltas || {};
  const period = `${format(parseISO(report.period_start), "MMM d")} – ${format(parseISO(report.period_end), "MMM d, yyyy")}`;
  const typeLabel = report.report_type.toUpperCase();
  const colors = gradeColors(report.grade);
  const rerun = useRerunSensei();
  const isRerunning = rerun.isPending && rerun.variables === report.id;

  // Frontend dedupe — protects historical reports from re-suggesting fields the user already has
  const { user } = useAuth();
  const { data: existingFields } = useQuery({
    queryKey: ["existing_journal_fields", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      // All field-like keys (live questions + custom fields) live in custom_field_definitions
      const { data: defs } = await (supabase as any)
        .from("custom_field_definitions")
        .select("key,label,scope,is_active")
        .eq("user_id", user!.id)
        .eq("is_active", true);
      const keys = new Set<string>(SYSTEM_FIELD_KEYS);
      const labels = new Set<string>(SYSTEM_FIELD_LABEL_TOKENS);
      for (const f of (defs as any[]) || []) {
        if (f?.key) keys.add(String(f.key));
        if (f?.label) labels.add(normalizeLabel(f.label));
      }
      return { keys, labels };
    },
  });
  const filteredSuggestions = useMemo(() => {
    const list = report.schema_suggestions || [];
    if (!existingFields) return list;
    return list.filter((s) => !suggestionExists(s, existingFields.keys, existingFields.labels));
  }, [report.schema_suggestions, existingFields]);

  return (
    <article className="max-w-4xl mx-auto pb-16">
      {/* HERO */}
      <header className={`relative overflow-hidden border-b border-border bg-gradient-to-br ${colors.from} via-background to-background`}>
        <div className="px-8 pt-10 pb-12">
          <div className="flex items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-2 text-[11px] font-bold tracking-[0.2em] text-muted-foreground">
              <Sparkles className="w-3.5 h-3.5" />
              <span>{typeLabel} SENSEI · {period}</span>
            </div>
            {!isEmpty && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => rerun.mutate(report.id)}
                disabled={isRerunning}
                className="h-7 text-xs"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRerunning ? "animate-spin" : ""}`} />
                {isRerunning ? "Rewriting…" : "Re-run Sensei"}
              </Button>
            )}
          </div>

          <div className="flex items-start gap-8">
            {report.grade && (
              <div className="shrink-0 -mt-2">
                <div className={`text-8xl font-black leading-none tabular-nums ${colors.text}`}>
                  {report.grade}
                </div>
                <div className="mt-1 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">grade</div>
              </div>
            )}
            <div className="flex-1 min-w-0 pt-1">
              <p className="font-serif italic text-2xl md:text-3xl leading-snug text-foreground">
                {report.verdict ? `“${report.verdict}”` : "Report ready."}
              </p>
              {report.sensei_regenerated_at && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Narrative refreshed {format(parseISO(report.sensei_regenerated_at), "MMM d, HH:mm")}
                </p>
              )}
            </div>
          </div>

          {!isEmpty && m && (
            <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
              <Stat label="Net P&L" value={`${m.total_pnl >= 0 ? "+" : ""}$${formatNum(m.total_pnl, 0)}`} positive={m.total_pnl >= 0} />
              <Stat label="Total R" value={`${m.total_r >= 0 ? "+" : ""}${formatNum(m.total_r, 1)}R`} positive={m.total_r >= 0} />
              <Stat label="Trades" value={`${m.trade_count}`} />
              <Stat label="Win rate" value={`${formatNum(m.win_rate, 0)}%`} />
              {m.checklist_compliance_pct != null && (
                <Stat label="Checklist" value={`${formatNum(m.checklist_compliance_pct, 0)}%`} />
              )}
            </div>
          )}

          {report.status === "failed" && report.error_message && (
            <Alert variant="destructive" className="mt-6">
              <AlertCircle className="w-4 h-4" />
              <AlertDescription className="text-xs">
                Sensei narrative failed to generate: {report.error_message}. Computed metrics below are still valid.
              </AlertDescription>
            </Alert>
          )}
        </div>
      </header>

      {isEmpty ? (
        <div className="px-8 pt-12 text-center text-muted-foreground">No trades in this period.</div>
      ) : (
        <div className="px-8 space-y-12 pt-10">

          {/* §7 Sensei's Notes — promoted to the top, article style */}
          {report.sensei_notes?.sections && report.sensei_notes.sections.length > 0 && (
            <section className="border-l-4 border-primary pl-6 md:pl-8 space-y-8">
              <div className="flex items-center gap-2 text-[11px] font-bold tracking-[0.2em] text-primary uppercase">
                <Sparkles className="w-3.5 h-3.5" /> Sensei's Notes
              </div>
              {report.sensei_notes.sections.map((s, i) => (
                <div key={i} className="space-y-3">
                  <h2 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
                    {s.heading}
                  </h2>
                  <InlineProse text={s.body} />
                  {s.cited_trade_ids.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1 pt-1">
                      {s.cited_trade_ids.map(id => <CitedTradeChip key={id} tradeId={id} />)}
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}

          {/* Quant block — server-computed Pair-Lab analytics */}
          {report.quant && <QuantSection quant={report.quant} />}

          {/* §3 What worked — success-tinted */}
          {report.edge_clusters.length > 0 && (
            <Card className="border-success/30 bg-success/5">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-success" /> What worked
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {report.edge_clusters.map((c, i) => (
                  <div key={i} className="flex items-start gap-3 pb-3 border-b border-success/15 last:border-0 last:pb-0">
                    <div className="flex-1">
                      <div className="font-medium text-sm">{c.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {c.trades} trades · {c.wins}W / {c.trades - c.wins}L · {formatNum(c.total_r, 1)}R · ${formatNum(c.total_pnl, 0)}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {c.trade_ids.slice(0, 8).map(id => <CitedTradeChip key={id} tradeId={id} />)}
                      </div>
                    </div>
                    <Badge variant="outline" className="border-success/40 text-success shrink-0 bg-background/50">
                      +{formatNum(c.expectancy_r)}R/trade
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* §4 What bled — destructive-tinted */}
          {report.leak_clusters.length > 0 && (
            <Card className="border-destructive/30 bg-destructive/5">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Skull className="w-4 h-4 text-destructive" /> What bled
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {report.leak_clusters.map((c, i) => (
                  <div key={i} className="flex items-start gap-3 pb-3 border-b border-destructive/15 last:border-0 last:pb-0">
                    <div className="flex-1">
                      <div className="font-medium text-sm">{c.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{c.description}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {c.trades} trades · {c.wins}W / {c.trades - c.wins}L · {formatNum(c.total_r, 1)}R · ${formatNum(c.total_pnl, 0)}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {c.trade_ids.slice(0, 8).map(id => <CitedTradeChip key={id} tradeId={id} />)}
                      </div>
                    </div>
                    <Badge variant="outline" className="border-destructive/40 text-destructive shrink-0 bg-background/50">
                      {c.pattern_type}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* §2 Numbers — compact horizontal strip */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="w-4 h-4" /> The numbers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4">
                {([
                  { label: "Net P&L", value: `$${formatNum(m?.total_pnl, 0)}`, delta: d.total_pnl, unit: "$" as const },
                  { label: "Total R", value: `${formatNum(m?.total_r, 1)}R`, delta: d.total_r, unit: "R" as const },
                  { label: "Trades", value: `${m?.trade_count ?? 0}`, delta: d.trade_count, unit: "" as const },
                  { label: "Win rate", value: `${formatNum(m?.win_rate, 1)}%`, delta: d.win_rate, unit: "%" as const },
                  { label: "Profit factor", value: formatNum(m?.profit_factor), delta: d.profit_factor, unit: "" as const },
                  { label: "Expectancy", value: `${formatNum(m?.expectancy_r)}R`, delta: d.expectancy_r, unit: "R" as const },
                  { label: "Max DD", value: `${formatNum(m?.max_drawdown_r)}R`, delta: d.max_drawdown_r, invert: true, unit: "R" as const },
                  { label: "Checklist", value: m?.checklist_compliance_pct != null ? `${formatNum(m.checklist_compliance_pct, 0)}%` : "—", delta: d.checklist_compliance_pct, unit: "%" as const },
                ]).map((cell) => (
                  <div key={cell.label}>
                    <div className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">{cell.label}</div>
                    <div className="text-xl font-semibold mt-1 tabular-nums">{cell.value}</div>
                    <div className="h-4 mt-0.5"><DeltaCell value={cell.delta as number | undefined} invert={(cell as any).invert} unit={cell.unit} /></div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* §5 Consistency — horizontal stat row */}
          {report.consistency && Object.keys(report.consistency).length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Consistency audit</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <ConsistencyStat
                    label="Pair concentration"
                    value={formatNum(report.consistency.pair_concentration?.hhi, 2)}
                    sub={report.consistency.pair_concentration?.top_symbol
                      ? `${report.consistency.pair_concentration.top_symbol} ${formatNum((report.consistency.pair_concentration.top_symbol_share ?? 0) * 100, 0)}%`
                      : undefined}
                    flagged={report.consistency.pair_concentration?.flagged}
                    flagText="over-concentrated"
                  />
                  <ConsistencyStat
                    label="Risk variance"
                    value={`σ ${formatNum(report.consistency.risk_consistency?.risk_pct_stddev, 2)}%`}
                    flagged={report.consistency.risk_consistency?.flagged}
                    flagText="variable"
                  />
                  <ConsistencyStat
                    label="Frequency"
                    value={`${formatNum(report.consistency.frequency_drift?.trades_per_day)}/day`}
                    sub={`baseline ${formatNum(report.consistency.frequency_drift?.baseline_trades_per_day)}`}
                    flagged={report.consistency.frequency_drift?.flagged}
                    flagText="drifting"
                  />
                  <ConsistencyStat
                    label="Time discipline"
                    value={report.consistency.time_discipline?.flagged_sessions?.length
                      ? "Drifting"
                      : "On-rhythm"}
                    sub={report.consistency.time_discipline?.flagged_sessions?.join(", ") || undefined}
                    flagged={!!report.consistency.time_discipline?.flagged_sessions?.length}
                    flagText="off-rhythm"
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* §5b Read quality — planned-vs-actual playbook grading */}
          {report.read_quality && report.read_quality.graded_count >= 5 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Eye className="w-4 h-4" /> Read quality
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <div className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">Correctly read</div>
                    <div className="text-xl font-semibold mt-1 tabular-nums text-success">
                      {report.read_quality.match}
                      <span className="text-xs text-muted-foreground ml-1">/ {report.read_quality.graded_count}</span>
                    </div>
                    {report.read_quality.win_rate_when_correctly_read != null && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {formatNum(report.read_quality.win_rate_when_correctly_read, 0)}% win rate
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">Partial</div>
                    <div className="text-xl font-semibold mt-1 tabular-nums text-warning">
                      {report.read_quality.partial}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">Misread</div>
                    <div className="text-xl font-semibold mt-1 tabular-nums text-destructive">
                      {report.read_quality.mismatch}
                    </div>
                    {report.read_quality.win_rate_when_misread != null && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {formatNum(report.read_quality.win_rate_when_misread, 0)}% win rate
                      </div>
                    )}
                  </div>
                </div>
                {report.read_quality.top_misreads?.length > 0 && (
                  <div>
                    <div className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase mb-2">
                      Top misreads (planned → actual)
                    </div>
                    <div className="space-y-1">
                      {report.read_quality.top_misreads.map((m, i) => (
                        <div key={i} className="text-sm flex items-center justify-between border-b border-border/50 pb-1 last:border-0">
                          <span className="font-mono text-xs">{m.pair}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">{m.count}×</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* §6 Psychology — emotion heatmap */}
          {report.psychology && (report.psychology.top_emotions?.length || report.psychology.tilt_sequences?.length) && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2"><Brain className="w-4 h-4" /> Psychology patterns</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5 text-sm">
                {report.psychology.top_emotions?.length > 0 && (
                  <div>
                    <div className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase mb-2">
                      Emotional state → outcome
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {report.psychology.top_emotions.map(e => {
                        const positive = e.avg_r >= 0;
                        return (
                          <div
                            key={e.state}
                            className={`px-3 py-2 rounded-md border ${
                              positive ? "border-success/40 bg-success/10" : "border-destructive/40 bg-destructive/10"
                            }`}
                          >
                            <div className="text-xs font-semibold capitalize">{e.state}</div>
                            <div className={`text-sm font-bold tabular-nums ${positive ? "text-success" : "text-destructive"}`}>
                              {e.avg_r >= 0 ? "+" : ""}{formatNum(e.avg_r, 2)}R
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              {e.count} {e.count === 1 ? "trade" : "trades"}{!e.sample_size_ok && " · low n"}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {report.psychology.common_mistake_phrases?.length > 0 && (
                  <div>
                    <div className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase mb-2">
                      Recurring self-noted mistakes
                    </div>
                    <div className="space-y-1">
                      {report.psychology.common_mistake_phrases.map((p, i) => (
                        <div key={i} className="text-sm flex items-center justify-between border-b border-border/50 pb-1 last:border-0">
                          <span className="italic text-foreground/80">"{p.phrase}"</span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {p.count}× · <span className={p.cost_r < 0 ? "text-destructive" : "text-success"}>{formatNum(p.cost_r, 1)}R</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {report.psychology.tilt_sequences?.length > 0 && (
                  <div>
                    <div className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase mb-2">
                      Tilt sequences (3+ losses in a row)
                    </div>
                    <div className="space-y-1">
                      {report.psychology.tilt_sequences.map((t, i) => (
                        <div key={i} className="text-sm">
                          <span className="text-muted-foreground">{format(parseISO(t.started_at), "MMM d, HH:mm")}</span>
                          {" · "}
                          <span>{t.length} trades</span>
                          {" · "}
                          <span className="text-destructive font-medium tabular-nums">{formatNum(t.cumulative_r, 1)}R</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Prior goals evaluation */}
          {report.prior_goals_evaluation?.goals && report.prior_goals_evaluation.goals.length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Last period's goals</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {report.prior_goals_evaluation.goals.map((g, i) => (
                  <div key={i} className="flex items-start justify-between gap-2 text-sm">
                    <span className="flex-1">{g.text}</span>
                    <Badge variant="outline" className={g.status === "met" ? "border-success/40 text-success" : "border-destructive/40 text-destructive"}>
                      {g.status} · {formatNum(g.actual)}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* §9 Goals */}
          {report.goals && report.goals.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2"><Target className="w-4 h-4" /> Goals for next period</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {report.goals.map((g, i) => (
                  <div key={g.id || i} className="flex items-start gap-3 text-sm">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center">
                      {i + 1}
                    </span>
                    <span className="flex-1 leading-snug">{g.text}</span>
                    <Badge variant="outline" className="text-xs shrink-0 font-mono">{g.metric} {g.comparator} {g.target}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* §8 Schema suggestions */}
          {filteredSuggestions.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" /> Make next period's report sharper
              </h2>
              {filteredSuggestions.map((s, i) => <SchemaSuggestionCard key={i} suggestion={s} />)}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function Stat({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  const colorClass = positive == null ? "text-foreground" : positive ? "text-success" : "text-destructive";
  return (
    <div>
      <div className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">{label}</div>
      <div className={`text-lg font-bold tabular-nums mt-0.5 ${colorClass}`}>{value}</div>
    </div>
  );
}

function ConsistencyStat({
  label, value, sub, flagged, flagText,
}: { label: string; value: string; sub?: string; flagged?: boolean; flagText: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">{label}</div>
      <div className="text-base font-semibold mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      {flagged && (
        <Badge variant="outline" className="mt-1.5 border-destructive/40 text-destructive text-[10px]">
          {flagText}
        </Badge>
      )}
    </div>
  );
}

function driftLabel(d: string | null | undefined): { text: string; cls: string } | null {
  if (!d) return null;
  if (d === "too_wide") return { text: "SL too wide", cls: "border-warning/40 text-warning" };
  if (d === "too_tight") return { text: "SL too tight", cls: "border-destructive/40 text-destructive" };
  if (d === "aligned") return { text: "SL aligned", cls: "border-success/40 text-success" };
  return null;
}

function QuantSection({ quant }: { quant: NonNullable<Report["quant"]> }) {
  const cov = quant.coverage;
  const lowCoverage = cov && (cov.sl / Math.max(1, cov.total) < 0.7 || cov.mae / Math.max(1, cov.total) < 0.5);
  // Prefer intersection delta when present (bias-adjusted); fall back to raw delta.
  const effDelta = (r: typeof quant.strategy_replay[number]) =>
    r.delta_vs_current_intersection != null ? r.delta_vs_current_intersection : r.delta_vs_current;
  const beats = (quant.strategy_replay || [])
    .filter(r => r.n_eligible >= (quant.min_eligible_sample ?? 10) && effDelta(r) >= 0.15)
    .sort((a, b) => effDelta(b) - effDelta(a))
    .slice(0, 3);
  const propFirm = quant.prop_firm_context;
  const senseiQuality = quant.sensei_quality;

  const renderBucketRow = (b: typeof quant.buckets_top[number], tone: "top" | "bottom") => {
    const drift = driftLabel(b.sl_drift);
    const borderCls = tone === "top" ? "border-success/15" : "border-destructive/15";
    return (
      <div key={`${tone}-${b.label}`} className={`flex items-start gap-3 pb-3 border-b ${borderCls} last:border-0 last:pb-0`}>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{b.label}</div>
          <div className="text-xs text-muted-foreground mt-0.5 tabular-nums">
            {b.n} trades · {formatNum(b.win_rate_pct, 0)}% WR · MFE p75 {b.mfe_p75_r != null ? `${formatNum(b.mfe_p75_r, 2)}R` : "—"} · MAE p75 {b.mae_p75_r != null ? `${formatNum(b.mae_p75_r, 2)}R` : "—"}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {b.most_common_tp_hit && <>Most-hit TP: <span className="font-mono">{b.most_common_tp_hit}</span> · </>}
            {b.tp1_star && <>TP1★ {formatNum(b.tp1_star.r, 2)}R · {formatNum(b.tp1_star.hit_rate_pct, 0)}% hit · </>}
            {b.suggested_risk_pct != null && (
              <>
                Suggested risk {formatNum(b.suggested_risk_pct, 2)}%
                {b.suggested_risk_pct_propfirm_cap != null && b.suggested_risk_pct_propfirm_cap < b.suggested_risk_pct && (
                  <> (capped {formatNum(b.suggested_risk_pct_propfirm_cap, 2)}% by prop firm)</>
                )}
                {b.sl_unit && b.sl_unit !== 'R' && b.sl_unit !== '%' && <> · SL in {b.sl_unit}</>}
              </>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {(tone === "top" ? b.top_trade_ids : b.bottom_trade_ids).slice(0, 6).map(id => <CitedTradeChip key={id} tradeId={id} />)}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge
            variant="outline"
            className={tone === "top" ? "border-success/40 text-success bg-background/50" : "border-destructive/40 text-destructive bg-background/50"}
          >
            {b.expected_r >= 0 ? "+" : ""}{formatNum(b.expected_r, 2)}R/trade
          </Badge>
          {drift && <Badge variant="outline" className={`text-[10px] ${drift.cls}`}>{drift.text}</Badge>}
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{b.confidence}</span>
        </div>
      </div>
    );
  };

  return (
    <section className="space-y-4">
      {lowCoverage && (
        <Alert>
          <AlertCircle className="w-4 h-4" />
          <AlertDescription className="text-xs">
            Quant coverage is partial — SL logged on {formatNum((cov.sl / Math.max(1, cov.total)) * 100, 0)}% of trades,
            MAE on {formatNum((cov.mae / Math.max(1, cov.total)) * 100, 0)}%, MFE on {formatNum((cov.mfe / Math.max(1, cov.total)) * 100, 0)}%.
            Numbers below reflect only trades with the required fields.
          </AlertDescription>
        </Alert>
      )}

      {quant.advice && quant.advice.length > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Calculator className="w-4 h-4 text-primary" /> Quant findings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {quant.advice.map((a, i) => (
              <div key={i} className="border-b border-primary/15 last:border-0 pb-3 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-mono text-muted-foreground">{a.bucket_label} · {a.parameter}</div>
                    <div className="text-sm mt-1 leading-snug">{a.finding}</div>
                    <div className="text-xs text-muted-foreground mt-1 tabular-nums">
                      <span className="line-through">{a.current_value}</span>
                      {" → "}
                      <span className="text-foreground font-medium">{a.suggested_value}</span>
                    </div>
                    {a.cited_trade_ids?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {a.cited_trade_ids.slice(0, 6).map(id => <CitedTradeChip key={id} tradeId={id} />)}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge variant="outline" className="border-success/40 text-success bg-background/50">
                      +{formatNum(a.expected_uplift_r, 2)}R
                    </Badge>
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{a.confidence}</span>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {quant.buckets_top?.length > 0 && (
        <Card className="border-success/30 bg-success/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Trophy className="w-4 h-4 text-success" /> Top buckets (expected R × volume)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {quant.buckets_top.map(b => renderBucketRow(b, "top"))}
          </CardContent>
        </Card>
      )}

      {quant.buckets_bottom?.length > 0 && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Skull className="w-4 h-4 text-destructive" /> Bottom buckets
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {quant.buckets_bottom.map(b => renderBucketRow(b, "bottom"))}
          </CardContent>
        </Card>
      )}

      {beats.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FlaskConical className="w-4 h-4" /> Strategy replay — presets that beat your current execution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              {beats.map(r => (
                <div key={r.preset_id} className="flex items-center justify-between gap-3 border-b border-border/50 pb-2 last:border-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{r.label}</div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      n={r.n_eligible} · WR {formatNum(r.win_rate, 0)}% · expectancy {formatNum(r.expectancy_r, 2)}R
                      {r.mean_reached_r != null && <> · reached {formatNum(r.mean_reached_r, 2)}R</>}
                    </div>
                  </div>
                  <Badge variant="outline" className="border-success/40 text-success bg-background/50 shrink-0 tabular-nums">
                    +{formatNum(r.delta_vs_current, 2)}R/trade
                  </Badge>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[10px] text-muted-foreground">
              Hybrid replay — eligibility ≥ {quant.min_eligible_sample}. Trail estimates assume captured fraction of MFE.
            </p>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
