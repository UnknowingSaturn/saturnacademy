import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle, CheckCircle2, TrendingUp, TrendingDown, ShieldCheck } from "lucide-react";
import { StrategyPresetPicker } from "./StrategyPresetPicker";
import { EquityCurveOverlay } from "./EquityCurveOverlay";
import { replayBucket, MIN_HIGH_FIDELITY_SAMPLE, type Strategy, type ReplayResult } from "@/lib/pairLabSimulator";
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
  const [highFidelityOnly, setHighFidelityOnly] = useState<boolean>(true);
  useEffect(() => { setSimBalance(balance); }, [balance]);

  const resA = useMemo(
    () => replayBucket(trades, fieldKeys, stratA, { balance: simBalance, propFirm, highFidelityOnly }),
    [trades, fieldKeys, stratA, simBalance, propFirm, highFidelityOnly],
  );
  const resB = useMemo(
    () => replayBucket(trades, fieldKeys, stratB, { balance: simBalance, propFirm, highFidelityOnly }),
    [trades, fieldKeys, stratB, simBalance, propFirm, highFidelityOnly],
  );

  if (trades.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground text-center">
        No closed trades in scope to simulate.
      </Card>
    );
  }


  const loggedCount = Math.max(resA.loggedTradeCount, resB.loggedTradeCount);
  const totalCount = Math.max(resA.totalTradeCount, resB.totalTradeCount);
  const stratAneedsMfe = !stratA.useActualOutcome;
  const stratBneedsMfe = !stratB.useActualOutcome;
  const insufficient =
    highFidelityOnly && (stratAneedsMfe || stratBneedsMfe) && loggedCount < MIN_HIGH_FIDELITY_SAMPLE;

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
        <div className="flex items-center gap-3 flex-wrap">
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
          <div className="flex items-center gap-2">
            <Switch id="cmp-fidelity" checked={highFidelityOnly} onCheckedChange={setHighFidelityOnly} />
            <Label htmlFor="cmp-fidelity" className="text-xs flex items-center gap-1 cursor-pointer">
              <ShieldCheck className="w-3 h-3" /> High-fidelity only
            </Label>
          </div>
        </div>
      </div>

          <div className="flex items-center gap-2">
            <Switch id="cmp-fidelity" checked={highFidelityOnly} onCheckedChange={setHighFidelityOnly} />
            <Label htmlFor="cmp-fidelity" className="text-xs flex items-center gap-1 cursor-pointer">
              <ShieldCheck className="w-3 h-3" /> Honest mode (logged MFE only)
            </Label>
          </div>
        </div>
      </div>

      {insufficient && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
          <div className="space-y-1">
            <div className="font-medium">Preset comparison muted — not enough logged MFE.</div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              This scope has <span className="font-mono-numbers font-semibold text-foreground">{loggedCount}</span> of {totalCount} trades with MFE recorded.
              Honest mode needs ≥ {MIN_HIGH_FIDELITY_SAMPLE} before non-actual presets are trustworthy.
              {" "}
              <button
                type="button"
                onClick={() => setHighFidelityOnly(false)}
                className="underline underline-offset-2 hover:text-foreground"
              >
                Show inferred data anyway
              </button>.
            </p>
          </div>
        </div>
      )}

      <div className={`grid md:grid-cols-2 gap-5 ${insufficient ? "opacity-40 pointer-events-none" : ""}`}>

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
        Replay assumes MFE/MAE were reachable as fills (no slippage on partials). Trail-to-MFE captures 80% of MFE
        on the runner. When MFE isn't recorded, it's inferred from <code className="text-[10px]">tp_reached</code>{" "}
        first, then from <code className="text-[10px]">r-multiple</code> (winners are extended to the bucket's
        median MFE to avoid scoring partial-profit exits as BE).
        {" "}<span>
          A: <span className="text-emerald-600 dark:text-emerald-400">{resA.fidelity.full} logged</span>
          {resA.fidelity.tp_reached > 0 && <> · <span className="text-amber-600 dark:text-amber-400">{resA.fidelity.tp_reached} tp</span></>}
          {resA.fidelity.r_only > 0 && <> · <span className="text-amber-600 dark:text-amber-400">{resA.fidelity.r_only} r-only</span></>}
          {resA.fidelity.fallback > 0 && <> · <span className="text-destructive">{resA.fidelity.fallback} fallback</span></>}
          {resA.skippedLowFidelity > 0 && <> · {resA.skippedLowFidelity} skipped</>}
          {" — B: "}
          <span className="text-emerald-600 dark:text-emerald-400">{resB.fidelity.full} logged</span>
          {resB.fidelity.tp_reached > 0 && <> · <span className="text-amber-600 dark:text-amber-400">{resB.fidelity.tp_reached} tp</span></>}
          {resB.fidelity.r_only > 0 && <> · <span className="text-amber-600 dark:text-amber-400">{resB.fidelity.r_only} r-only</span></>}
          {resB.fidelity.fallback > 0 && <> · <span className="text-destructive">{resB.fidelity.fallback} fallback</span></>}
          {resB.skippedLowFidelity > 0 && <> · {resB.skippedLowFidelity} skipped</>}.
        </span>
      </p>
    </Card>
  );
}
