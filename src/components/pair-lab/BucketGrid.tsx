import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { bhSignificant, type BucketReport } from "@/lib/pairLabMath";
import { useDistanceUnit, formatDistance, formatDistanceFromTicks, nativeUnitForSymbol } from "@/hooks/useDistanceUnit";
import {
  classifyDataTier,
  DATA_TIER_INSUFFICIENT_N,
  DATA_TIER_INSUFFICIENT_COVERAGE,
  type DataTier,
} from "../../../shared/quant/config";

function tierFor(b: BucketReport | null): DataTier | "empty" {
  if (!b || b.n === 0) return "empty";
  const coverage = b.n > 0
    ? Math.max(b.loggedMfeCount, b.loggedMaeCount) / b.n
    : 0;
  return classifyDataTier({
    n: b.n,
    pValue: b.expectancyPValue,
    ciLow: b.expectedRCi ? b.expectedRCi[0] : null,
    coverage,
  });
}


interface Props {
  symbols: string[];
  sessions: string[];
  perCell: BucketReport[];
  perRow: BucketReport[];
  selected: { symbol: string; session: string } | null;
  onSelect: (cell: { symbol: string; session: string } | null) => void;
}

function confidenceDot(level: BucketReport["confidence"]) {
  return level === "high" ? "🟢" : level === "medium" ? "🟡" : "🔴";
}

function coverageColor(logged: number, total: number) {
  if (total === 0) return "text-muted-foreground";
  const pct = logged / total;
  if (logged < 10 || pct < 0.3) return "text-destructive";
  if (pct < 0.7) return "text-amber-600 dark:text-amber-400";
  return "text-emerald-600 dark:text-emerald-400";
}

