// ============================================================================
// Challenge Planner card — shows live challenge status for prop-firm accounts.
// Inputs: account balance, prop-firm rules (daily-loss / max-loss / target).
// Outputs: distance to target, remaining drawdown, required net R to pass,
// empirical pass probability from bootstrap of user's historical R sample.
// ============================================================================

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Target, ShieldAlert, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTrades } from "@/hooks/useTrades";
import { useSimulatorProfile } from "@/hooks/useSimulatorProfile";
import { runMonteCarlo, extractRSample } from "@/lib/propFirmMonteCarlo";
import type { Account } from "@/types/trading";

interface Props {
  account: Account;
}

interface PropFirmRule {
  rule_type: string;
  value: number;
  is_percentage: boolean | null;
}

function usePropFirmRules(firm: string | null) {
  return useQuery({
    queryKey: ["prop_firm_rules", firm],
    queryFn: async () => {
      if (!firm) return [] as PropFirmRule[];
      const { data, error } = await supabase
        .from("prop_firm_rules")
        .select("rule_type, value, is_percentage")
        .eq("firm", firm);
      if (error) throw error;
      return (data ?? []) as PropFirmRule[];
    },
    enabled: !!firm,
  });
}

export function ChallengePlannerCard({ account }: Props) {
  const { data: rules = [] } = usePropFirmRules(account.prop_firm ?? null);
  const { data: trades = [] } = useTrades({ accountId: account.id });
  const profileQ = useSimulatorProfile();

  const balance = Number(account.equity_current || account.balance_start || 0);
  const start = Number(account.balance_start || balance);

  const toDollars = (r: PropFirmRule | undefined) => {
    if (!r) return null;
    return r.is_percentage ? start * (Number(r.value) / 100) : Number(r.value);
  };
  const dailyLoss$ = toDollars(rules.find((r) => r.rule_type === "daily_loss"));
  const maxDD$ = toDollars(rules.find((r) => r.rule_type === "max_drawdown"));
  const target$ = toDollars(rules.find((r) => r.rule_type === "profit_target"));

  // Live status
  const equityDelta = balance - start;
  const distanceToTarget = target$ != null ? Math.max(0, target$ - equityDelta) : null;
  const remainingDD = maxDD$ != null ? Math.max(0, maxDD$ - Math.max(0, -equityDelta)) : null;
  const targetProgress = target$ && target$ > 0 ? Math.max(0, Math.min(100, (equityDelta / target$) * 100)) : 0;

  const riskPct = (profileQ.data?.sim_risk_per_trade_pct ?? 1) / 100;
  const dollarRisk = start * riskPct;
  const requiredR = distanceToTarget != null && dollarRisk > 0 ? distanceToTarget / dollarRisk : null;

  // Empirical pass probability via bootstrap MC against this account's rules.
  const rSample = useMemo(() => extractRSample(trades), [trades]);
  const passProb = useMemo(() => {
    if (rSample.length < 10 || target$ == null || start <= 0) return null;
    // Reframe: simulate from current equity, not start. Use a shifted target/maxLoss.
    const result = runMonteCarlo({
      rSample,
      riskPerTradeFrac: riskPct,
      numAccounts: 1,
      accountSize: balance,
      dailyLossPct: dailyLoss$ != null ? dailyLoss$ / start : null,
      maxLossPct: maxDD$ != null ? remainingDD! / balance : null,
      targetPct: distanceToTarget != null && balance > 0 ? distanceToTarget / balance : null,
      tradesPerDay: 2,
      maxDays: 60,
      rotationModel: "one_only",
      paths: 1500,
      seed: 7,
    });
    return result.passProb;
  }, [rSample, riskPct, balance, dailyLoss$, maxDD$, target$, distanceToTarget, remainingDD, start]);

  if (!account.prop_firm) return null;
  if (target$ == null && maxDD$ == null && dailyLoss$ == null) return null;

  return (
    <Card className="p-4 space-y-3 border-primary/20">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" />
            <h4 className="font-semibold text-sm">Challenge planner · {account.name}</h4>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {account.prop_firm} · risk {(riskPct * 100).toFixed(2)}%
          </p>
        </div>
        {passProb != null && (
          <Badge className={passProb >= 0.5
            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
            : "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"}>
            {(passProb * 100).toFixed(0)}% pass prob
          </Badge>
        )}
      </div>

      {target$ != null && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Target progress</span>
            <span className="font-mono-numbers">
              ${equityDelta.toLocaleString(undefined, { maximumFractionDigits: 0 })} / ${target$.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </div>
          <Progress value={targetProgress} className="h-2" />
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 text-xs">
        {distanceToTarget != null && (
          <div>
            <div className="text-muted-foreground flex items-center gap-1"><TrendingUp className="w-3 h-3" />To target</div>
            <div className="font-mono-numbers font-semibold">
              ${distanceToTarget.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
          </div>
        )}
        {remainingDD != null && (
          <div>
            <div className="text-muted-foreground flex items-center gap-1"><ShieldAlert className="w-3 h-3" />Remaining DD</div>
            <div className="font-mono-numbers font-semibold text-destructive">
              ${remainingDD.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
          </div>
        )}
        {requiredR != null && (
          <div>
            <div className="text-muted-foreground">Required net R</div>
            <div className="font-mono-numbers font-semibold">{requiredR.toFixed(1)}R</div>
          </div>
        )}
      </div>

      {rSample.length < 10 && (
        <p className="text-[10px] text-muted-foreground">
          Need ≥10 closed trades with r_multiple_actual to compute pass probability ({rSample.length} so far).
        </p>
      )}
    </Card>
  );
}
