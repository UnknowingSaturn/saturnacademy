import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { Target, Shield, Percent, TrendingUp, AlertTriangle, Info } from "lucide-react";
import type { BucketReport } from "@/lib/pairLabMath";

interface Props {
  bucket: BucketReport;
  baseline: BucketReport;
  propFirmMode?: boolean;
}

function StatLine({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="text-right">
        <div className="text-sm font-mono-numbers font-semibold">{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}

const fmt = (v: number | null | undefined, digits = 2, suffix = "") =>
  v == null || !Number.isFinite(v) ? "—" : v.toFixed(digits) + suffix;

const fmtR = (v: number | null | undefined) =>
  v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(2) + "R";

const fmtPct = (v: number | null | undefined, digits = 0) =>
  v == null ? "—" : (v * 100).toFixed(digits) + "%";

export function RecommendationCard({ bucket, baseline, propFirmMode }: Props) {
  const b = bucket;
  const lowSample = b.confidence === "low";
  const pfRisk = b.recommendation.suggestedRiskPctPropFirm;
  const kellyRisk = b.recommendation.suggestedRiskPct;
  const effectiveRisk = propFirmMode && pfRisk != null
    ? (kellyRisk != null ? Math.min(kellyRisk, pfRisk) : pfRisk)
    : kellyRisk;
  const binding = b.recommendation.bindingConstraint;
  const tp1 = b.recommendation.tp1Star;
  const kellyCi = b.recommendation.suggestedRiskPctCi;

  const driftBadge =
    b.slDrift === "too_wide" ? (
      <Badge variant="outline" className="text-loss border-loss/40 bg-loss/10">Stops set too wide</Badge>
    ) : b.slDrift === "too_tight" ? (
      <Badge variant="outline" className="text-amber-500 border-amber-500/40 bg-amber-500/10">Stops set too tight</Badge>
    ) : b.slDrift === "aligned" ? (
      <Badge variant="outline" className="text-profit border-profit/40 bg-profit/10">SL aligned with ideal</Badge>
    ) : null;

  const edge = b.recommendation.edgeVsBaseline;

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Recommendation</div>
          <div className="text-xl font-semibold mt-0.5">{b.key.symbol} · {b.key.session}</div>
          <div className="text-xs text-muted-foreground mt-1">
            Based on {b.n} closed trades · confidence: <span className="font-medium">{b.confidence}</span>
          </div>
        </div>
        {driftBadge}
      </div>

      {lowSample && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
          <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          <div className="text-amber-200">
            Sample size is below 15 trades. Treat the recommendation as directional only —
            distributions are shown, but suggested risk sizing is hidden until more data accumulates.
          </div>
        </div>
      )}

      {/* Recommendations grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Shield className="w-3.5 h-3.5" /> Suggested SL</div>
          <div className="text-2xl font-mono-numbers font-semibold">
            {b.recommendation.suggestedSlPips != null ? `${b.recommendation.suggestedSlPips.toFixed(0)} pips` : "—"}
          </div>
          <div className="text-[10px] text-muted-foreground">
            max(p75 MAE × 1.15, median ideal SL)
          </div>
        </div>

        <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Target className="w-3.5 h-3.5" /> TP ladder</div>
          <div className="text-2xl font-mono-numbers font-semibold">
            {b.recommendation.tpLadderR.length > 0
              ? b.recommendation.tpLadderR.map((r) => `${r}R`).join(" · ")
              : "—"}
            {tp1 && (
              <span className="ml-2 text-[10px] uppercase tracking-wider text-primary align-middle">
                win-max {tp1.r}R · {(tp1.hitRate * 100).toFixed(0)}%
              </span>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Percent className="w-3.5 h-3.5" /> Suggested risk</div>
          <div className={cn(
            "text-2xl font-mono-numbers font-semibold",
            effectiveRisk == null && "text-muted-foreground",
          )}>
            {effectiveRisk != null ? `${effectiveRisk.toFixed(2)}%` : "—"}
          </div>
          {kellyCi && (
            <div className="text-[10px] text-muted-foreground font-mono-numbers">
              95% CI {kellyCi[0].toFixed(2)} – {kellyCi[1].toFixed(2)}%
            </div>
          )}
          <div className="text-[10px] text-muted-foreground">
            {b.recommendation.riskBelowFloor
              ? "Raw ¼-Kelly below 0.25 % — edge too thin to size confidently"
              : propFirmMode && binding === "prop_firm_dd"
                ? `Capped by prop-firm DD budget (worst streak ${b.worstLosingStreak || "≤3"})`
                : propFirmMode && binding === "hard_cap"
                  ? "Capped by account hard-cap"
                  : "Quarter-Kelly · floor 0.25 %, ceiling 1.5 %"}
          </div>
        </div>
      </div>

      {/* PF/payoff/sharpe-like chips */}
      <div className="flex flex-wrap gap-2 text-xs">
        {b.profitFactor != null && (
          <Badge variant="outline" className="font-mono-numbers">
            PF {b.profitFactor.toFixed(2)}
          </Badge>
        )}
        {b.payoffRatio != null && (
          <Badge variant="outline" className="font-mono-numbers">
            Payoff {b.payoffRatio.toFixed(2)} ×
          </Badge>
        )}
        {b.winRateCi && (
          <Badge variant="outline" className="font-mono-numbers">
            Win {fmtPct(b.winRate, 1)} [{(b.winRateCi[0] * 100).toFixed(0)}–{(b.winRateCi[1] * 100).toFixed(0)}%]
          </Badge>
        )}
      </div>

      <Separator />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" /> Excursion (per trade)
          </div>
          <StatLine label="MFE median" value={fmt(b.mfeP50, 2, "R")} />
          <StatLine label="MFE p75" value={fmt(b.mfeP75, 2, "R")} />
          <StatLine label="MAE median" value={fmt(b.maeP50, 2, "R")} sub="R-multiple of original SL" />
          <StatLine label="MAE p75" value={fmt(b.maeP75, 2, "R")} />
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5" /> Outcomes
          </div>
          <StatLine label="Win rate" value={`${(b.winRate * 100).toFixed(1)}%`} sub={`${b.wins} W / ${b.losses} L`} />
          <StatLine
            label="Expected R"
            value={fmtR(b.expectedR)}
            sub={b.expectedRCi ? `95% CI ${fmtR(b.expectedRCi[0])} … ${fmtR(b.expectedRCi[1])}` : "CI needs N≥5"}
          />
          <StatLine
            label="SL drift"
            value={
              b.slInitialMedian != null && b.idealSlMedian != null
                ? `${b.slInitialMedian.toFixed(0)} → ${b.idealSlMedian.toFixed(0)} pips`
                : "—"
            }
            sub="planned median → ideal median"
          />
        </div>
      </div>

      {edge && baseline.n > 0 && (
        <>
          <Separator />
          <div className="text-xs">
            <span className="text-muted-foreground mr-2">Edge vs baseline (all symbols / sessions):</span>
            <span className={cn("font-mono-numbers", edge.winRateDelta >= 0 ? "text-profit" : "text-loss")}>
              {edge.winRateDelta >= 0 ? "+" : ""}{edge.winRateDelta.toFixed(1)} pp win rate
            </span>
            <span className="mx-2 text-muted-foreground">·</span>
            <span className={cn("font-mono-numbers", edge.expectedRDelta >= 0 ? "text-profit" : "text-loss")}>
              {edge.expectedRDelta >= 0 ? "+" : ""}{edge.expectedRDelta.toFixed(2)}R expected
            </span>
          </div>
        </>
      )}

      {b.slSweep && b.slSweep.length > 0 && (
        <>
          <Separator />
          <details className="group">
            <summary className="cursor-pointer text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 select-none">
              <Shield className="w-3.5 h-3.5" /> Show SL sensitivity
            </summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs font-mono-numbers">
                <thead>
                  <tr className="text-muted-foreground border-b border-border/40">
                    <th className="text-left font-normal py-1">MAE q</th>
                    <th className="text-right font-normal py-1">SL (pips)</th>
                    <th className="text-right font-normal py-1">% stopped</th>
                    <th className="text-right font-normal py-1">mean R</th>
                    <th className="text-right font-normal py-1">ΔE[R]</th>
                  </tr>
                </thead>
                <tbody>
                  {b.slSweep.map((row) => (
                    <tr key={row.q} className="border-b border-border/20 last:border-0">
                      <td className="py-1">p{(row.q * 100).toFixed(0)}</td>
                      <td className="py-1 text-right">{row.slPips.toFixed(0)}</td>
                      <td className="py-1 text-right">{(row.pctStopped * 100).toFixed(0)}%</td>
                      <td className={cn("py-1 text-right", row.meanR >= 0 ? "text-profit" : "text-loss")}>
                        {fmtR(row.meanR)}
                      </td>
                      <td className={cn("py-1 text-right", row.deltaR >= 0 ? "text-profit" : "text-loss")}>
                        {row.deltaR >= 0 ? "+" : ""}{row.deltaR.toFixed(2)}R
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5 leading-relaxed">
              Hypothetical — replays each trade as <code>−1R</code> when MAE exceeds the candidate SL,
              otherwise rescales the actual R by <code>sl_init / sl_cand</code>.
            </p>
          </details>
        </>
      )}

      <p className="text-[10px] text-muted-foreground leading-relaxed border-t pt-2">
        R metrics derive from <code>r_multiple_actual</code> on each trade — if your broker import
        populates it from gross P&amp;L, expectancy and Kelly slightly overstate net of
        commissions / swap.
      </p>

    </Card>
  );
}
