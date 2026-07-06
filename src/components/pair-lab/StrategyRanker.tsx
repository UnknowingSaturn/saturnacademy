// ============================================================================
// Strategy Ranker — walk-forward, risk-adjusted preset comparison.
//
// Every preset is scored on the SAME strictly-eligible sample (closed trades
// with MFE + MAE + SL + entry). k-fold chronological walk-forward re-estimates
// bucket constants + trail capture on the training slice only, so adaptive
// presets can't cheat by fitting to trades they later score against.
//
// Sort key is a composite score:
//   score = BCa-lower-CI(expectancyR) × penalty(drawdown) × penalty(sample)
// This rewards presets whose edge is robustly positive under bootstrap AND
// wouldn't have blown a comfortable account drawdown budget, instead of the
// old raw-expectancy sort which was easy to game with a small lucky sample.
// ============================================================================

import { Fragment, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Trophy, AlertTriangle, CheckCircle2, Info, ChevronRight, ChevronDown } from "lucide-react";
import {
  rankStrategies,
  TP_SOURCE_LABELS,
  type ReplayMode,
  type ReplayResult,
  type RankerRow,
  type ExclusionBreakdown,
} from "@/lib/pairLabSimulator";
import { STRATEGY_PRESETS } from "@/lib/pairLabPresets";
import { EquityCurveOverlay } from "./EquityCurveOverlay";
import {
  useDistanceUnit,
  formatDistance,
} from "@/hooks/useDistanceUnit";

import type { Trade } from "@/types/trading";
import type { PairLabFieldKeys, PropFirmContext, TrailCaptureEstimate } from "@/lib/pairLabMath";
import { MIN_PROVEN_SAMPLE } from "../../../shared/quant/config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Props {
  trades: Trade[];
  fieldKeys: PairLabFieldKeys;
  balance: number;
  propFirm: PropFirmContext | null;
  scopeLabel: string;
  defaultRiskPct?: number;
  trailCapture?: TrailCaptureEstimate | null;
  effectiveTrailCapture?: number;
}

function fmtMoney(v: number) {
  const sign = v >= 0 ? "+" : "−";
  return `${sign}$${Math.abs(v).toFixed(0)}`;
}

function busted(r: ReplayResult) {
  return r.propFirmVerdict === "bust_daily" || r.propFirmVerdict === "bust_total";
}

/** Coverage confidence tier: how much can we trust this row's expectancy? */
type Confidence = "high" | "medium" | "low" | "none";

function confidenceFor(r: ReplayResult): Confidence {
  if (r.n === 0) return "none";
  const ci = r.expectancyRCiBCa ?? r.expectancyRCi;
  if (!ci) return "low";
  const width = ci[1] - ci[0];
  const lowerPositive = ci[0] > 0;
  if (r.n >= 30 && lowerPositive && width <= 1.0) return "high";
  if (r.n >= MIN_PROVEN_SAMPLE && (lowerPositive || width <= 1.5)) return "medium";
  return "low";
}

const CONFIDENCE_STYLES: Record<Confidence, string> = {
  high: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  medium: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  low: "bg-muted text-muted-foreground border-border",
  none: "bg-muted text-muted-foreground border-border",
};

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "—",
};

function topReasons(reasons: Record<string, number>, k = 3): Array<[string, number]> {
  return Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, k);
}

// ---------------------------------------------------------------------------
// Row detail panel
// ---------------------------------------------------------------------------

