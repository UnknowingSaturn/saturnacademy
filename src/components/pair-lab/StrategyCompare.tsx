// ============================================================================
// Strategy Compare — matched-sample (intersection) replay.
//
// Both selected strategies are scored on EXACTLY the same trades — the
// intersection of their eligibility sets. Apples-to-apples. Footnote shows
// each strategy's native eligible N for context.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, CheckCircle2, TrendingUp, TrendingDown, Info } from "lucide-react";
import { StrategyPresetPicker } from "./StrategyPresetPicker";
import { EquityCurveOverlay } from "./EquityCurveOverlay";
import {
  replayBucket,
  replayBucketMatched,
  MIN_MATCHED_SAMPLE,
  type Strategy,
  type ReplayResult,
} from "@/lib/pairLabSimulator";
import { getPreset } from "@/lib/pairLabPresets";
import type { Trade } from "@/types/trading";
import type { PairLabFieldKeys, PropFirmContext } from "@/lib/pairLabMath";

interface Props {
  trades: Trade[];
  fieldKeys: PairLabFieldKeys;
  balance: number;
  propFirm: PropFirmContext | null;
  scopeLabel: string;
}

function fmtMoney(v: number) {
  const sign = v >= 0 ? "+" : "−";
  return `${sign}$${Math.abs(v).toFixed(0)}`;
}

function VerdictBadge({ r }: { r: ReplayResult }) {
  if (r.propFirmVerdict === "n/a") return null;
  if (r.propFirmVerdict === "pass") {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
        <CheckCircle2 className="w-3 h-3 mr-1" /> Prop-firm: PASS
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1">
      <AlertTriangle className="w-3 h-3" /> {r.propFirmVerdict === "bust_daily" ? "BUST daily DD" : "BUST total DD"}
    </Badge>
  );
}

function StrategyMetrics({ r, winner, nativeN }: { r: ReplayResult; winner: boolean; nativeN: number }) {
  const ci = r.expectancyRCi;
  const halfCi = ci ? (ci[1] - ci[0]) / 2 : null;
  return (
    <div className="space-y-1.5 text-sm">
      <div className="flex items-baseline justify-between">
        <span className="text-muted-foreground">Total $</span>
        <span className={`font-mono-numbers font-semibold text-lg ${r.totalDollars >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"} ${winner ? "underline decoration-primary decoration-2 underline-offset-4" : ""}`}>
          {fmtMoney(r.totalDollars)}
        </span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-muted-foreground">Win rate</span>
        <span className="font-mono-numbers">{(r.winRate * 100).toFixed(1)}% ({r.wins}/{r.n})</span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-muted-foreground">Expectancy</span>
        <span className="font-mono-numbers">
          {r.expectancyR >= 0 ? "+" : ""}{r.expectancyR.toFixed(2)}R
          {halfCi != null && <span className="text-muted-foreground"> ±{halfCi.toFixed(2)}</span>}
        </span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-muted-foreground">Total R</span>
        <span className="font-mono-numbers">{r.totalR >= 0 ? "+" : ""}{r.totalR.toFixed(1)}R</span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-muted-foreground">Max DD</span>
        <span className="font-mono-numbers text-destructive">
          {fmtMoney(r.maxDrawdownDollars)} ({r.maxDrawdownPct.toFixed(1)}%)
        </span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-muted-foreground">Worst streak</span>
        <span className="font-mono-numbers">{r.worstLosingStreak} losses</span>
      </div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">Native eligible</span>
        <span className="font-mono-numbers text-muted-foreground">{nativeN}/{r.totalTradeCount}</span>
      </div>
      <div className="pt-2">
        <VerdictBadge r={r} />
        {r.bustNote && <p className="text-xs text-destructive mt-1">{r.bustNote}</p>}
      </div>
    </div>
  );
}

