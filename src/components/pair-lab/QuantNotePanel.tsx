import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, AlertTriangle, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { BucketReport, PropFirmContext } from "@/lib/pairLabMath";
import { Link } from "react-router-dom";
import { CumulativeExpectancyChart } from "@/components/pair-lab/CumulativeExpectancyChart";

interface QuantNote {
  headline: string;
  whats_working: string;
  whats_leaking: string;
  parameter_changes: Array<{
    label: string;
    current: string;
    suggested: string;
    rationale: string;
  }>;
  playbook_edits: string[];
  caveats: string;
  cited_trade_ids: string[];
}

interface QuantNotePanelProps {
  bucket: BucketReport;
  baseline: BucketReport;
  propFirm?: PropFirmContext | null;
}

export function QuantNotePanel({ bucket, baseline, propFirm }: QuantNotePanelProps) {
  const [note, setNote] = useState<QuantNote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    setNote(null);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke("pair-lab-report", {
        body: {
          bucket: {
            symbol: bucket.key.symbol,
            session: bucket.key.session,
            rawSymbols: bucket.rawSymbols,
            n: bucket.n,
            wins: bucket.wins,
            losses: bucket.losses,
            winRate: bucket.winRate,
            expectedR: bucket.expectedR,
            expectedRMedian: bucket.expectedRMedian,
            mfeP50: bucket.mfeP50,
            mfeP75: bucket.mfeP75,
            maeP50: bucket.maeP50,
            maeP75: bucket.maeP75,
            idealSlMedian: bucket.idealSlMedian,
            slInitialMedian: bucket.slInitialMedian,
            slDrift: bucket.slDrift,
            confidence: bucket.confidence,
            expectedRCi: bucket.expectedRCi,
            worstLosingStreak: bucket.worstLosingStreak,
            suggestedSlPips: bucket.recommendation.suggestedSlPips,
            slSource: bucket.recommendation.slSource,
            slSourceN: bucket.recommendation.slSourceN,
            tpLadderR: bucket.recommendation.tpLadderR,
            tp1Star: bucket.recommendation.tp1Star,
            suggestedRiskPct: bucket.recommendation.suggestedRiskPct,
            suggestedRiskPctPropFirm: bucket.recommendation.suggestedRiskPctPropFirm,
            bindingConstraint: bucket.recommendation.bindingConstraint,
            edgeVsBaseline: bucket.recommendation.edgeVsBaseline,
            // Phase-4 additions — let the LLM speak to confidence + OOS.
            recommendationConfidence: bucket.recommendation.recommendationConfidence,
            suggestedTpR: bucket.recommendation.suggestedTpR,
            expectancyAtSuggested: bucket.recommendation.expectancyAtSuggested,
            expectancyAtSuggestedCi: bucket.recommendation.expectancyAtSuggestedCi,
            walkForward: bucket.recommendation.walkForward,
            topTradeIds: bucket.topTradeIds,
            bottomTradeIds: bucket.bottomTradeIds,
          },
          baseline: {
            n: baseline.n,
            winRate: baseline.winRate,
            expectedR: baseline.expectedR,
            mfeP75: baseline.mfeP75,
            maeP75: baseline.maeP75,
          },
          propFirm: propFirm
            ? {
                firmName: propFirm.firmName,
                balance: propFirm.balance,
                dailyLossDollars: propFirm.dailyLossDollars,
                maxDrawdownDollars: propFirm.maxDrawdownDollars,
                hardCapPct: propFirm.hardCapPct,
              }
            : null,
        },
      });
      if (invokeErr) throw invokeErr;
      if (data?.error) throw new Error(data.error);
      setNote(data?.note as QuantNote);
    } catch (e: any) {
      const msg = e?.message ?? "Failed to generate report";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const tooFewSamples = bucket.confidence === "low";

  const b = bucket;
  const fmtR = (v: number | null | undefined) =>
    v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(2) + "R";
  const driftBadge =
    b.slDrift === "too_wide" ? (
      <Badge variant="outline" className="text-loss border-loss/40 bg-loss/10 text-[10px]">stops too wide</Badge>
    ) : b.slDrift === "too_tight" ? (
      <Badge variant="outline" className="text-amber-500 border-amber-500/40 bg-amber-500/10 text-[10px]">stops too tight</Badge>
    ) : b.slDrift === "aligned" ? (
      <Badge variant="outline" className="text-profit border-profit/40 bg-profit/10 text-[10px]">SL aligned</Badge>
    ) : null;

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-sm">AI quant note</h3>
          <Badge variant="outline" className="text-xs">
            {b.key.symbol} · {b.key.session}
          </Badge>
          {driftBadge}
        </div>
        <Button
          size="sm"
          onClick={generate}
          disabled={loading || bucket.n === 0 || tooFewSamples}
          title={tooFewSamples ? "Need ≥15 trades for an honest LLM read — generating earlier produces narrative on noise." : undefined}
        >
          {loading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> Analyzing…
            </>
          ) : note ? (
            "Regenerate"
          ) : (
            "Generate"
          )}
        </Button>
      </div>

      {/* Bucket stats strip — replaces the removed RecommendationCard fact sheet. */}
      {b.n > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs border-y border-border/40 py-3">
          <div>
            <div className="text-muted-foreground">N</div>
            <div className="font-mono-numbers font-semibold text-sm">{b.n}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Win rate</div>
            <div className="font-mono-numbers font-semibold text-sm">
              {(b.winRate * 100).toFixed(1)}%
              <span className="text-muted-foreground font-normal text-[10px] ml-1">
                {b.wins}W/{b.losses}L
              </span>
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Expected R</div>
            <div className="font-mono-numbers font-semibold text-sm">{fmtR(b.expectedR)}</div>
            {b.expectedRCi && (
              <div className="text-[10px] text-muted-foreground font-mono-numbers">
                {fmtR(b.expectedRCi[0])} … {fmtR(b.expectedRCi[1])}
              </div>
            )}
          </div>
          <div>
            <div className="text-muted-foreground">MFE p50/p75</div>
            <div className="font-mono-numbers font-semibold text-sm">
              {b.mfeP50?.toFixed(2) ?? "—"} / {b.mfeP75?.toFixed(2) ?? "—"}R
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">MAE p50/p75</div>
            <div className="font-mono-numbers font-semibold text-sm">
              {b.maeP50Ticks != null ? b.maeP50Ticks.toFixed(0) : "—"} / {b.maeP75Ticks != null ? b.maeP75Ticks.toFixed(0) : "—"}t
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">SL drift</div>
            <div className="font-mono-numbers font-semibold text-sm">
              {b.slInitialMedian != null && b.idealSlMedian != null
                ? `${b.slInitialMedian.toFixed(0)} → ${b.idealSlMedian.toFixed(0)}`
                : "—"}
            </div>
            <div className="text-[10px] text-muted-foreground">planned → ideal (pips)</div>
          </div>
        </div>
      )}

      {/* Walk-forward causal chart — cumulative + rolling expectancy over time. */}
      {b.events && b.events.length >= 5 && (
        <div className="border border-border/40 rounded-md p-3 bg-muted/5">
          <div className="flex items-baseline justify-between mb-1.5 gap-2 flex-wrap">
            <div className="text-xs font-medium flex items-center gap-2">
              Expectancy over time
              {b.eventsRFallbackCount > 0 && (
                <Badge
                  variant="outline"
                  className="text-[9px] font-mono-numbers text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-500/5"
                  title={`${b.eventsRFallbackCount} of ${b.events.length} trades had no R-multiple recorded — their outcome was inferred as ±1 from net P&L sign. The cumulative line treats them as exact 1R/−1R, which biases towards round numbers.`}
                >
                  {b.eventsRFallbackCount}/{b.events.length} R inferred
                </Badge>
              )}
            </div>
            {b.drift != null && Math.abs(b.drift) >= 15 && (
              <div className={"text-[11px] font-mono-numbers " + ((b.drift ?? 0) > 0 ? "text-profit" : "text-loss")}>
                recent {Math.min(b.recentN, b.events.length)}: {((b.recentWinRate ?? 0) * 100).toFixed(0)}% ({(b.drift > 0 ? "+" : "") + b.drift.toFixed(0)}pp vs lifetime)
              </div>
            )}
          </div>
          <CumulativeExpectancyChart events={b.events} rollingN={b.recentN} />
        </div>
      )}


      {/* Quant-suggested parameters — surfaced from buildRecommendation, no LLM. */}
      {b.n >= 10 && (() => {
        const r = b.recommendation;
        const conf = r.recommendationConfidence;
        const confBadge =
          conf === "validated" ? (
            <Badge variant="outline" className="text-profit border-profit/40 bg-profit/10 text-[10px]">
              validated · OOS-tested
            </Badge>
          ) : conf === "low" ? (
            <Badge
              variant="outline"
              className="text-amber-500 border-amber-500/40 bg-amber-500/10 text-[10px]"
              title="MFE-grid found a TP but bootstrap CI lower bound ≤ 0 — edge not statistically separated from zero."
            >
              low-confidence
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="text-muted-foreground border-border bg-muted/30 text-[10px]"
              title="Not enough winners/MFE-logged trades for the upgraded math — using legacy heuristic."
            >
              insufficient data
            </Badge>
          );
        const wf = r.walkForward;
        const degBadge = wf
          ? wf.degradationPct > 60 ? (
              <Badge variant="outline" className="text-loss border-loss/40 bg-loss/10 text-[10px]">
                curve-fit risk
              </Badge>
            ) : wf.degradationPct < 25 ? (
              <Badge variant="outline" className="text-profit border-profit/40 bg-profit/10 text-[10px]">
                holds OOS
              </Badge>
            ) : (
              <Badge variant="outline" className="text-amber-500 border-amber-500/40 bg-amber-500/10 text-[10px]">
                some decay
              </Badge>
            )
          : null;
        return (
          <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <h4 className="text-xs uppercase tracking-wider text-muted-foreground">
                Suggested parameters
              </h4>
              {confBadge}
              {degBadge}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <div className="text-muted-foreground">SL</div>
                <div className="font-mono-numbers font-semibold text-sm">
                  {r.suggestedSlPips != null ? `${r.suggestedSlPips.toFixed(0)} pips` : "—"}
                </div>
                {r.slSource !== "legacy" && (
                  <div className="text-[10px] text-muted-foreground">
                    {r.slSource === "ideal_sl"
                      ? `Source: ideal SL median${r.slSourceN ? ` · N=${r.slSourceN}` : ""}`
                      : r.slSource === "winners_mae"
                      ? `Source: winners' MAE p90 × 1.10${r.slSourceN ? ` · N=${r.slSourceN}` : ""} (no ideal SL logged)`
                      : `Source: MAE p75 × 1.15${r.slSourceN ? ` · N=${r.slSourceN}` : ""} (fallback)`}
                  </div>
                )}
              </div>
              <div>
                <div className="text-muted-foreground">TP (best)</div>
                <div className="font-mono-numbers font-semibold text-sm">
                  {r.suggestedTpR != null ? `${r.suggestedTpR.toFixed(2)}R` : "—"}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">E[R] at TP</div>
                <div className="font-mono-numbers font-semibold text-sm">
                  {r.expectancyAtSuggested != null
                    ? (r.expectancyAtSuggested >= 0 ? "+" : "") + r.expectancyAtSuggested.toFixed(2)
                    : "—"}
                </div>
                {r.expectancyAtSuggestedCi && (
                  <div className="text-[10px] text-muted-foreground font-mono-numbers">
                    [{r.expectancyAtSuggestedCi[0].toFixed(2)} … {r.expectancyAtSuggestedCi[1].toFixed(2)}]
                  </div>
                )}
              </div>
              <div>
                <div className="text-muted-foreground">Ladder</div>
                <div className="font-mono-numbers font-semibold text-sm">
                  {r.tpLadderR.length > 0
                    ? r.tpLadderR.map((t) => `${t.toFixed(2)}R`).join(" / ")
                    : "—"}
                </div>
              </div>
            </div>
            {wf ? (
              <div className="text-[11px] text-muted-foreground font-mono-numbers border-t border-border/40 pt-2">
                Walk-forward · IS {(wf.inSampleE >= 0 ? "+" : "") + wf.inSampleE.toFixed(2)}R
                {" → "}
                OOS {(wf.outOfSampleE >= 0 ? "+" : "") + wf.outOfSampleE.toFixed(2)}R
                <span className={wf.degradationPct > 60 ? "text-loss ml-1" : "ml-1"}>
                  ({wf.degradationPct >= 0 ? "−" : "+"}{Math.abs(wf.degradationPct).toFixed(0)}% on {wf.oosN} OOS trades)
                </span>
              </div>
            ) : (
              // M2 — explain why the walk-forward / OOS panel is missing instead
              // of silently rendering nothing.
              <div className="text-[11px] text-muted-foreground border-t border-border/40 pt-2 italic">
                OOS validation pending —{" "}
                {b.n < 30
                  ? `need ${30 - b.n} more closed trades in this bucket (30 min).`
                  : (b.loggedMfeCount ?? 0) < 10
                  ? "insufficient MFE coverage in this bucket — log MFE on more closed trades to enable the 70/30 split."
                  : "fewer than 5 trades fell into the out-of-sample window."}
              </div>
            )}
            <div className="text-[10px] text-muted-foreground italic">
              SL = p90(winners' MAE) × 1.10 · TP = argmax E[R] over MFE grid · CI = 200-iter bootstrap
            </div>
          </div>
        );
      })()}

      {bucket.n === 0 && (
        <p className="text-sm text-muted-foreground">No trades in this bucket — nothing to analyze.</p>
      )}

      {tooFewSamples && bucket.n > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Bucket has {bucket.n} trades — below the 15-trade threshold. Add more closed trades before generating
          an AI note, or the model will narrate noise as signal.
        </p>
      )}

      {error && (
        <div className="flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle className="w-4 h-4 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !note && !error && bucket.n > 0 && !tooFewSamples && (
        <p className="text-xs text-muted-foreground">
          Generate an AI note grounded in this bucket's numbers.
        </p>
      )}

      {note && (
        <div className="space-y-4 text-sm">
          <p className="text-base font-medium leading-snug">{note.headline}</p>

          <div className="grid md:grid-cols-2 gap-4">
            <section>
              <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                What's working
              </h4>
              <p className="leading-relaxed">{note.whats_working}</p>
            </section>
            <section>
              <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                What's leaking
              </h4>
              <p className="leading-relaxed">{note.whats_leaking}</p>
            </section>
          </div>

          {note.parameter_changes?.length > 0 && (
            <section>
              <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Parameter changes
              </h4>
              <div className="space-y-2">
                {note.parameter_changes.map((c, i) => (
                  <div key={i} className="rounded-md border border-border/60 bg-muted/30 p-3">
                    <div className="flex items-center gap-2 text-sm font-medium mb-1">
                      <span>{c.label}</span>
                      <span className="font-mono-numbers text-xs text-muted-foreground">
                        {c.current}
                      </span>
                      <ArrowRight className="w-3 h-3 text-muted-foreground" />
                      <span className="font-mono-numbers text-xs text-foreground">{c.suggested}</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{c.rationale}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {note.playbook_edits?.length > 0 && (
            <section>
              <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Playbook edits
              </h4>
              <ul className="list-disc list-inside space-y-1 text-sm">
                {note.playbook_edits.map((e, i) => (
                  <li key={i} className="leading-relaxed">{e}</li>
                ))}
              </ul>
            </section>
          )}

          {note.cited_trade_ids?.length > 0 && (
            <section>
              <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Cited trades
              </h4>
              <div className="flex flex-wrap gap-2">
                {note.cited_trade_ids.map((id) => (
                  <Link
                    key={id}
                    to={`/journal?trade=${id}`}
                    className="text-xs px-2 py-1 rounded border border-border/60 hover:bg-muted/50 font-mono-numbers"
                  >
                    {id.slice(0, 8)}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {note.caveats && (
            <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400 border-t pt-3">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{note.caveats}</span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
