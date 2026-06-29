// ============================================================================
// Strategy Ranker — proof-based replay of every preset.
//
// Each preset uses its own ELIGIBLE sample (trades whose recorded data proves
// the preset's rules would have triggered). Per-row N exposes data coverage.
// Sort by expectancy R, tiebreak by per-trade edge ratio (mean R / σ R).
// ============================================================================

import { Fragment, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Trophy, AlertTriangle, CheckCircle2, Info, ChevronRight } from "lucide-react";
import {
  replayBucket,
  walkForwardEvaluate,
  MIN_ELIGIBLE_SAMPLE,
  TP_SOURCE_LABELS,
  type ReplayResult,
} from "@/lib/pairLabSimulator";
import { STRATEGY_PRESETS } from "@/lib/pairLabPresets";
import { EquityCurveOverlay } from "./EquityCurveOverlay";
import { useDistanceUnit, formatDistance, nativeUnitForSymbol } from "@/hooks/useDistanceUnit";
import type { Trade } from "@/types/trading";
import type { PairLabFieldKeys, PropFirmContext, TrailCaptureEstimate } from "@/lib/pairLabMath";
import { classifyDataTier, DATA_TIER_VALIDATED_N } from "../../../shared/quant/config";

// A replay row is "validated" only when its eligible sample passes the central
// tier helper. Provisional rows still render numbers but lose the winner crown
// and the highlight, so the user can't mistake "best of 12 thin samples" for
// "best strategy".
function replayTier(r: ReplayResult) {
  return classifyDataTier({
    n: r.eligibleCount,
    ciLow: r.expectancyRCi ? r.expectancyRCi[0] : null,
  });
}


interface Props {
  trades: Trade[];
  fieldKeys: PairLabFieldKeys;
  balance: number;
  propFirm: PropFirmContext | null;
  scopeLabel: string;
  /** Default % risk for the slider — comes from the user's simulator profile. */
  defaultRiskPct?: number;
  /** Empirical trail capture estimate (when available). */
  trailCapture?: TrailCaptureEstimate | null;
  /** Trail capture ratio actually used by replay (estimate or default). */
  effectiveTrailCapture?: number;
}

function fmtMoney(v: number) {
  const sign = v >= 0 ? "+" : "−";
  return `${sign}$${Math.abs(v).toFixed(0)}`;
}

function busted(r: ReplayResult) {
  return r.propFirmVerdict === "bust_daily" || r.propFirmVerdict === "bust_total";
}

function coverageDotClass(eligible: number, total: number) {
  if (total === 0) return "bg-muted";
  const pct = eligible / total;
  if (eligible < MIN_ELIGIBLE_SAMPLE || pct < 0.3) return "bg-destructive";
  if (pct < 0.7) return "bg-amber-500";
  return "bg-emerald-500";
}

function topReasons(reasons: Record<string, number>, k = 3): Array<[string, number]> {
  return Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, k);
}