export function StrategyCompare({ trades, fieldKeys, balance, propFirm, scopeLabel }: Props) {
  const [stratA, setStratA] = useState<Strategy>(getPreset("current")!);
  const [stratB, setStratB] = useState<Strategy>(getPreset("scale-out")!);
  const [simBalance, setSimBalance] = useState<number>(balance);
  useEffect(() => { setSimBalance(balance); }, [balance]);

  // Matched-sample replay: both strategies scored on the intersection of eligible trades.
  const matched = useMemo(
    () => replayBucketMatched(trades, fieldKeys, [stratA, stratB], { balance: simBalance, propFirm }),
    [trades, fieldKeys, stratA, stratB, simBalance, propFirm],
  );
  const [resA, resB] = matched.results;

  // Native eligible counts (each preset's own eligible sample, for context).
  const nativeA = useMemo(
    () => replayBucket(trades, fieldKeys, stratA, { balance: simBalance, propFirm }).eligibleCount,
    [trades, fieldKeys, stratA, simBalance, propFirm],
  );
  const nativeB = useMemo(
    () => replayBucket(trades, fieldKeys, stratB, { balance: simBalance, propFirm }).eligibleCount,
    [trades, fieldKeys, stratB, simBalance, propFirm],
  );

  if (trades.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground text-center">
        No closed trades in scope to simulate.
      </Card>
    );
  }

  const insufficient = matched.matchedCount < MIN_MATCHED_SAMPLE;
  const matchedPct = matched.totalTradeCount > 0
    ? (matched.matchedCount / matched.totalTradeCount) * 100
    : 0;

  const winnerA = !insufficient && resA.totalDollars > resB.totalDollars;
  const verdict = (() => {
    if (insufficient) return "Not enough overlap to compare honestly.";
    const aBust = resA.propFirmVerdict === "bust_daily" || resA.propFirmVerdict === "bust_total";
    const bBust = resB.propFirmVerdict === "bust_daily" || resB.propFirmVerdict === "bust_total";
    if (aBust && !bBust) return `B wins: A busts the prop-firm, B survives.`;
    if (bBust && !aBust) return `A wins: B busts the prop-firm, A survives.`;
    const diff = resA.totalDollars - resB.totalDollars;
    const wrDiff = (resA.winRate - resB.winRate) * 100;
    const sign = diff >= 0 ? "A" : "B";
    // CI overlap check: if either CI straddles 0, call it inconclusive.
    const ciA = resA.expectancyRCi;
    const ciB = resB.expectancyRCi;
    const overlap = ciA && ciB && !(ciA[1] < ciB[0] || ciB[1] < ciA[0]);
    const overlapNote = overlap ? " CIs overlap — gap may not be statistically meaningful." : "";
    return `${sign} wins on total $ by ${fmtMoney(Math.abs(diff))}. ` +
      `Win-rate gap ${wrDiff >= 0 ? "+" : ""}${wrDiff.toFixed(0)}pp toward A.` + overlapNote;
  })();

  return (
    <TooltipProvider delayDuration={150}>
      <Card className="p-5 space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold">Strategy simulator</h3>
            <p className="text-xs text-muted-foreground">
              Matched-sample comparison in <span className="font-medium">{scopeLabel}</span>. Both
              strategies are scored on the same trades — the intersection of their eligibility sets.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="cmp-balance" className="text-xs whitespace-nowrap">Sim $</Label>
            <Input
              id="cmp-balance"
              type="number"
              value={simBalance}
              onChange={(e) => setSimBalance(Math.max(0, Number(e.target.value) || 0))}
              className="h-8 w-28 font-mono-numbers text-xs"
              min={0}
              step={1000}
            />
          </div>
        </div>

        <div className={`rounded-md border p-3 text-sm flex items-start gap-2 ${
          insufficient
            ? "border-amber-500/40 bg-amber-500/5"
            : "border-border bg-muted/20"
        }`}>
          {insufficient ? (
            <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
          ) : (
            <Info className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
          )}
          <div className="space-y-0.5 flex-1">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-medium">
                Matched sample: {matched.matchedCount}/{matched.totalTradeCount} trades
                <span className="text-muted-foreground font-normal"> ({matchedPct.toFixed(0)}%)</span>
              </span>
              <Tooltip>
                <TooltipTrigger className="text-xs text-muted-foreground underline-offset-2 hover:underline">
                  why dropped?
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-sm text-xs space-y-2">
                  <div>
                    <div className="font-medium mb-0.5">A · {stratA.label}</div>
                    {Object.entries(resA.ineligibleReasons).length === 0 ? (
                      <div className="text-muted-foreground">eligible everywhere</div>
                    ) : (
                      <ul>
                        {Object.entries(resA.ineligibleReasons).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => (
                          <li key={k} className="font-mono-numbers">· {k} ×{v}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <div className="font-medium mb-0.5">B · {stratB.label}</div>
                    {Object.entries(resB.ineligibleReasons).length === 0 ? (
                      <div className="text-muted-foreground">eligible everywhere</div>
                    ) : (
                      <ul>
                        {Object.entries(resB.ineligibleReasons).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => (
                          <li key={k} className="font-mono-numbers">· {k} ×{v}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            </div>
            {insufficient ? (
              <p className="text-xs text-muted-foreground leading-relaxed">
                Need at least {MIN_MATCHED_SAMPLE} trades eligible under BOTH strategies for an honest
                comparison. Pick presets with looser data requirements (e.g. Actual behavior, Quick-flip @1R),
                or log more MFE/MAE.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground leading-relaxed">
                Native eligible: A {nativeA}/{matched.totalTradeCount} · B {nativeB}/{matched.totalTradeCount}.
                Headline numbers below use the matched intersection only.
              </p>
            )}
          </div>
        </div>

        <div className={`grid md:grid-cols-2 gap-5 ${insufficient ? "opacity-50 pointer-events-none" : ""}`}>
          <div className="space-y-4">
            <StrategyPresetPicker value={stratA} onChange={setStratA} label="Strategy A" />
            <div className="rounded-md border border-border/60 p-3 bg-muted/20">
              <StrategyMetrics r={resA} winner={winnerA} nativeN={nativeA} />
            </div>
          </div>
          <div className="space-y-4">
            <StrategyPresetPicker value={stratB} onChange={setStratB} label="Strategy B" />
            <div className="rounded-md border border-border/60 p-3 bg-muted/20">
              <StrategyMetrics r={resB} winner={!winnerA && !insufficient} nativeN={nativeB} />
            </div>
          </div>
        </div>

        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm flex items-start gap-2">
          {winnerA ? (
            <TrendingUp className="w-4 h-4 text-primary mt-0.5" />
          ) : (
            <TrendingDown className="w-4 h-4 text-primary mt-0.5" />
          )}
          <p className="leading-relaxed">{verdict}</p>
        </div>

        {!insufficient && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs uppercase tracking-wider text-muted-foreground">Equity curves (matched sample)</h4>
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-primary inline-block" /> A
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-destructive inline-block" /> B
                </span>
              </div>
            </div>
            <EquityCurveOverlay results={[resA, resB]} />
          </div>
        )}

        <p className="text-xs text-muted-foreground border-t pt-3 leading-relaxed flex items-start gap-1.5">
          <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
          <span>
            Proof-only replay: a trade is eligible for a preset when MFE,
            {" "}<code className="text-[10px]">tp_reached</code>, or
            {" "}<code className="text-[10px]">r_actual</code> proves the rule's targets were reached
            (or the trade stopped out). MAE and Ideal-SL are logged in broker ticks and converted to R
            using each trade's initial-SL distance — trades missing
            {" "}<code className="text-[10px]">sl_initial</code> or
            {" "}<code className="text-[10px]">entry_price</code> are ineligible for MAE/ideal-SL-based presets.
            ±CI is the bootstrap 95% interval on per-trade R — when the two CIs overlap, the difference
            isn't statistically meaningful. Trail runners assume 80% MFE capture (estimate, not proof).
          </span>
        </p>
      </Card>
    </TooltipProvider>
  );
}