function CellInner({ b, fdr }: { b: BucketReport | null; fdr?: "sig" | "ns" | null }) {
  const { unit: distanceUnit } = useDistanceUnit();
  const tier = tierFor(b);
  if (tier === "empty") {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  if (tier === "insufficient") {
    // Distinguish the two gates so the cell doesn't lie about WHY it's red:
    //   sample   → genuinely fewer than 10 trades
    //   coverage → enough trades, but <30% have MFE/MAE logged
    const covPct = b!.n > 0
      ? Math.max(b!.loggedMfeCount, b!.loggedMaeCount) / b!.n
      : 0;
    const reason: "sample" | "coverage" =
      b!.n < DATA_TIER_INSUFFICIENT_N ? "sample" : "coverage";
    const minCovPct = Math.round(DATA_TIER_INSUFFICIENT_COVERAGE * 100);
    const hint = reason === "sample"
      ? `too few — need ≥${DATA_TIER_INSUFFICIENT_N}`
      : `low coverage — need ≥${minCovPct}% MFE/MAE`;
    const tipBody = reason === "sample"
      ? `Only ${b!.n} closed trade${b!.n === 1 ? "" : "s"} in this cell. Need at least ${DATA_TIER_INSUFFICIENT_N} to publish a recommendation.`
      : `${b!.n} closed trades, but only ${b!.loggedMfeCount} have MFE logged (${(covPct * 100).toFixed(1)}%). Log MFE/MAE on ≥${minCovPct}% of trades to unlock the recommendation.`;
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="space-y-0.5 text-left cursor-help">
              <div className="flex items-center gap-1 text-[11px]">
                <span>🔴</span>
                <span className="font-medium">N {b!.n}</span>
              </div>
              <div className="text-[10px] text-muted-foreground italic">
                {hint}
              </div>
              <div className="text-[10px] text-destructive font-mono-numbers">
                {b!.loggedMfeCount}/{b!.n} MFE · {b!.loggedMaeCount}/{b!.n} MAE
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[260px] text-xs">
            {tipBody}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  const provisional = tier === "provisional";
  const winRatePct = (b!.winRate * 100).toFixed(0);
  const hasExpR = Number.isFinite(b!.expectedR);
  const expR = hasExpR
    ? (b!.expectedR >= 0 ? "+" : "") + b!.expectedR.toFixed(2) + "R"
    : "—";
  const mfeCovColor = coverageColor(b!.loggedMfeCount, b!.n);
  const maeCovColor = coverageColor(b!.loggedMaeCount, b!.n);
  const showDrift =
    b!.drift != null && Math.abs(b!.drift) >= 15 && b!.recentWinRate != null;
  const driftPositive = (b!.drift ?? 0) > 0;
  return (
    <div className={cn("space-y-0.5 text-left", provisional && "opacity-70")}>
      <div className="flex items-center gap-1 text-[11px]">
        <span>{confidenceDot(b!.confidence)}</span>
        <span className="font-medium">N {b!.n}</span>
        <span className="text-muted-foreground">· {winRatePct}%</span>
        {showDrift && (
          <span
            className={cn(
              "text-[9px] px-1 rounded font-semibold font-mono-numbers inline-flex items-center gap-0.5",
              driftPositive
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-destructive/15 text-destructive",
            )}
            title={`Recent ${Math.min(b!.recentN, b!.events.length)}: ${(b!.recentWinRate! * 100).toFixed(0)}% · ${driftPositive ? "+" : ""}${b!.drift!.toFixed(0)}pp vs lifetime`}
          >
            {driftPositive ? "↑" : "↓"}{Math.abs(b!.drift!).toFixed(0)}pp
          </span>
        )}
        {provisional && (
          <span
            className="text-[9px] px-1 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold"
            title={`Provisional — N < 30 or CI/p-value hasn't ruled out chance. Treat as directional, not predictive.`}
          >
            prov
          </span>
        )}
        {fdr === "sig" && !provisional && (
          <span
            className="ml-auto text-[9px] px-1 rounded bg-emerald-500/15 text-emerald-500 font-semibold"
            title="FDR-significant (Benjamini–Hochberg, α=0.05) — expectancy > 0 survives multiple-testing correction across all displayed buckets."
          >
            FDR✓
          </span>
        )}
        {fdr === "ns" && !provisional && (
          <span
            className="ml-auto text-[9px] px-1 rounded bg-muted text-muted-foreground"
            title="Not significant after Benjamini–Hochberg FDR correction across all displayed buckets — guard against cherry-picking."
          >
            ns
          </span>
        )}
      </div>
      <div className={cn(
        "text-sm font-mono-numbers font-semibold",
        provisional || !hasExpR
          ? "text-muted-foreground"
          : b!.expectedR >= 0 ? "text-profit" : "text-loss",
      )}>
        {provisional ? "~" : ""}{expR}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="text-[10px] text-muted-foreground font-mono-numbers cursor-help">
            MFE {b!.mfeP75 != null ? `${b!.mfeP75.toFixed(2)}R` : "–"} · MAE {formatDistanceFromTicks(b!.key.symbol, b!.maeP75Ticks, distanceUnit)}
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs font-mono-numbers max-w-xs">
          <div className="space-y-1">
            <div>
              <span className="font-semibold">MFE</span> (n={b!.loggedMfeCount})
              {b!.loggedMfeCount > 0 ? (
                <div className="text-muted-foreground">
                  p75 {b!.mfeP75?.toFixed(2)}R · med {b!.mfeP50?.toFixed(2)}R · range {b!.mfeMin?.toFixed(2)}–{b!.mfeMax?.toFixed(2)}R
                </div>
              ) : (
                <div className="text-muted-foreground">no samples</div>
              )}
            </div>
            <div>
              <span className="font-semibold">MAE</span> (n={b!.loggedMaeCount})
              {b!.maeMinTicks != null ? (
                <div className="text-muted-foreground">
                  p75 {b!.maeP75Ticks?.toFixed(0)}t · med {b!.maeP50Ticks?.toFixed(0)}t · range {b!.maeMinTicks.toFixed(0)}–{b!.maeMaxTicks?.toFixed(0)}t
                </div>
              ) : (
                <div className="text-muted-foreground">no samples</div>
              )}
            </div>
            {(b!.loggedMfeCount < 10 || b!.loggedMaeCount < 10) && (
              <div className="text-amber-500 text-[10px] pt-1 border-t border-border/40">
                Low sample — p75 is noisy below n=10.
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
      {/* TP suggestion only shown when the bucket is validated — provisional cells suppress the arrow to avoid implying a recommendation. */}
      {!provisional && b!.n >= 10 && b!.recommendation.suggestedTpR != null && (
        <div
          className={cn(
            "text-[10px] font-mono-numbers",
            b!.recommendation.recommendationConfidence === "validated"
              ? "text-profit"
              : b!.recommendation.recommendationConfidence === "low"
                ? "text-amber-600 dark:text-amber-400"
                : "text-muted-foreground",
          )}
          title={`Suggested TP ${b!.recommendation.suggestedTpR.toFixed(2)}R · SL ${formatDistance(b!.key.symbol, b!.recommendation.suggestedSlPips, b!.slUnit ?? nativeUnitForSymbol(b!.key.symbol), distanceUnit)} · confidence ${b!.recommendation.recommendationConfidence}`}
        >
          → TP {b!.recommendation.suggestedTpR.toFixed(2)}R
        </div>
      )}
      <div
        className={cn("text-[10px] font-mono-numbers", mfeCovColor)}
        title={`${b!.loggedMfeCount} of ${b!.n} trades have an MFE value recorded. Preset simulations need ≥10 logged trades to be meaningful.`}
      >
        {b!.loggedMfeCount}/{b!.n} MFE
      </div>
      <div
        className={cn("text-[10px] font-mono-numbers", maeCovColor)}
        title={`${b!.loggedMaeCount} of ${b!.n} trades have an MAE value AND initial-SL + entry-price recorded (needed to convert ticks → R).`}
      >
        {b!.loggedMaeCount}/{b!.n} MAE
      </div>
      {/* S3.8: surface data-quality chips so users can immediately gauge how
          much of the cell's edge rests on inferred R or trades without an
          initial SL — matching QuantNotePanel's drill-down badges. */}
      <div className="flex flex-wrap gap-1 pt-0.5">
        {b!.eventsRFallbackCount > 0 && (
          <span
            className="text-[9px] px-1 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-mono-numbers"
            title={`${b!.eventsRFallbackCount} of ${b!.n} trades had no R-multiple recorded — outcome inferred as ±1 from net P&L sign. Biases expectancy toward round numbers.`}
          >
            {b!.eventsRFallbackCount}/{b!.n} R inferred
          </span>
        )}
        {b!.slMissingCount > 0 && (
          <span
            className="text-[9px] px-1 rounded bg-destructive/10 text-destructive font-mono-numbers"
            title={`${b!.slMissingCount} of ${b!.n} trades have no initial SL recorded — excluded from MAE-derived risk math (SL sweep, ideal-SL stats).`}
          >
            {b!.slMissingCount}/{b!.n} SL missing
          </span>
        )}
      </div>
    </div>
  );
}


export function BucketGrid({ symbols, sessions, perCell, perRow, selected, onSelect }: Props) {
  // Memoize lookup maps + FDR pass so we don't rebuild them on every parent
  // re-render (slider drags, sticky-header scroll, etc.). With ~30 pairs ×
  // 4 sessions the cost is small but happens often — this kept the grid
  // single-digit ms during walk-forward scrubs.
  const { cellLookup, rowLookup, fdrByKey } = useMemo(() => {
    const cellLookup = new Map<string, BucketReport>();
    perCell.forEach((c) => cellLookup.set(`${c.key.symbol}__${c.key.session}`, c));
    const rowLookup = new Map<string, BucketReport>();
    perRow.forEach((r) => rowLookup.set(r.key.symbol, r));

    // BH FDR across per-cell buckets ONLY. Row totals aggregate the same trades
    // contained in their constituent cells (non-independent tests); mixing them
    // into the BH pool inflates `m` and over-corrects, hiding real edges.
    // Finding 1 (audit): drop the `expectedR > 0` pre-filter. BH controls FDR
    // over ALL tested hypotheses. Restricting `m` to positive-E cells makes
    // the per-rank threshold `k/m × α` too permissive and over-flags cells on
    // the margin. Every cell with n ≥ 10 and a valid p-value belongs in the
    // denominator regardless of expectancy sign.
    const fdrEligible = perCell
      .map((b, idx) => ({ b, idx }))
      .filter(({ b }) => b.n >= 10 && b.expectancyPValue != null);
    const sig = bhSignificant(fdrEligible.map(({ b }) => b.expectancyPValue), 0.05);
    const fdrByKey = new Map<string, "sig" | "ns">();
    fdrEligible.forEach(({ b }, i) => {
      const k = `${b.key.symbol}__${b.key.session}`;
      fdrByKey.set(k, sig[i] ? "sig" : "ns");
    });
    return { cellLookup, rowLookup, fdrByKey };
  }, [perCell, perRow]);

  const fdrFor = (b: BucketReport | null): "sig" | "ns" | null => {
    if (!b || b.n < 10 || !(b.expectedR > 0) || b.expectancyPValue == null) return null;
    return fdrByKey.get(`${b.key.symbol}__${b.key.session}`) ?? null;
  };

  if (symbols.length === 0) {
    return (
      <Card className="p-8 text-center text-muted-foreground text-sm">
        No closed trades match the current filters.
      </Card>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
    <Card className="p-0 overflow-x-auto">
      <div className="flex items-center justify-end gap-3 px-3 py-1.5 text-[10px] text-muted-foreground border-b border-border/60 bg-muted/10">
        <span className="uppercase tracking-wider">MFE/MAE coverage</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" /> ≥70%</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" /> 30–69%</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-destructive inline-block" /> &lt;30% or &lt;10 trades</span>
      </div>
      <table className="w-full text-sm">

        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 sticky left-0 bg-muted/30 z-10">
              Pair
            </th>
            {sessions.map((s) => (
              <th key={s} className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 min-w-[120px]">
                {s}
              </th>
            ))}
            <th className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 min-w-[120px] border-l border-border">
              All sessions
            </th>
          </tr>
        </thead>
        <tbody>
          {symbols.map((symbol) => {
            const row = rowLookup.get(symbol);
            const raws = row?.rawSymbols ?? [];
            const showRaws = raws.length > 1 || (raws.length === 1 && raws[0] !== symbol);
            return (
            <tr key={symbol} className="border-b border-border/50 hover:bg-muted/10">
              <td className="px-3 py-2 font-medium sticky left-0 bg-background z-10">
                <div>{symbol}</div>
                {showRaws && (
                  <div className="text-[10px] text-muted-foreground font-mono-numbers font-normal">
                    {raws.join(" · ")}
                  </div>
                )}
              </td>
              {sessions.map((session) => {
                const b = cellLookup.get(`${symbol}__${session}`) ?? null;
                const isSelected = selected?.symbol === symbol && selected?.session === session;
                return (
                  <td key={session} className="px-1 py-1">
                    <button
                      type="button"
                      onClick={() => onSelect(isSelected ? null : { symbol, session })}
                      disabled={!b || b.n === 0}
                      aria-pressed={isSelected}
                      aria-label={
                        b && b.n > 0
                          ? `${symbol} ${session} — N=${b.n}, expR=${Number.isFinite(b.expectedR) ? (b.expectedR >= 0 ? "+" : "") + b.expectedR.toFixed(2) + "R" : "n/a"}`
                          : `${symbol} ${session} — no data`
                      }
                      className={cn(
                        "w-full text-left rounded-md px-2 py-1.5 transition-colors",
                        isSelected
                          ? "bg-primary/20 ring-1 ring-primary"
                          : b && b.n > 0
                            ? "hover:bg-muted/40"
                            : "cursor-default",
                      )}
                    >
                      <CellInner b={b} fdr={fdrFor(b)} />
                    </button>
                  </td>
                );
              })}
              <td className="px-1 py-1 border-l border-border">
                {(() => {
                  const rowB = rowLookup.get(symbol) ?? null;
                  const isSel = selected?.symbol === symbol && selected?.session === "All sessions";
                  return (
                    <button
                      type="button"
                      onClick={() => onSelect(isSel ? null : { symbol, session: "All sessions" })}
                      aria-pressed={isSel}
                      aria-label={
                        rowB && rowB.n > 0
                          ? `${symbol} All sessions — N=${rowB.n}, expR=${Number.isFinite(rowB.expectedR) ? (rowB.expectedR >= 0 ? "+" : "") + rowB.expectedR.toFixed(2) + "R" : "n/a"}`
                          : `${symbol} All sessions — no data`
                      }
                      className={cn(
                        "w-full text-left rounded-md px-2 py-1.5 transition-colors",
                        isSel
                          ? "bg-primary/20 ring-1 ring-primary"
                          : "hover:bg-muted/40",
                      )}
                    >
                      <CellInner b={rowB} fdr={fdrFor(rowB)} />
                    </button>
                  );
                })()}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
    </TooltipProvider>
  );
}