function StrategyDetailPanel({ result, riskPctOverride }: { result: ReplayResult; riskPctOverride?: number }) {
  const s = result.strategy;
  // S3.7: the ranked rows are built from presets with `riskPct` already
  // overridden by the slider (see `presets.map((p) => ({ ...p, riskPct }))`).
  // The replay result clones the strategy *before* override in some code
  // paths, so prefer the explicit slider value when provided.
  const effectiveRiskPct = typeof riskPctOverride === "number" && Number.isFinite(riskPctOverride)
    ? riskPctOverride
    : s.riskPct;
  const sl = result.appliedSlPipsMedian;
  const slRange = result.appliedSlPipsRange;
  const isActual = !!s.useActualOutcome;
  const { unit: distanceUnit } = useDistanceUnit();
  // S2.10: preset replay is always cross-symbol, so there's no single tick
  // size to convert against. Pass symbol=null → formatDistance falls back to
  // pure native rendering, but the label still respects whether the user has
  // toggled "ticks" mode (in which case we honour the request by appending
  // a parenthetical reminder rather than producing a nonsense ticks number).
  const ticksHint = distanceUnit === "ticks" ? " (multi-symbol; ticks vary)" : "";
  return (
    <div className="space-y-3">
      {s.description && (
        <p className="text-xs text-muted-foreground italic leading-relaxed">{s.description}</p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Stop loss */}
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Stop loss</div>
          <div className="text-sm">
            {isActual ? (
              <span className="text-muted-foreground">Uses each trade's recorded stop.</span>
            ) : (
              <span>{result.slRuleLabel}</span>
            )}
          </div>
          <div className="text-xs font-mono-numbers text-muted-foreground">
            {sl != null ? (
              <>
                Median applied:{" "}
                <span
                  className="text-foreground font-semibold"
                  title="Aggregated across every eligible symbol in this preset's sample. Displayed in the native unit (pips on FX/metals/crypto/oil, points on indices)."
                >
                  {formatDistance(null, sl, "pips", "native", 1)}/pts{ticksHint}
                </span>
                {slRange && (
                  <span> · IQR {slRange[0].toFixed(1)}–{slRange[1].toFixed(1)}</span>
                )}
              </>
            ) : (
              <span>SL distance unavailable (missing entry/SL price).</span>
            )}
          </div>
        </div>
        {/* Take profits */}
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Take profits</div>
          {isActual ? (
            <div className="text-sm text-muted-foreground">Uses each trade's recorded exits.</div>
          ) : result.appliedTpLadder.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No partials — runner handles entire position.
            </div>
          ) : (
            <ul className="space-y-1 text-sm font-mono-numbers">
              {result.appliedTpLadder.map((leg, i) => (
                <li key={i} className="flex items-baseline gap-2">
                  <span className="font-semibold text-foreground">{leg.atR.toFixed(2)}R</span>
                  <span className="text-muted-foreground">·</span>
                  <span>{Math.round(leg.fraction * 100)}%</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-[11px] text-muted-foreground">{TP_SOURCE_LABELS[leg.source]}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {/* Runner */}
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Runner</div>
          <div className="text-sm">
            {isActual ? (
              <span className="text-muted-foreground">N/A — replays actual outcome.</span>
            ) : (
              <span>{result.runnerLabel}</span>
            )}
          </div>
          <div className="text-xs font-mono-numbers text-muted-foreground">
            Risk per trade: <span className="text-foreground font-semibold">{effectiveRiskPct.toFixed(2)}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function StrategyRanker({
  trades, fieldKeys, balance, propFirm, scopeLabel,
  defaultRiskPct = 1, trailCapture, effectiveTrailCapture,
}: Props) {
  const [riskPct, setRiskPct] = useState<number>(defaultRiskPct);
  const [walkForward, setWalkForward] = useState<boolean>(false);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { setRiskPct(defaultRiskPct); }, [defaultRiskPct]);

  const replayOpts = useMemo(
    () => ({ balance, propFirm, trailCapture: effectiveTrailCapture }),
    [balance, propFirm, effectiveTrailCapture],
  );

  const ranked = useMemo(() => {
    const presets = STRATEGY_PRESETS.map((p) => ({ ...p, riskPct }));
    const results = presets.map((p) => replayBucket(trades, fieldKeys, p, replayOpts));
    return results.sort((a, b) => {
      const aBust = busted(a);
      const bBust = busted(b);
      if (aBust !== bBust) return aBust ? 1 : -1;
      const aOk = a.eligibleCount >= MIN_ELIGIBLE_SAMPLE ? 1 : 0;
      const bOk = b.eligibleCount >= MIN_ELIGIBLE_SAMPLE ? 1 : 0;
      if (aOk !== bOk) return bOk - aOk;
      if (b.expectancyR !== a.expectancyR) return b.expectancyR - a.expectancyR;
      const aS = a.perTradeEdgeRatio ?? -Infinity;
      const bS = b.perTradeEdgeRatio ?? -Infinity;
      if (bS !== aS) return bS - aS;
      return b.eligibleCount - a.eligibleCount;
    });
  }, [trades, fieldKeys, riskPct, replayOpts]);

  const walkForwardResult = useMemo(() => {
    if (!walkForward) return null;
    const presets = STRATEGY_PRESETS.map((p) => ({ ...p, riskPct }));
    return walkForwardEvaluate(trades, fieldKeys, presets, replayOpts);
  }, [walkForward, trades, fieldKeys, riskPct, replayOpts]);

  if (trades.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground text-center">
        No closed trades in scope to rank.
      </Card>
    );
  }

  const winner = ranked[0];
  const baselineCurrent = ranked.find((r) => r.strategy.id === "current");
  const upliftDollars =
    winner && baselineCurrent && winner.strategy.id !== "current"
      ? winner.totalDollars - baselineCurrent.totalDollars
      : null;

  // S3.8: scope-level data-quality chips — surface how many trades feeding
  // the ranker have inferred R-multiples or no recorded initial stop. These
  // mirror the per-bucket badges in QuantNotePanel so users notice when a
  // ranking sits on top of thin/inferred data before trusting it.
  const dataQualityCounts = useMemo(() => {
    let rFallback = 0;
    let slMissing = 0;
    let closedN = 0;
    for (const t of trades) {
      if (t.is_open || t.is_archived) continue;
      closedN += 1;
      if (t.r_multiple_actual == null || !Number.isFinite(t.r_multiple_actual)) rFallback += 1;
      if (t.sl_initial == null || t.entry_price == null) slMissing += 1;
    }
    return { rFallback, slMissing, closedN };
  }, [trades]);

  const trailLabel = trailCapture
    ? `trail capture ${(effectiveTrailCapture! * 100).toFixed(0)}% (N=${trailCapture.n})`
    : `trail capture 80% (default — log MFE + r_actual on ≥10 trades to estimate yours)`;

  return (
    <TooltipProvider delayDuration={150}>
      <Card className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4 text-primary" />
              <h3 className="font-semibold">Auto-ranker</h3>
              <Badge variant="outline" className="text-xs">{scopeLabel}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Quant mode — each preset is replayed only on trades whose recorded data proves
              the rules would have triggered. No guessing.
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              <span className="font-medium text-foreground/80">Units:</span>{" "}
              MAE & Ideal-SL in <span className="font-medium">ticks</span> (TradingView long/short tool) ·
              MFE & TP targets in <span className="font-medium">R</span> (1R = initial stop distance).
              Click a row to see its stop & TP details.
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5 font-mono-numbers">{trailLabel}</p>
            {(dataQualityCounts.rFallback > 0 || dataQualityCounts.slMissing > 0) && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {dataQualityCounts.rFallback > 0 && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-mono-numbers"
                    title={`${dataQualityCounts.rFallback} of ${dataQualityCounts.closedN} closed trades have no r_multiple_actual — outcome inferred as ±1 from net P&L sign. Biases expectancy toward round numbers.`}
                  >
                    {dataQualityCounts.rFallback}/{dataQualityCounts.closedN} R inferred
                  </span>
                )}
                {dataQualityCounts.slMissing > 0 && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-mono-numbers"
                    title={`${dataQualityCounts.slMissing} of ${dataQualityCounts.closedN} closed trades have no initial SL or entry price — excluded from MAE-derived risk math.`}
                  >
                    {dataQualityCounts.slMissing}/{dataQualityCounts.closedN} SL missing
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1">
                  <Label htmlFor="rank-wf" className="text-xs cursor-pointer">Walk-forward</Label>
                  <Switch id="rank-wf" checked={walkForward} onCheckedChange={setWalkForward} />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs text-xs">
                Split trades 70/30 by entry time, pick the winner on the first 70%, then report its expectancy on the last 30%.
                Flags overfitting when OOS expectancy collapses.
              </TooltipContent>
            </Tooltip>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Sim $</span>
              <span className="font-mono-numbers font-semibold">${balance.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-2 min-w-[220px]">
              <Label htmlFor="rank-risk" className="text-xs whitespace-nowrap">
                Risk <span className="font-mono-numbers font-semibold">{riskPct.toFixed(2)}%</span>
              </Label>
              <Slider
                id="rank-risk"
                value={[riskPct]}
                min={0.25}
                max={3}
                step={0.25}
                onValueChange={(v) => setRiskPct(v[0])}
                className="w-40"
              />
            </div>
          </div>
        </div>


        {winner && replayTier(winner) === "validated" && (
          <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Trophy className="w-3.5 h-3.5 text-primary" />
              <span className="font-medium">Best for this bucket:</span>
              <span>{winner.strategy.label}</span>
              <Badge variant="outline" className="text-[10px] font-mono-numbers">
                N {winner.eligibleCount}/{winner.totalTradeCount}
              </Badge>
              {!busted(winner) && propFirm && (
                <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-xs">
                  <CheckCircle2 className="w-3 h-3 mr-1" /> survives
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {winner.strategy.description}{" "}
              <span className="text-foreground">
                {fmtMoney(winner.totalDollars)} total · {(winner.winRate * 100).toFixed(0)}% WR ·{" "}
                {winner.expectancyR >= 0 ? "+" : ""}{winner.expectancyR.toFixed(2)}R expectancy
                {winner.expectancyRCi && (
                  <span className="text-muted-foreground">
                    {" "}(±{((winner.expectancyRCi[1] - winner.expectancyRCi[0]) / 2).toFixed(2)}R 95% CI)
                  </span>
                )}
                {winner.perTradeEdgeRatio != null && (
                  <span className="text-muted-foreground"> · Edge {winner.perTradeEdgeRatio.toFixed(2)} (R/σ)</span>
                )}
              </span>
              {upliftDollars != null && Math.abs(upliftDollars) > 1 && (
                <>
                  {" — "}
                  <span className={upliftDollars >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>
                    {upliftDollars >= 0 ? "+" : ""}{fmtMoney(upliftDollars)} vs your current behavior
                  </span>
                </>
              )}
            </p>
          </div>
        )}

        {winner && replayTier(winner) === "provisional" && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5" />
            <div>
              <div className="font-medium text-sm text-amber-700 dark:text-amber-400">
                Provisional ranking — no "best" yet
              </div>
              <div className="text-muted-foreground mt-1">
                Top preset's eligible sample (N {winner.eligibleCount}) is under{" "}
                {DATA_TIER_VALIDATED_N} trades or its 95% CI hasn't ruled out zero edge.
                Numbers below are directional, not a recommendation.
              </div>
            </div>
          </div>
        )}


        {walkForwardResult && (
          <div className={`rounded-md border p-3 text-xs ${
            walkForwardResult.overfit
              ? "border-amber-500/40 bg-amber-500/5"
              : "border-border bg-muted/20"
          }`}>
            <div className="flex items-start gap-2">
              {walkForwardResult.overfit ? (
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5" />
              ) : (
                <Info className="w-3.5 h-3.5 text-muted-foreground mt-0.5" />
              )}
              <div className="flex-1">
                <div className="font-medium text-sm">
                  Walk-forward: {walkForwardResult.winnerStrategy.label}
                </div>
                <div className="font-mono-numbers text-muted-foreground mt-1">
                  IS (N={walkForwardResult.inSampleN}): {walkForwardResult.inSample.expectancyR >= 0 ? "+" : ""}
                  {walkForwardResult.inSample.expectancyR.toFixed(2)}R
                  {" · "}
                  OOS (N={walkForwardResult.outOfSampleN}): {walkForwardResult.outOfSample.expectancyR >= 0 ? "+" : ""}
                  {walkForwardResult.outOfSample.expectancyR.toFixed(2)}R
                  {walkForwardResult.outOfSample.perTradeEdgeRatio != null && (
                    <> · OOS Edge {walkForwardResult.outOfSample.perTradeEdgeRatio.toFixed(2)} (R/σ)</>
                  )}
                </div>
                {walkForwardResult.overfit && (
                  <div className="text-amber-600 dark:text-amber-400 mt-1">
                    OOS expectancy is &lt; 50% of IS — winner likely overfits this sample.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border/60">
                <th className="text-left py-2 pr-2">#</th>
                <th className="text-left py-2 pr-2">Strategy</th>
                <th className="text-left py-2 px-2">Eligible</th>
                <th className="text-right py-2 px-2">Total $</th>
                <th className="text-right py-2 px-2">Win %</th>
                <th className="text-right py-2 px-2">Expectancy ± CI</th>
                <th className="text-right py-2 px-2" title="Per-trade edge ratio = mean(R) / σ(R). NOT annualized Sharpe — use for relative comparison only. Higher = more consistent edge per unit of R volatility.">Edge (R/σ)</th>
                <th className="text-right py-2 px-2">Max DD</th>
                <th className="text-left py-2 pl-2">Prop-firm</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r, i) => {
                const tier = replayTier(r);
                // "Winner" crown / highlight is reserved for VALIDATED rows only.
                // A provisional top row is still ranked #1 but doesn't get the
                // primary-color treatment that implies "use this".
                const isWinner = i === 0 && tier === "validated";
                const isBust = busted(r);
                const insufficient = tier === "insufficient";
                const provisional = tier === "provisional";
                const ci = r.expectancyRCi;
                const halfCi = ci ? (ci[1] - ci[0]) / 2 : null;
                const isOpen = openId === r.strategy.id;
                const toggle = () => setOpenId(isOpen ? null : r.strategy.id);
                return (
                  <Fragment key={r.strategy.id}>
                    <tr
                      className={`border-b border-border/30 ${isWinner ? "bg-primary/5" : ""} ${isBust || insufficient ? "opacity-60" : provisional ? "opacity-80" : ""} ${isOpen ? "bg-muted/30" : ""}`}
                    >

                      <td className="py-2 pr-2 font-mono-numbers text-xs text-muted-foreground">{i + 1}</td>
                      <td className="py-2 pr-2">
                        <button
                          type="button"
                          onClick={toggle}
                          aria-expanded={isOpen}
                          className={`inline-flex items-center gap-1.5 text-left font-medium hover:underline focus:outline-none focus:ring-1 focus:ring-ring rounded ${isWinner ? "text-primary" : ""}`}
                        >
                          <ChevronRight
                            className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
                          />
                          {r.strategy.label}
                        </button>
                      </td>
                      <td className="py-2 px-2">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex items-center gap-1.5 text-xs font-mono-numbers cursor-help">
                              <span className={`w-1.5 h-1.5 rounded-full ${coverageDotClass(r.eligibleCount, r.totalTradeCount)}`} />
                              {r.eligibleCount}/{r.totalTradeCount}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-xs text-xs">
                            {r.ineligibleCount === 0 ? (
                              <span>All trades have the data this preset needs.</span>
                            ) : (
                              <div className="space-y-1">
                                <div className="font-medium">
                                  {r.ineligibleCount} trades excluded — top reasons:
                                </div>
                                <ul className="space-y-0.5">
                                  {topReasons(r.ineligibleReasons).map(([reason, count]) => (
                                    <li key={reason} className="font-mono-numbers">
                                      · {reason} <span className="text-muted-foreground">×{count}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      </td>
                      <td
                        className={`py-2 px-2 text-right font-mono-numbers font-semibold ${r.totalDollars >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}
                      >
                        {insufficient ? "—" : fmtMoney(r.totalDollars)}
                      </td>
                      <td className="py-2 px-2 text-right font-mono-numbers">
                        {insufficient ? "—" : `${(r.winRate * 100).toFixed(0)}%`}
                      </td>
                      <td className="py-2 px-2 text-right font-mono-numbers">
                        {insufficient ? (
                          <span className="text-muted-foreground text-xs">need ≥{MIN_ELIGIBLE_SAMPLE}</span>
                        ) : (
                          <span className={provisional ? "text-muted-foreground" : ""}>
                            {provisional ? "~" : ""}{r.expectancyR >= 0 ? "+" : ""}{r.expectancyR.toFixed(2)}R
                            {halfCi != null && (
                              <span className="text-muted-foreground"> ±{halfCi.toFixed(2)}</span>
                            )}
                          </span>
                        )}

                      </td>
                      <td className="py-2 px-2 text-right font-mono-numbers">
                        {insufficient || r.perTradeEdgeRatio == null ? "—" : r.perTradeEdgeRatio.toFixed(2)}
                      </td>
                      <td className="py-2 px-2 text-right font-mono-numbers text-destructive">
                        {insufficient ? "—" : fmtMoney(r.maxDrawdownDollars)}
                      </td>
                      <td className="py-2 pl-2">
                        {r.propFirmVerdict === "n/a" || insufficient ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : isBust ? (
                          <Badge variant="destructive" className="text-xs">
                            {r.propFirmVerdict === "bust_daily" ? "bust daily" : "bust total"}
                          </Badge>
                        ) : (
                          <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-xs">
                            pass
                          </Badge>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-muted/20 border-b border-border/30">
                        <td colSpan={9} className="py-3 px-3">
                          <StrategyDetailPanel result={r} riskPctOverride={riskPct} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {winner && baselineCurrent && winner.strategy.id !== "current" &&
          replayTier(winner) === "validated" && (
          <div className="space-y-1 pt-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2">
              Equity curve — {winner.strategy.label} vs current behavior
            </div>
            <EquityCurveOverlay results={[winner, baselineCurrent]} />
          </div>
        )}


        <p className="text-xs text-muted-foreground border-t pt-3 leading-relaxed flex items-start gap-1.5">
          <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
          <span>
            Each preset is scored on its own eligible sample — a trade is eligible only when MFE or
            <code className="text-[10px] mx-0.5">r_actual</code> proves the rule's targets were reached
            (or the trade stopped out). MAE / Ideal-SL are stored in broker ticks and need each trade's
            initial-SL + entry price to convert into R. Presets with fewer than {MIN_ELIGIBLE_SAMPLE} eligible
            trades are demoted. ±CI is the bootstrap 95% interval on per-trade R. Tiebreaker is the per-trade edge ratio (mean R / σ R).
          </span>
        </p>
      </Card>
    </TooltipProvider>
  );
}