function StrategyDetailPanel({ result, riskPctOverride }: { result: ReplayResult; riskPctOverride?: number }) {
  const s = result.strategy;
  const effectiveRiskPct =
    typeof riskPctOverride === "number" && Number.isFinite(riskPctOverride)
      ? riskPctOverride
      : s.riskPct;
  const scale = result.appliedSlScaleMedian;
  const slPips = result.appliedSlPipsMedian;
  const slRange = result.appliedSlPipsRange;
  const isActual = !!s.useActualOutcome;
  const { unit: distanceUnit } = useDistanceUnit();
  const ciBCa = result.expectancyRCiBCa;
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
          <div className="text-xs font-mono-numbers text-muted-foreground space-y-0.5">
            {scale != null && (
              <div>
                Median applied:{" "}
                <span
                  className="text-foreground font-semibold"
                  title="Ratio of applied SL to each trade's original stop. 1.00R = original stop, 1.15R = 15% wider, 0.60R = 40% tighter. Cross-symbol comparable."
                >
                  {scale.toFixed(2)}R
                </span>{" "}
                <span>of original</span>
              </div>
            )}
            {slPips != null && (
              <div>
                Cross-symbol median:{" "}
                <span className="text-foreground">
                  {formatDistance(null, slPips, "pips", distanceUnit, 1)}/pts
                </span>
                {slRange && (
                  <span> · IQR {slRange[0].toFixed(1)}–{slRange[1].toFixed(1)}</span>
                )}
                <span className="text-[10px] block text-muted-foreground/70">
                  (approximate — real SL varies per symbol; use R above for a true measure)
                </span>
              </div>
            )}
            {scale == null && slPips == null && (
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
        {/* Runner + stats */}
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Runner</div>
          <div className="text-sm">
            {isActual ? (
              <span className="text-muted-foreground">N/A — replays actual outcome.</span>
            ) : (
              <span>{result.runnerLabel}</span>
            )}
          </div>
          <div className="text-xs font-mono-numbers text-muted-foreground space-y-0.5">
            <div>Risk per trade: <span className="text-foreground font-semibold">{effectiveRiskPct.toFixed(2)}%</span></div>
            {ciBCa && (
              <div>
                BCa 95% CI: <span className="text-foreground">
                  {ciBCa[0] >= 0 ? "+" : ""}{ciBCa[0].toFixed(2)}R
                  {" → "}
                  {ciBCa[1] >= 0 ? "+" : ""}{ciBCa[1].toFixed(2)}R
                </span>
              </div>
            )}
            {result.perTradeEdgeRatio != null && (
              <div>Edge (R/σ): <span className="text-foreground">{result.perTradeEdgeRatio.toFixed(2)}</span></div>
            )}
            {result.perTradeSortinoRatio != null && (
              <div>Sortino: <span className="text-foreground">{result.perTradeSortinoRatio.toFixed(2)}</span></div>
            )}
          </div>
        </div>
      </div>
      {result.ineligibleCount > 0 && (
        <div className="rounded-md border border-border/50 bg-muted/10 px-3 py-2 text-[11px] space-y-1">
          <div className="text-muted-foreground">
            <span className="font-medium text-foreground">{result.ineligibleCount}</span>{" "}
            strict-eligible trade{result.ineligibleCount === 1 ? "" : "s"} dropped by this preset:
          </div>
          <ul className="font-mono-numbers text-muted-foreground space-y-0.5">
            {topReasons(result.ineligibleReasons, 4).map(([reason, count]) => (
              <li key={reason}>· {count} × {reason}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Why excluded" panel
// ---------------------------------------------------------------------------

function ExclusionPanel({ b, open, onToggle }: { b: ExclusionBreakdown; open: boolean; onToggle: () => void }) {
  const excluded = b.total - b.eligible;
  if (excluded <= 0) return null;
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 text-xs">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 focus:outline-none focus:ring-1 focus:ring-ring rounded-md"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
        <span className="font-medium">Why {excluded} of {b.total} trades aren't in the ranker</span>
        <span className="ml-auto text-muted-foreground font-mono-numbers">{b.eligible}/{b.total} eligible</span>
      </button>
      {open && (
        <div className="px-4 pb-3 pt-1 space-y-1 font-mono-numbers text-muted-foreground">
          {b.openOrArchived > 0 && <div>· {b.openOrArchived} open or archived</div>}
          {b.noPnl > 0 && <div>· {b.noPnl} without recorded P&amp;L</div>}
          {b.missingMfe > 0 && <div>· {b.missingMfe} missing <span className="text-foreground">MFE</span> (log in Journal to include)</div>}
          {b.missingMae > 0 && <div>· {b.missingMae} missing <span className="text-foreground">MAE</span> (log in Journal to include)</div>}
          {b.missingSl > 0 && <div>· {b.missingSl} missing <span className="text-foreground">initial SL or entry price</span></div>}
          <div className="pt-1 text-[11px] leading-relaxed text-muted-foreground/80 not-italic">
            Every preset is scored on the same strict pool so rows are directly comparable. Log MFE/MAE on more trades to expand the sample.
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function StrategyRanker({
  trades, fieldKeys, balance, propFirm, scopeLabel,
  defaultRiskPct = 1, trailCapture, effectiveTrailCapture,
}: Props) {
  const [riskPct, setRiskPct] = useState<number>(defaultRiskPct);
  const [openId, setOpenId] = useState<string | null>(null);
  const [exclusionOpen, setExclusionOpen] = useState<boolean>(false);
  // PR-1 — path-ordering assumption. Default "expected" uses the Brownian-
  // bridge probability; users can flip to "pessimistic" (SL-first on ambiguous
  // trades — safety floor) or "optimistic" (TP-first, the legacy pre-fix
  // behaviour, kept for A/B comparison).
  const [replayMode, setReplayMode] = useState<ReplayMode>("expected");
  useEffect(() => { setRiskPct(defaultRiskPct); }, [defaultRiskPct]);

  // PR-2 G2 — compute all three modes in one memo so we can render the active
  // mode primarily while also showing the pessimistic ↔ optimistic range on
  // rows whose ambiguous-trade count actually matters. Three passes is cheap
  // (bootstrap dominates cost, not the replay itself) and lets us gate the
  // confidence tier by ordering sensitivity, not just sampling noise.
  const { rows, exclusion, mode, sensitivityById } = useMemo(() => {
    const presets = STRATEGY_PRESETS.map((p) => ({ ...p, riskPct }));
    const runMode = (m: ReplayMode) =>
      rankStrategies(trades, fieldKeys, presets, {
        balance,
        propFirm,
        trailCapture: effectiveTrailCapture,
        replayMode: m,
      });
    const active = runMode(replayMode);
    const pess = replayMode === "pessimistic" ? active : runMode("pessimistic");
    const opti = replayMode === "optimistic" ? active : runMode("optimistic");
    const byId = new Map<string, { pessimistic: number; optimistic: number }>();
    for (const r of active.rows) {
      const pRow = pess.rows.find((x) => x.result.strategy.id === r.result.strategy.id);
      const oRow = opti.rows.find((x) => x.result.strategy.id === r.result.strategy.id);
      if (pRow && oRow) {
        byId.set(r.result.strategy.id, {
          pessimistic: pRow.result.expectancyR,
          optimistic: oRow.result.expectancyR,
        });
      }
    }
    return { ...active, sensitivityById: byId };
  }, [trades, fieldKeys, riskPct, balance, propFirm, effectiveTrailCapture, replayMode]);

  const ranked: RankerRow[] = useMemo(() => {
    return [...rows].sort((a, b) => {
      const aBust = busted(a.result);
      const bBust = busted(b.result);
      if (aBust !== bBust) return aBust ? 1 : -1;
      const aScore = a.result.compositeScore ?? -Infinity;
      const bScore = b.result.compositeScore ?? -Infinity;
      if (bScore !== aScore) return bScore - aScore;
      const aS = a.result.perTradeSortinoRatio ?? -Infinity;
      const bS = b.result.perTradeSortinoRatio ?? -Infinity;
      if (bS !== aS) return bS - aS;
      return b.result.eligibleCount - a.result.eligibleCount;
    });
  }, [rows]);

  if (trades.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground text-center">
        No closed trades in scope to rank.
      </Card>
    );
  }

  const winnerRow = ranked[0];
  const winnerConfidence = winnerRow ? confidenceFor(winnerRow.result) : "none";
  const canCrown = winnerRow && !busted(winnerRow.result) && winnerConfidence !== "low" && winnerConfidence !== "none";

  const baselineRow = ranked.find((r) => r.result.strategy.id === "current");
  const upliftDollars =
    winnerRow && baselineRow && winnerRow.result.strategy.id !== "current"
      ? winnerRow.result.totalDollars - baselineRow.result.totalDollars
      : null;

  const modeLabel =
    mode === "kfold"
      ? `5-fold walk-forward · N=${exclusion.eligible}`
      : mode === "split"
        ? `70/30 walk-forward · N=${exclusion.eligible} (need ${25} for k-fold)`
        : `Full-sample (provisional — need 15+ eligible trades for walk-forward)`;

  const trailLabel = trailCapture
    ? `trail capture ${(trailCapture.ratio * 100).toFixed(0)}% (N=${trailCapture.n}, re-estimated per fold)`
    : `trail capture 70% (fallback — log MFE + r_actual on 10+ trades to estimate yours)`;

  return (
    <TooltipProvider delayDuration={150}>
      <Card className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <Trophy className="w-4 h-4 text-primary" />
              <h3 className="font-semibold">Auto-ranker</h3>
              <Badge variant="outline" className="text-xs">{scopeLabel}</Badge>
              <Badge variant="outline" className="text-[10px] font-mono-numbers">{modeLabel}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Every preset is scored on the <span className="font-medium text-foreground">same</span> strict sample —
              trades with logged MFE, MAE, initial SL, and entry price. Bucket constants (MAE p75, MFE percentiles,
              trail capture) are re-estimated on each fold's training slice only. Sort is by BCa lower-CI expectancy,
              penalised for drawdown and small samples.
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5 font-mono-numbers">{trailLabel}</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
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

        {/* PR-1 — replay-mode toggle. When a trade breaches both counterfactual
            TP and SL, we can't tell from MFE/MAE alone which came first. */}
        <div className="rounded-md border border-border/50 bg-muted/20 p-2.5 flex items-center gap-3 flex-wrap text-xs">
          <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Ambiguous trades</span>
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            {(["pessimistic", "expected", "optimistic"] as const).map((m) => {
              const active = replayMode === m;
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setReplayMode(m)}
                  className={
                    "px-2.5 py-1 font-medium capitalize transition-colors " +
                    (active
                      ? "bg-primary/15 text-foreground"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {m}
                </button>
              );
            })}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-muted-foreground italic cursor-help inline-flex items-center gap-1">
                <Info className="w-3 h-3" />
                what is this?
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-sm text-xs leading-relaxed">
              When a trade's MFE ≥ counterfactual TP AND its MAE ≥ counterfactual SL,
              both barriers were touched but ordering is unknown from MFE/MAE alone.{" "}
              <span className="font-medium">Expected</span> weights the two outcomes by
              the Brownian-bridge probability p = SL / (TP + SL) — the classical
              first-passage result for a symmetric random walk.{" "}
              <span className="font-medium">Pessimistic</span> assumes stop-first
              (safety floor); <span className="font-medium">Optimistic</span> assumes
              TP-first (legacy behaviour, kept for A/B). Toggle to see how sensitive
              the ranking is to the assumption — the wider the swing, the less you
              should trust the point estimate.
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Why excluded */}
        <ExclusionPanel b={exclusion} open={exclusionOpen} onToggle={() => setExclusionOpen((v) => !v)} />

        {/* Crown or provisional banner */}
        {winnerRow && canCrown && (
          <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Trophy className="w-3.5 h-3.5 text-primary" />
              <span className="font-medium">Best for this scope:</span>
              <span>{winnerRow.result.strategy.label}</span>
              <Badge className={`text-[10px] ${CONFIDENCE_STYLES[winnerConfidence]}`}>
                {CONFIDENCE_LABEL[winnerConfidence]} confidence
              </Badge>
              <Badge variant="outline" className="text-[10px] font-mono-numbers">
                N {winnerRow.result.eligibleCount}/{winnerRow.totalEligible}
              </Badge>
              {!busted(winnerRow.result) && propFirm && (
                <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-xs">
                  <CheckCircle2 className="w-3 h-3 mr-1" /> survives
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {winnerRow.result.strategy.description}{" "}
              <span className="text-foreground">
                {fmtMoney(winnerRow.result.totalDollars)} total · {(winnerRow.result.winRate * 100).toFixed(0)}% WR ·{" "}
                {winnerRow.result.expectancyR >= 0 ? "+" : ""}{winnerRow.result.expectancyR.toFixed(2)}R expectancy
                {winnerRow.result.expectancyRCiBCa && (
                  <span className="text-muted-foreground">
                    {" "}(BCa 95% {winnerRow.result.expectancyRCiBCa[0].toFixed(2)} → {winnerRow.result.expectancyRCiBCa[1].toFixed(2)}R)
                  </span>
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

        {winnerRow && !canCrown && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5" />
            <div>
              <div className="font-medium text-sm text-amber-700 dark:text-amber-400">
                Provisional ranking — no "best" yet
              </div>
              <div className="text-muted-foreground mt-1">
                {mode === "full"
                  ? `Only ${exclusion.eligible} trade${exclusion.eligible === 1 ? "" : "s"} have MFE + MAE logged — need 15+ for a walk-forward split. Numbers below are directional.`
                  : `Top preset's BCa 95% CI hasn't ruled out zero edge. Numbers below are directional, not a recommendation.`}
              </div>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border/60">
                <th className="text-left py-2 pr-2">#</th>
                <th className="text-left py-2 pr-2">Strategy</th>
                <th className="text-left py-2 px-2">N (OOS)</th>
                <th className="text-right py-2 px-2">Total $</th>
                <th className="text-right py-2 px-2">Win %</th>
                <th className="text-right py-2 px-2">Expectancy · BCa 95%</th>
                <th
                  className="text-right py-2 px-2"
                  title="Per-trade edge ratio = mean(R) / σ(R). Not annualised. Higher = more consistent edge."
                >
                  Edge (R/σ)
                </th>
                <th className="text-right py-2 px-2">Max DD</th>
                <th className="text-center py-2 px-2">Confidence</th>
                <th className="text-left py-2 pl-2">Prop-firm</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((row, i) => {
                const r = row.result;
                const conf = confidenceFor(r);
                const isWinner = i === 0 && canCrown;
                const isBust = busted(r);
                const insufficient = r.n < MIN_PROVEN_SAMPLE;
                const ci = r.expectancyRCiBCa ?? r.expectancyRCi;
                const isOpen = openId === r.strategy.id;
                const toggle = () => setOpenId(isOpen ? null : r.strategy.id);
                return (
                  <Fragment key={r.strategy.id}>
                    <tr
                      className={`border-b border-border/30 ${isWinner ? "bg-primary/5" : ""} ${isBust ? "opacity-60" : ""} ${isOpen ? "bg-muted/30" : ""}`}
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
                              {r.eligibleCount}/{row.totalEligible}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-xs text-xs">
                            {r.ineligibleCount === 0 ? (
                              <span>Every eligible trade fit this preset's rules.</span>
                            ) : (
                              <div className="space-y-1">
                                <div className="font-medium">
                                  {r.ineligibleCount} eligible trade{r.ineligibleCount === 1 ? "" : "s"} didn't fit this preset:
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
                          <span className="text-muted-foreground text-xs">need ≥{MIN_PROVEN_SAMPLE}</span>
                        ) : (
                          <span>
                            {r.expectancyR >= 0 ? "+" : ""}{r.expectancyR.toFixed(2)}R
                            {ci && (
                              <span className="text-muted-foreground text-xs">
                                {" "}({ci[0].toFixed(2)}→{ci[1].toFixed(2)})
                              </span>
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
                      <td className="py-2 px-2 text-center">
                        <Badge className={`text-[10px] ${CONFIDENCE_STYLES[conf]}`}>
                          {CONFIDENCE_LABEL[conf]}
                        </Badge>
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
                        <td colSpan={10} className="py-3 px-3">
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

        {winnerRow && baselineRow && winnerRow.result.strategy.id !== "current" && canCrown && (
          <div className="space-y-1 pt-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2">
              Equity curve — {winnerRow.result.strategy.label} vs current behavior
            </div>
            <EquityCurveOverlay results={[winnerRow.result, baselineRow.result]} />
          </div>
        )}

        <p className="text-xs text-muted-foreground border-t pt-3 leading-relaxed flex items-start gap-1.5">
          <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
          <span>
            Walk-forward: eligible trades are split chronologically; each preset's bucket constants
            (MAE p75, MFE percentiles, trail capture) are re-estimated on prior blocks only, then scored
            on the next block. Numbers above are the concatenated out-of-sample tape. BCa bootstrap
            gives the 95% CI on expectancy. Composite score = lower-CI × drawdown-penalty × sample-penalty.
          </span>
        </p>
      </Card>
    </TooltipProvider>
  );
}
