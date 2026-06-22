// ============================================================================
// Risk Optimization Lab — bootstrap-MC comparison of fixed risk levels
// (1.0%, 1.25%, 1.5%, 2.0%) against the user's actual R sample and the
// active prop-firm rules. Surfaces the trade-off between pass probability
// and risk-of-ruin so a recommended risk % can be picked confidently.
// ============================================================================

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Trophy, Info } from "lucide-react";
import type { Trade } from "@/types/trading";
import {
  runMonteCarlo,
  extractRSample,
  type MCParams,
} from "@/lib/propFirmMonteCarlo";

interface Props {
  trades: Trade[];
  balance: number;
  /** Active prop-firm rules (already converted to $). */
  dailyLossDollars: number | null;
  maxDrawdownDollars: number | null;
  /** Profit target as % of balance, e.g. 0.08 for 8%. */
  targetPct?: number;
}

const RISK_TIERS = [1.0, 1.25, 1.5, 2.0];

export function RiskOptimizationLab({
  trades, balance, dailyLossDollars, maxDrawdownDollars, targetPct: targetPctProp,
}: Props) {
  const [targetPct, setTargetPct] = useState<number>(targetPctProp ?? 8);
  const [tradesPerDay, setTradesPerDay] = useState<number>(2);
  const [maxDays, setMaxDays] = useState<number>(30);

  const rSample = useMemo(() => extractRSample(trades), [trades]);
  const dailyLossPct = balance > 0 && dailyLossDollars != null ? dailyLossDollars / balance : null;
  const maxLossPct = balance > 0 && maxDrawdownDollars != null ? maxDrawdownDollars / balance : null;

  const results = useMemo(() => {
    if (rSample.length < 10 || balance <= 0) return [];
    return RISK_TIERS.map((pct) => {
      const params: MCParams = {
        rSample,
        riskPerTradeFrac: pct / 100,
        numAccounts: 1,
        accountSize: balance,
        dailyLossPct,
        maxLossPct,
        targetPct: targetPct / 100,
        tradesPerDay,
        maxDays,
        rotationModel: "one_only",
        paths: 2000,
        seed: 42, // deterministic across re-renders
      };
      return { pct, result: runMonteCarlo(params) };
    });
  }, [rSample, balance, dailyLossPct, maxLossPct, targetPct, tradesPerDay, maxDays]);

  if (rSample.length < 10) {
    return (
      <Card className="p-6 text-sm text-muted-foreground text-center">
        Need ≥10 closed trades with <code className="text-xs">r_multiple_actual</code> filled in
        to bootstrap the simulator. Currently have {rSample.length}.
      </Card>
    );
  }

  if (balance <= 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground text-center">
        Set a simulator balance to run the risk-optimization grid.
      </Card>
    );
  }

  // Recommended row = highest pass_prob × (1 − risk_of_ruin).
  const scored = results.map((r) => ({
    ...r,
    score: r.result.passProb * (1 - r.result.riskOfRuin),
  }));
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a), scored[0]);

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-primary" />
            <h3 className="font-semibold">Risk Optimization Lab</h3>
            <Badge variant="outline" className="text-xs">N {rSample.length}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Bootstrap-MC over your actual R sample. 2000 paths per risk tier.
            "Recommended" maximises pass_prob × (1 − risk_of_ruin).
          </p>
        </div>
        <div className="flex items-end gap-4 flex-wrap">
          <div className="flex flex-col gap-1 min-w-[140px]">
            <Label htmlFor="ropt-target" className="text-xs">Target % <span className="font-mono-numbers font-semibold">{targetPct.toFixed(1)}%</span></Label>
            <Slider id="ropt-target" min={3} max={15} step={0.5} value={[targetPct]} onValueChange={(v) => setTargetPct(v[0])} className="w-32" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ropt-tpd" className="text-xs">Trades/day</Label>
            <Input id="ropt-tpd" type="number" min={1} max={20} value={tradesPerDay} onChange={(e) => setTradesPerDay(Math.max(1, Number(e.target.value) || 1))} className="w-20 h-8" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ropt-days" className="text-xs">Max days</Label>
            <Input id="ropt-days" type="number" min={5} max={120} value={maxDays} onChange={(e) => setMaxDays(Math.max(5, Number(e.target.value) || 30))} className="w-20 h-8" />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border/60">
              <th className="text-left py-2 pr-2">Risk %</th>
              <th className="text-right py-2 px-2">Expected return</th>
              <th className="text-right py-2 px-2">Pass prob</th>
              <th className="text-right py-2 px-2">Avg days to pass</th>
              <th className="text-right py-2 px-2">Risk of ruin</th>
              <th className="text-right py-2 px-2">Avg drawdown</th>
              <th className="text-left py-2 pl-2"></th>
            </tr>
          </thead>
          <tbody>
            {scored.map((row) => {
              const isBest = row.pct === best.pct;
              const r = row.result;
              return (
                <tr key={row.pct} className={`border-b border-border/30 ${isBest ? "bg-primary/5" : ""}`}>
                  <td className="py-2 pr-2 font-medium">
                    <span className={isBest ? "text-primary" : ""}>{row.pct.toFixed(2)}%</span>
                  </td>
                  <td className="py-2 px-2 text-right font-mono-numbers">
                    {r.expectedReturnPct >= 0 ? "+" : ""}{r.expectedReturnPct.toFixed(1)}%
                  </td>
                  <td className="py-2 px-2 text-right font-mono-numbers">{(r.passProb * 100).toFixed(0)}%</td>
                  <td className="py-2 px-2 text-right font-mono-numbers">
                    {r.avgDaysToPass != null ? r.avgDaysToPass.toFixed(1) : "—"}
                  </td>
                  <td className="py-2 px-2 text-right font-mono-numbers text-destructive">
                    {(r.riskOfRuin * 100).toFixed(0)}%
                  </td>
                  <td className="py-2 px-2 text-right font-mono-numbers text-muted-foreground">
                    {r.avgDrawdownPct.toFixed(1)}%
                  </td>
                  <td className="py-2 pl-2">
                    {isBest && (
                      <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-xs">
                        Recommended
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
          Each path samples R-multiples with replacement from your closed-trade history.
          Daily-loss / max-loss caps come from the active prop-firm profile when set.
          Same seed every render for a stable comparison.
        </span>
      </p>
    </Card>
  );
}
