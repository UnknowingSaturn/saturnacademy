// ============================================================================
// Rotation Simulator Lab — Monte-Carlo comparison of multi-account rotation
// models against the user's actual R sample and prop-firm rules.
//
// Answers: "Are 4×$50k accounts better than 2×$100k? Does stay-on-winner
// rotation actually outperform simultaneous trading?"
// ============================================================================

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Info, Network } from "lucide-react";
import type { Trade } from "@/types/trading";
import {
  runMonteCarlo,
  extractRSample,
  ROTATION_LABELS,
  type RotationModel,
  type MCParams,
} from "@/lib/propFirmMonteCarlo";

interface Props {
  trades: Trade[];
  /** Default per-account starting balance (from simulator profile). */
  defaultAccountSize?: number;
  /** Daily loss limit as % of starting balance (e.g. 5 = 5%). */
  defaultDailyLossPct?: number;
  /** Max loss as % of starting balance (e.g. 10 = 10%). */
  defaultMaxLossPct?: number;
}

const MODELS: RotationModel[] = ["one_only", "simultaneous", "stay_on_winner", "round_robin"];

export function RotationSimulator({
  trades,
  defaultAccountSize = 100_000,
  defaultDailyLossPct = 5,
  defaultMaxLossPct = 10,
}: Props) {
  const [numAccounts, setNumAccounts] = useState<number>(2);
  const [accountSize, setAccountSize] = useState<number>(defaultAccountSize);
  const [riskPct, setRiskPct] = useState<number>(1);
  const [dailyLossPct, setDailyLossPct] = useState<number>(defaultDailyLossPct);
  const [maxLossPct, setMaxLossPct] = useState<number>(defaultMaxLossPct);
  const [targetPct, setTargetPct] = useState<number>(8);
  const [tradesPerDay, setTradesPerDay] = useState<number>(2);
  const [maxDays, setMaxDays] = useState<number>(30);

  const rSample = useMemo(() => extractRSample(trades), [trades]);

  const results = useMemo(() => {
    if (rSample.length < 10) return [];
    return MODELS.map((model) => {
      const params: MCParams = {
        rSample,
        riskPerTradeFrac: riskPct / 100,
        numAccounts,
        accountSize,
        dailyLossPct: dailyLossPct / 100,
        maxLossPct: maxLossPct / 100,
        targetPct: targetPct / 100,
        tradesPerDay,
        maxDays,
        rotationModel: model,
        paths: 2000,
        seed: 1337,
      };
      return { model, result: runMonteCarlo(params) };
    });
  }, [rSample, numAccounts, accountSize, riskPct, dailyLossPct, maxLossPct, targetPct, tradesPerDay, maxDays]);

  if (rSample.length < 10) {
    return (
      <Card className="p-6 text-sm text-muted-foreground text-center">
        Need ≥10 closed trades with <code className="text-xs">r_multiple_actual</code> filled in
        to bootstrap the simulator. Currently have {rSample.length}.
      </Card>
    );
  }

  // Best model = highest pass probability, tiebreak on lower drawdown.
  const best = results.reduce((a, b) => {
    if (b.result.passProb !== a.result.passProb) return b.result.passProb > a.result.passProb ? b : a;
    return b.result.avgDrawdownPct < a.result.avgDrawdownPct ? b : a;
  }, results[0]);

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Network className="w-4 h-4 text-primary" />
            <h3 className="font-semibold">Rotation Simulator</h3>
            <Badge variant="outline" className="text-xs">N {rSample.length}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            2000 Monte-Carlo paths per rotation model. Each path samples your actual R history
            and applies the firm rules below.
          </p>
        </div>
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 rounded-md border border-border/60 bg-muted/10">
        <div>
          <Label className="text-xs">Accounts</Label>
          <Input type="number" min={1} max={10} value={numAccounts} onChange={(e) => setNumAccounts(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} className="h-8" />
        </div>
        <div>
          <Label className="text-xs">Account size $</Label>
          <Input type="number" min={1000} step={1000} value={accountSize} onChange={(e) => setAccountSize(Math.max(1000, Number(e.target.value) || 100000))} className="h-8" />
        </div>
        <div>
          <Label className="text-xs">Risk %<span className="font-mono-numbers ml-1 font-semibold">{riskPct.toFixed(2)}</span></Label>
          <Slider min={0.25} max={3} step={0.25} value={[riskPct]} onValueChange={(v) => setRiskPct(v[0])} className="mt-3" />
        </div>
        <div>
          <Label className="text-xs">Target %</Label>
          <Input type="number" min={1} max={30} step={0.5} value={targetPct} onChange={(e) => setTargetPct(Math.max(1, Number(e.target.value) || 8))} className="h-8" />
        </div>
        <div>
          <Label className="text-xs">Daily loss %</Label>
          <Input type="number" min={0} max={20} step={0.5} value={dailyLossPct} onChange={(e) => setDailyLossPct(Math.max(0, Number(e.target.value) || 5))} className="h-8" />
        </div>
        <div>
          <Label className="text-xs">Max loss %</Label>
          <Input type="number" min={0} max={30} step={0.5} value={maxLossPct} onChange={(e) => setMaxLossPct(Math.max(0, Number(e.target.value) || 10))} className="h-8" />
        </div>
        <div>
          <Label className="text-xs">Trades/day</Label>
          <Input type="number" min={1} max={20} value={tradesPerDay} onChange={(e) => setTradesPerDay(Math.max(1, Number(e.target.value) || 2))} className="h-8" />
        </div>
        <div>
          <Label className="text-xs">Max days</Label>
          <Input type="number" min={5} max={120} value={maxDays} onChange={(e) => setMaxDays(Math.max(5, Number(e.target.value) || 30))} className="h-8" />
        </div>
      </div>

      {/* Results */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border/60">
              <th className="text-left py-2 pr-2">Rotation model</th>
              <th className="text-right py-2 px-2">Pass prob</th>
              <th className="text-right py-2 px-2">Fail prob</th>
              <th className="text-right py-2 px-2">Avg days to pass</th>
              <th className="text-right py-2 px-2">Avg DD</th>
              <th className="text-right py-2 px-2">Survival rate</th>
              <th className="text-right py-2 px-2">Expected return</th>
              <th className="text-left py-2 pl-2"></th>
            </tr>
          </thead>
          <tbody>
            {results.map(({ model, result: r }) => {
              const isBest = model === best.model;
              return (
                <tr key={model} className={`border-b border-border/30 ${isBest ? "bg-primary/5" : ""}`}>
                  <td className="py-2 pr-2 font-medium">
                    <span className={isBest ? "text-primary" : ""}>{ROTATION_LABELS[model]}</span>
                  </td>
                  <td className="py-2 px-2 text-right font-mono-numbers font-semibold text-emerald-600 dark:text-emerald-400">
                    {(r.passProb * 100).toFixed(0)}%
                  </td>
                  <td className="py-2 px-2 text-right font-mono-numbers text-destructive">
                    {(r.failProb * 100).toFixed(0)}%
                  </td>
                  <td className="py-2 px-2 text-right font-mono-numbers">
                    {r.avgDaysToPass != null ? r.avgDaysToPass.toFixed(1) : "—"}
                  </td>
                  <td className="py-2 px-2 text-right font-mono-numbers text-muted-foreground">
                    {r.avgDrawdownPct.toFixed(1)}%
                  </td>
                  <td className="py-2 px-2 text-right font-mono-numbers">
                    {(r.accountSurvivalRate * 100).toFixed(0)}%
                  </td>
                  <td className="py-2 px-2 text-right font-mono-numbers">
                    {r.expectedReturnPct >= 0 ? "+" : ""}{r.expectedReturnPct.toFixed(1)}%
                  </td>
                  <td className="py-2 pl-2">
                    {isBest && (
                      <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-xs">
                        Best
                      </Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground border-t pt-3 leading-relaxed flex items-start gap-1.5">
        <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
        <span>
          "Simultaneous" mirrors every trade to every active account.
          "Stay-on-winner" switches accounts only after a losing trade.
          "Round-robin" cycles through accounts. "One only" trades a single account
          regardless of how many you set — useful as a baseline.
        </span>
      </p>
    </Card>
  );
}
