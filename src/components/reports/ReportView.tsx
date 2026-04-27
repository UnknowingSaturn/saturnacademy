import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TrendingUp, TrendingDown, AlertCircle, Target, Brain, Activity, Sparkles, Trophy, Skull, RefreshCw } from "lucide-react";
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

function DeltaCell({ value, invert = false }: { value: number | undefined; invert?: boolean }) {
  if (value == null || !isFinite(value) || value === 0) return null;
  const positive = invert ? value < 0 : value > 0;
  const Icon = value > 0 ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs ${positive ? "text-success" : "text-destructive"}`}>
      <Icon className="w-3 h-3" />
      {value > 0 ? "+" : ""}{value.toFixed(2)}
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
      const [{ data: settings }, { data: customFields }] = await Promise.all([
        supabase.from("user_settings").select("live_trade_questions").eq("user_id", user!.id).maybeSingle(),
        (supabase as any).from("custom_field_definitions").select("key,label,is_active").eq("user_id", user!.id).eq("is_active", true),
      ]);
      const keys = new Set<string>(SYSTEM_FIELD_KEYS);
      const labels = new Set<string>(SYSTEM_FIELD_LABEL_TOKENS);
      for (const q of (settings?.live_trade_questions as any[]) || []) {
        if (q?.id) keys.add(String(q.id));
        if (q?.label) labels.add(normalizeLabel(q.label));
      }
      for (const f of (customFields as any[]) || []) {
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
                {[
                  { label: "Net P&L", value: `$${formatNum(m?.total_pnl, 0)}`, delta: d.total_pnl },
                  { label: "Total R", value: `${formatNum(m?.total_r, 1)}R`, delta: d.total_r },
                  { label: "Trades", value: `${m?.trade_count ?? 0}`, delta: d.trade_count },
                  { label: "Win rate", value: `${formatNum(m?.win_rate, 1)}%`, delta: d.win_rate },
                  { label: "Profit factor", value: formatNum(m?.profit_factor), delta: d.profit_factor },
                  { label: "Expectancy", value: `${formatNum(m?.expectancy_r)}R`, delta: d.expectancy_r },
                  { label: "Max DD", value: `${formatNum(m?.max_drawdown_r)}R`, delta: d.max_drawdown_r, invert: true },
                  { label: "Checklist", value: m?.checklist_compliance_pct != null ? `${formatNum(m.checklist_compliance_pct, 0)}%` : "—", delta: d.checklist_compliance_pct },
                ].map((cell) => (
                  <div key={cell.label}>
                    <div className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">{cell.label}</div>
                    <div className="text-xl font-semibold mt-1 tabular-nums">{cell.value}</div>
                    <div className="h-4 mt-0.5"><DeltaCell value={cell.delta as number | undefined} invert={cell.invert} /></div>
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
          {report.schema_suggestions && report.schema_suggestions.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" /> Make next period's report sharper
              </h2>
              {report.schema_suggestions.map((s, i) => <SchemaSuggestionCard key={i} suggestion={s} />)}
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
