import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, CheckCircle2, TrendingUp, TrendingDown } from "lucide-react";
import { StrategyPresetPicker } from "./StrategyPresetPicker";
import { EquityCurveOverlay } from "./EquityCurveOverlay";
import { replayBucket, type Strategy, type ReplayResult } from "@/lib/pairLabSimulator";
import { getPreset } from "@/lib/pairLabPresets";
import type { Trade } from "@/types/trading";
import type { PairLabFieldKeys, PropFirmContext } from "@/lib/pairLabMath";

interface Props {
  trades: Trade[];
  fieldKeys: PairLabFieldKeys;
  balance: number;
  propFirm: PropFirmContext | null;
  /** Label of the current scope (e.g. "EURUSD · London"). */
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

function StrategyMetrics({ r, winner }: { r: ReplayResult; winner: boolean }) {
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
        <span className="font-mono-numbers">{r.expectancyR >= 0 ? "+" : ""}{r.expectancyR.toFixed(2)}R</span>
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

  const resA = useMemo(
    () => replayBucket(trades, fieldKeys, stratA, { balance: simBalance, propFirm }),
    [trades, fieldKeys, stratA, simBalance, propFirm],
  );
  const resB = useMemo(
    () => replayBucket(trades, fieldKeys, stratB, { balance: simBalance, propFirm }),
    [trades, fieldKeys, stratB, simBalance, propFirm],
  );

  if (trades.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground text-center">
        No closed trades in scope to simulate.
      </Card>
    );
  }

  const winnerA = resA.totalDollars > resB.totalDollars;
  const verdict = (() => {
    const aBust = resA.propFirmVerdict === "bust_daily" || resA.propFirmVerdict === "bust_total";
    const bBust = resB.propFirmVerdict === "bust_daily" || resB.propFirmVerdict === "bust_total";
    if (aBust && !bBust) return `B wins: A busts the prop-firm, B survives.`;
    if (bBust && !aBust) return `A wins: B busts the prop-firm, A survives.`;
    const diff = resA.totalDollars - resB.totalDollars;
    const wrDiff = (resA.winRate - resB.winRate) * 100;
    const sign = diff >= 0 ? "A" : "B";
    return `${sign} wins on total $ by ${fmtMoney(Math.abs(diff))}. ` +
      `Win-rate gap ${wrDiff >= 0 ? "+" : ""}${wrDiff.toFixed(0)}pp toward A.`;
  })();

  return (
    <Card className="p-5 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold">Strategy simulator</h3>
          <p className="text-xs text-muted-foreground">
            Replays {trades.length} trades in <span className="font-medium">{scopeLabel}</span> under each strategy. Deterministic — same trades, same numbers.
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

      <div className="grid md:grid-cols-2 gap-5">
        <div className="space-y-4">
          <StrategyPresetPicker value={stratA} onChange={setStratA} label="Strategy A" />
          <div className="rounded-md border border-border/60 p-3 bg-muted/20">
            <StrategyMetrics r={resA} winner={winnerA} />
          </div>
        </div>
        <div className="space-y-4">
          <StrategyPresetPicker value={stratB} onChange={setStratB} label="Strategy B" />
          <div className="rounded-md border border-border/60 p-3 bg-muted/20">
            <StrategyMetrics r={resB} winner={!winnerA} />
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

      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground">Equity curves</h4>
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

      <p className="text-xs text-muted-foreground border-t pt-3 leading-relaxed">
        <AlertTriangle className="w-3 h-3 inline mr-1" />
        Caveats: replay assumes MFE/MAE were reachable as fills (no slippage on partials).
        Trail-to-MFE captures 80% of MFE on the runner. When MFE isn't recorded, it's
        inferred from <code className="text-[10px]">tp_reached</code> and{" "}
        <code className="text-[10px]">r-multiple</code> (a +1.8R close implies MFE ≥ 1.8R, a
        marked TP2 implies MFE ≥ 2R).
        {(resA.inferredCount > 0 || resB.inferredCount > 0) && (
          <span className="text-amber-600 dark:text-amber-400">
            {" "}A: {resA.inferredCount}/{resA.n} inferred · B: {resB.inferredCount}/{resB.n} inferred.
          </span>
        )}
      </p>
    </Card>
  );
}
