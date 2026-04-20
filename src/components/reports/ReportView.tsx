import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TrendingUp, TrendingDown, AlertCircle, Target, Brain, Activity, Sparkles, Trophy, Skull } from "lucide-react";
import { format, parseISO } from "date-fns";
import { CitedTradeChip } from "./CitedTradeChip";
import { SchemaSuggestionCard } from "./SchemaSuggestionCard";
import type { Report } from "@/types/reports";

interface Props { report: Report }

function formatNum(n: number | null | undefined, digits = 2): string {
  if (n == null || !isFinite(n)) return "—";
  return n.toFixed(digits);
}

function DeltaCell({ value, invert = false }: { value: number | undefined; invert?: boolean }) {
  if (value == null || !isFinite(value) || value === 0) return <span className="text-muted-foreground text-xs">—</span>;
  const positive = invert ? value < 0 : value > 0;
  const Icon = value > 0 ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs ${positive ? "text-success" : "text-destructive"}`}>
      <Icon className="w-3 h-3" />
      {value > 0 ? "+" : ""}{value.toFixed(2)}
    </span>
  );
}

function MarkdownWithCitations({ text, citedIds }: { text: string; citedIds: string[] }) {
  return (
    <div className="prose prose-sm prose-invert max-w-none text-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      {citedIds.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1 not-prose">
          <span className="text-xs text-muted-foreground mr-1">Cited:</span>
          {citedIds.map(id => <CitedTradeChip key={id} tradeId={id} />)}
        </div>
      )}
    </div>
  );
}

export function ReportView({ report }: Props) {
  const isEmpty = report.metrics?.current == null;
  const m = report.metrics?.current;
  const d = report.metrics?.deltas || {};
  const period = `${format(parseISO(report.period_start), "MMM d")} – ${format(parseISO(report.period_end), "MMM d, yyyy")}`;
  const typeLabel = report.report_type.charAt(0).toUpperCase() + report.report_type.slice(1);

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="w-4 h-4" />
          <span>{typeLabel} Sensei Report · {period}</span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-3xl font-bold leading-tight flex-1">{report.verdict || "Report"}</h1>
          {report.grade && (
            <div className="text-center shrink-0">
              <div className="text-5xl font-bold text-primary">{report.grade}</div>
              <div className="text-xs text-muted-foreground mt-1">grade</div>
            </div>
          )}
        </div>
        {report.status === "failed" && report.error_message && (
          <Alert variant="destructive">
            <AlertCircle className="w-4 h-4" />
            <AlertDescription className="text-xs">
              Sensei narrative failed to generate: {report.error_message}. Computed metrics below are still valid.
            </AlertDescription>
          </Alert>
        )}
      </header>

      {isEmpty ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No trades in this period.</CardContent></Card>
      ) : (
        <>
          {/* §2 Numbers */}
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Activity className="w-4 h-4" /> The numbers that matter</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "Net P&L", value: formatNum(m?.total_pnl), delta: d.total_pnl },
                  { label: "Total R", value: formatNum(m?.total_r), delta: d.total_r },
                  { label: "Trades", value: m?.trade_count ?? 0, delta: d.trade_count },
                  { label: "Win rate", value: `${formatNum(m?.win_rate, 1)}%`, delta: d.win_rate },
                  { label: "Profit factor", value: formatNum(m?.profit_factor), delta: d.profit_factor },
                  { label: "Expectancy", value: `${formatNum(m?.expectancy_r)}R`, delta: d.expectancy_r },
                  { label: "Max DD", value: `${formatNum(m?.max_drawdown_r)}R`, delta: d.max_drawdown_r, invert: true },
                  { label: "Checklist", value: m?.checklist_compliance_pct != null ? `${formatNum(m.checklist_compliance_pct, 0)}%` : "—", delta: d.checklist_compliance_pct },
                ].map((cell) => (
                  <div key={cell.label}>
                    <div className="text-xs text-muted-foreground">{cell.label}</div>
                    <div className="text-xl font-semibold mt-0.5">{cell.value}</div>
                    <DeltaCell value={cell.delta as number | undefined} invert={cell.invert} />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* §3 What worked */}
          {report.edge_clusters.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Trophy className="w-4 h-4 text-success" /> What worked</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {report.edge_clusters.map((c, i) => (
                  <div key={i} className="flex items-start gap-3 pb-3 border-b border-border last:border-0 last:pb-0">
                    <div className="flex-1">
                      <div className="font-medium text-sm">{c.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {c.trades} trades · {c.wins}W / {c.trades - c.wins}L · {formatNum(c.total_r)}R · ${formatNum(c.total_pnl)}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-0.5">
                        {c.trade_ids.slice(0, 8).map(id => <CitedTradeChip key={id} tradeId={id} />)}
                      </div>
                    </div>
                    <Badge variant="outline" className="border-success/40 text-success shrink-0">+{formatNum(c.expectancy_r)}R/trade</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* §4 What bled */}
          {report.leak_clusters.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Skull className="w-4 h-4 text-destructive" /> What bled</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {report.leak_clusters.map((c, i) => (
                  <div key={i} className="flex items-start gap-3 pb-3 border-b border-border last:border-0 last:pb-0">
                    <div className="flex-1">
                      <div className="font-medium text-sm">{c.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{c.description}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {c.trades} trades · {c.wins}W / {c.trades - c.wins}L · {formatNum(c.total_r)}R · ${formatNum(c.total_pnl)}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-0.5">
                        {c.trade_ids.slice(0, 8).map(id => <CitedTradeChip key={id} tradeId={id} />)}
                      </div>
                    </div>
                    <Badge variant="outline" className="border-destructive/40 text-destructive shrink-0">{c.pattern_type}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* §5 Consistency */}
          {report.consistency && Object.keys(report.consistency).length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Consistency audit</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Pair concentration (HHI)</div>
                  <div className="mt-1">
                    {formatNum(report.consistency.pair_concentration?.hhi, 2)}
                    {report.consistency.pair_concentration?.flagged && <Badge variant="outline" className="ml-2 border-destructive/40 text-destructive text-xs">over-concentrated</Badge>}
                  </div>
                  {report.consistency.pair_concentration?.top_symbol && (
                    <div className="text-xs text-muted-foreground">{report.consistency.pair_concentration.top_symbol} = {formatNum((report.consistency.pair_concentration.top_symbol_share ?? 0) * 100, 0)}%</div>
                  )}
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Risk consistency</div>
                  <div className="mt-1">
                    σ {formatNum(report.consistency.risk_consistency?.risk_pct_stddev, 2)}%
                    {report.consistency.risk_consistency?.flagged && <Badge variant="outline" className="ml-2 border-destructive/40 text-destructive text-xs">variable</Badge>}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Frequency vs 90d baseline</div>
                  <div className="mt-1">
                    {formatNum(report.consistency.frequency_drift?.trades_per_day)}/day
                    <span className="text-muted-foreground"> (baseline {formatNum(report.consistency.frequency_drift?.baseline_trades_per_day)})</span>
                    {report.consistency.frequency_drift?.flagged && <Badge variant="outline" className="ml-2 border-destructive/40 text-destructive text-xs">drift</Badge>}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Time discipline</div>
                  <div className="mt-1">
                    {report.consistency.time_discipline?.flagged_sessions?.length
                      ? <span>Drifting in: {report.consistency.time_discipline.flagged_sessions.join(", ")}</span>
                      : <span className="text-muted-foreground">Consistent across sessions</span>}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* §6 Psychology */}
          {report.psychology && (report.psychology.top_emotions?.length || report.psychology.tilt_sequences?.length) && (
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Brain className="w-4 h-4" /> Psychology patterns</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-sm">
                {report.psychology.top_emotions?.length > 0 && (
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Emotional states by frequency</div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      {report.psychology.top_emotions.map(e => (
                        <div key={e.state} className="border border-border rounded-md p-2">
                          <div className="font-medium capitalize">{e.state}</div>
                          <div className="text-xs text-muted-foreground">{e.count} trades · avg {formatNum(e.avg_r)}R {!e.sample_size_ok && "(small n)"}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {report.psychology.common_mistake_phrases?.length > 0 && (
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Recurring mistakes</div>
                    <div className="space-y-1">
                      {report.psychology.common_mistake_phrases.map((p, i) => (
                        <div key={i} className="text-sm flex items-center justify-between">
                          <span>"{p.phrase}"</span>
                          <span className="text-xs text-muted-foreground">{p.count}× · {formatNum(p.cost_r)}R</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {report.psychology.tilt_sequences?.length > 0 && (
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Tilt sequences (3+ losses in a row)</div>
                    {report.psychology.tilt_sequences.map((t, i) => (
                      <div key={i} className="text-sm">
                        Started {format(parseISO(t.started_at), "MMM d, HH:mm")} · {t.length} trades · {formatNum(t.cumulative_r)}R
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* §7 Sensei's Notes */}
          {report.sensei_notes?.sections && report.sensei_notes.sections.length > 0 && (
            <Card className="border-primary/30">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> Sensei's notes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {report.sensei_notes.sections.map((s, i) => (
                  <div key={i}>
                    <h3 className="font-semibold text-base mb-2">{s.heading}</h3>
                    <MarkdownWithCitations text={s.body} citedIds={s.cited_trade_ids} />
                    {i < report.sensei_notes!.sections.length - 1 && <Separator className="mt-6" />}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Prior goals evaluation */}
          {report.prior_goals_evaluation?.goals && report.prior_goals_evaluation.goals.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Last period's goals</CardTitle></CardHeader>
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
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Target className="w-4 h-4" /> Goals for next period</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {report.goals.map((g, i) => (
                  <div key={g.id || i} className="flex items-start gap-2 text-sm">
                    <span className="text-muted-foreground shrink-0">{i + 1}.</span>
                    <span className="flex-1">{g.text}</span>
                    <Badge variant="outline" className="text-xs">{g.metric} {g.comparator} {g.target}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* §8 Schema suggestions */}
          {report.schema_suggestions && report.schema_suggestions.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" /> Make next month's report sharper
              </h2>
              {report.schema_suggestions.map((s, i) => <SchemaSuggestionCard key={i} suggestion={s} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
