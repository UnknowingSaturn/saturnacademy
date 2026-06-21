// ============================================================================
// Strategy Ranker — proof-based replay of every preset.
//
// Each preset uses its own ELIGIBLE sample (trades whose recorded data proves
// the preset's rules would have triggered). Per-row N exposes data coverage.
// Sort by expectancy R, tiebreak by Sharpe-of-R (mean / std).
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
import type { Trade } from "@/types/trading";
import type { PairLabFieldKeys, PropFirmContext, TrailCaptureEstimate } from "@/lib/pairLabMath";

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
      const aS = a.sharpeR ?? -Infinity;
      const bS = b.sharpeR ?? -Infinity;
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


        {winner && winner.eligibleCount >= MIN_ELIGIBLE_SAMPLE && (
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
                {winner.sharpeR != null && (
                  <span className="text-muted-foreground"> · Sharpe {winner.sharpeR.toFixed(2)}</span>
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
                  {walkForwardResult.outOfSample.sharpeR != null && (
                    <> · OOS Sharpe {walkForwardResult.outOfSample.sharpeR.toFixed(2)}</>
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
                <th className="text-right py-2 px-2" title="Sharpe ratio of per-trade R series — mean / stddev. Higher = more consistent.">Sharpe</th>
                <th className="text-right py-2 px-2">Max DD</th>
                <th className="text-left py-2 pl-2">Prop-firm</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r, i) => {
                const isWinner = i === 0 && r.eligibleCount >= MIN_ELIGIBLE_SAMPLE;
                const isBust = busted(r);
                const insufficient = r.eligibleCount < MIN_ELIGIBLE_SAMPLE;
                const ci = r.expectancyRCi;
                const halfCi = ci ? (ci[1] - ci[0]) / 2 : null;
                return (
                  <tr
                    key={r.strategy.id}
                    className={`border-b border-border/30 ${isWinner ? "bg-primary/5" : ""} ${isBust || insufficient ? "opacity-60" : ""}`}
                  >
                    <td className="py-2 pr-2 font-mono-numbers text-xs text-muted-foreground">{i + 1}</td>
                    <td className="py-2 pr-2">
                      <div className={`font-medium ${isWinner ? "text-primary" : ""}`}>{r.strategy.label}</div>
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
                        <>
                          {r.expectancyR >= 0 ? "+" : ""}{r.expectancyR.toFixed(2)}R
                          {halfCi != null && (
                            <span className="text-muted-foreground"> ±{halfCi.toFixed(2)}</span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="py-2 px-2 text-right font-mono-numbers">
                      {insufficient || r.sharpeR == null ? "—" : r.sharpeR.toFixed(2)}
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
                );
              })}
            </tbody>
          </table>
        </div>

        {winner && baselineCurrent && winner.strategy.id !== "current" &&
          winner.eligibleCount >= MIN_ELIGIBLE_SAMPLE && (
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
            trades are demoted. ±CI is the bootstrap 95% interval on per-trade R. Tiebreaker is Sharpe-of-R.
          </span>
        </p>
      </Card>
    </TooltipProvider>
  );
}
