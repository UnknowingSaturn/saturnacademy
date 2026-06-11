import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, AlertTriangle, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { BucketReport } from "@/lib/pairLabMath";
import { Link } from "react-router-dom";

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
}

export function QuantNotePanel({ bucket, baseline }: QuantNotePanelProps) {
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
            tpHitDistribution: bucket.tpHitDistribution,
            mostCommonTpHit: bucket.mostCommonTpHit,
            confidence: bucket.confidence,
            expectedRCi: bucket.expectedRCi,
            suggestedSlPips: bucket.recommendation.suggestedSlPips,
            tpLadderR: bucket.recommendation.tpLadderR,
            suggestedRiskPct: bucket.recommendation.suggestedRiskPct,
            edgeVsBaseline: bucket.recommendation.edgeVsBaseline,
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

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-sm">AI quant note</h3>
          <Badge variant="outline" className="text-xs">
            {bucket.key.symbol} · {bucket.key.session}
          </Badge>
        </div>
        <Button size="sm" onClick={generate} disabled={loading || bucket.n === 0}>
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

      {bucket.n === 0 && (
        <p className="text-sm text-muted-foreground">No trades in this bucket — nothing to analyze.</p>
      )}

      {error && (
        <div className="flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle className="w-4 h-4 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !note && !error && bucket.n > 0 && (
        <p className="text-sm text-muted-foreground">
          Generate an AI note that explains what this bucket does well, what's leaking R, and the
          specific parameter changes to apply — grounded in the numbers above.
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
