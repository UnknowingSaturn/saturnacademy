// ============================================================================
// Strategy Ranker — runs every preset over the scoped trades and ranks the
// outcomes. Auto-answers "what's the best risk/exit combo for this bucket?".
//
// Ranking rules (in order):
//   1. Strategies that BUST the prop-firm (daily or total DD) sink to the
//      bottom, regardless of $.
//   2. Within survivors, sort by total $ desc.
//   3. Tiebreak by expectancy R.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Trophy, AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";
import { replayBucket, MIN_HIGH_FIDELITY_SAMPLE, type ReplayResult } from "@/lib/pairLabSimulator";
import { STRATEGY_PRESETS } from "@/lib/pairLabPresets";
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

function busted(r: ReplayResult) {
  return r.propFirmVerdict === "bust_daily" || r.propFirmVerdict === "bust_total";
}

export function StrategyRanker({ trades, fieldKeys, balance, propFirm, scopeLabel }: Props) {
  const [riskPct, setRiskPct] = useState<number>(1);
  const [simBalance, setSimBalance] = useState<number>(balance);
  const [highFidelityOnly, setHighFidelityOnly] = useState<boolean>(true);
  useEffect(() => { setSimBalance(balance); }, [balance]);

  const ranked = useMemo(() => {
    const results: ReplayResult[] = STRATEGY_PRESETS.map((p) =>
      replayBucket(trades, fieldKeys, { ...p, riskPct }, { balance: simBalance, propFirm, highFidelityOnly }),
    );
    return results.sort((a, b) => {
      const aBust = busted(a);
      const bBust = busted(b);
      if (aBust !== bBust) return aBust ? 1 : -1;
      if (b.totalDollars !== a.totalDollars) return b.totalDollars - a.totalDollars;
      return b.expectancyR - a.expectancyR;
    });
  }, [trades, fieldKeys, riskPct, simBalance, propFirm, highFidelityOnly]);


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
  const upliftWinRatePp =
    winner && baselineCurrent && winner.strategy.id !== "current"
      ? (winner.winRate - baselineCurrent.winRate) * 100
      : null;

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-primary" />
            <h3 className="font-semibold">Auto-ranker</h3>
            <Badge variant="outline" className="text-xs">{scopeLabel}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Replays {trades.length} trades through every preset at a fixed risk %, then ranks. Busted strategies are demoted.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Label htmlFor="rank-balance" className="text-xs whitespace-nowrap">Sim $</Label>
            <Input
              id="rank-balance"
              type="number"
              value={simBalance}
              onChange={(e) => setSimBalance(Math.max(0, Number(e.target.value) || 0))}
              className="h-8 w-28 font-mono-numbers text-xs"
              min={0}
              step={1000}
            />
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
          <div className="flex items-center gap-2">
            <Switch
              id="rank-fidelity"
              checked={highFidelityOnly}
              onCheckedChange={setHighFidelityOnly}
            />
            <Label htmlFor="rank-fidelity" className="text-xs flex items-center gap-1 cursor-pointer">
              <ShieldCheck className="w-3 h-3" /> High-fidelity only
            </Label>
          </div>
        </div>
      </div>

      {winner && (
        <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
          <div className="flex items-center gap-2 mb-1">
            <Trophy className="w-3.5 h-3.5 text-primary" />
            <span className="font-medium">Best for this bucket:</span>
            <span>{winner.strategy.label}</span>
            {!busted(winner) && propFirm && (
              <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-xs">
                <CheckCircle2 className="w-3 h-3 mr-1" /> survives
              </Badge>
            )}
            {busted(winner) && (
              <Badge variant="destructive" className="text-xs">
                <AlertTriangle className="w-3 h-3 mr-1" /> all presets bust
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {winner.strategy.description}{" "}
            <span className="text-foreground">
              {fmtMoney(winner.totalDollars)} total · {(winner.winRate * 100).toFixed(0)}% WR ·{" "}
              {winner.expectancyR >= 0 ? "+" : ""}{winner.expectancyR.toFixed(2)}R expectancy
            </span>
            {upliftDollars != null && Math.abs(upliftDollars) > 1 && (
              <>
                {" — "}
                <span className={upliftDollars >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>
                  {upliftDollars >= 0 ? "+" : ""}{fmtMoney(upliftDollars)} vs your current behavior
                </span>
                {upliftWinRatePp != null && Math.abs(upliftWinRatePp) >= 1 && (
                  <span className="text-muted-foreground">
                    {" "}({upliftWinRatePp >= 0 ? "+" : ""}{upliftWinRatePp.toFixed(0)}pp WR)
                  </span>
                )}
              </>
            )}
          </p>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border/60">
              <th className="text-left py-2 pr-2">#</th>
              <th className="text-left py-2 pr-2">Strategy</th>
              <th className="text-right py-2 px-2">Total $</th>
              <th className="text-right py-2 px-2">Win %</th>
              <th className="text-right py-2 px-2">Expectancy</th>
              <th className="text-right py-2 px-2">Max DD</th>
              <th className="text-right py-2 px-2">Streak</th>
              <th className="text-left py-2 pl-2">Prop-firm</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r, i) => {
              const isWinner = i === 0;
              const isBust = busted(r);
              return (
                <tr
                  key={r.strategy.id}
                  className={`border-b border-border/30 ${isWinner ? "bg-primary/5" : ""} ${isBust ? "opacity-50" : ""}`}
                >
                  <td className="py-2 pr-2 font-mono-numbers text-xs text-muted-foreground">{i + 1}</td>
                  <td className="py-2 pr-2">
                    <div className={`font-medium ${isWinner ? "text-primary" : ""}`}>{r.strategy.label}</div>
                  </td>
                  <td
                    className={`py-2 px-2 text-right font-mono-numbers font-semibold ${r.totalDollars >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}
                  >
                    {fmtMoney(r.totalDollars)}
                  </td>
                  <td className="py-2 px-2 text-right font-mono-numbers">
                    {(r.winRate * 100).toFixed(0)}%
                  </td>
                  <td className="py-2 px-2 text-right font-mono-numbers">
                    {r.expectancyR >= 0 ? "+" : ""}{r.expectancyR.toFixed(2)}R
                  </td>
                  <td className="py-2 px-2 text-right font-mono-numbers text-destructive">
                    {fmtMoney(r.maxDrawdownDollars)}
                  </td>
                  <td className="py-2 px-2 text-right font-mono-numbers">{r.worstLosingStreak}</td>
                  <td className="py-2 pl-2">
                    {r.propFirmVerdict === "n/a" ? (
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

      <p className="text-xs text-muted-foreground border-t pt-3 leading-relaxed">
        <AlertTriangle className="w-3 h-3 inline mr-1" />
        All presets are tested at the same risk %, so the ranking isolates exit-strategy edge. Survival
        beats P&L: a strategy that busts the prop-firm is ranked below every survivor, even if its raw
        $ would be higher.
        {winner && !winner.strategy.useActualOutcome && (
          <>
            {" "}
            <span className="text-muted-foreground">
              Data fidelity: <span className="text-emerald-600 dark:text-emerald-400">{winner.fidelity.full} logged</span>
              {winner.fidelity.tp_reached > 0 && <> · <span className="text-amber-600 dark:text-amber-400">{winner.fidelity.tp_reached} from tp_reached</span></>}
              {winner.fidelity.r_only > 0 && <> · <span className="text-amber-600 dark:text-amber-400">{winner.fidelity.r_only} from r-multiple</span></>}
              {winner.fidelity.fallback > 0 && <> · <span className="text-destructive">{winner.fidelity.fallback} fallback</span></>}
              {winner.skippedLowFidelity > 0 && <> · <span className="text-muted-foreground">{winner.skippedLowFidelity} skipped</span></>}
              {". "}Winners with no MFE are extended to the bucket median to avoid under-counting partial-profit exits.
            </span>
          </>
        )}
      </p>
    </Card>
  );
}
