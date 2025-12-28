import { useTrades } from "@/hooks/useTrades";
import { useAccounts, usePropFirmRules } from "@/hooks/useAccounts";
import { useDashboardMetrics } from "@/hooks/useDashboardMetrics";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { PropFirm, Trade } from "@/types/trading";
import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle, XCircle, Shield, TrendingUp, Calendar } from "lucide-react";
import { format, startOfDay, isToday, differenceInDays } from "date-fns";

export default function Compliance() {
  const { data: accounts } = useAccounts();
  const [selectedFirm, setSelectedFirm] = useState<PropFirm>("ftmo");
  const { data: rules } = usePropFirmRules(selectedFirm);
  const { data: trades } = useTrades();

  const propAccounts = accounts?.filter(a => a.prop_firm) || [];

  const complianceStats = useMemo(() => {
    if (!trades || !rules) return null;

    const closedTrades = trades.filter(t => !t.is_open);
    
    // Get rules
    const dailyLossRule = rules.find(r => r.rule_type === "daily_loss");
    const maxDrawdownRule = rules.find(r => r.rule_type === "max_drawdown");
    const profitTargetRule = rules.find(r => r.rule_type === "profit_target");
    const minDaysRule = rules.find(r => r.rule_type === "min_days");

    // Calculate starting balance (assume first account or 10k default)
    const startingBalance = 10000;

    // Calculate total P&L
    const totalPnl = closedTrades.reduce((sum, t) => sum + (t.net_pnl || 0), 0);
    const currentDrawdown = Math.min(0, totalPnl);
    const maxDrawdownPercent = maxDrawdownRule?.value || 10;
    const drawdownUsed = Math.abs(currentDrawdown) / startingBalance * 100;

    // Daily P&L for today
    const todayTrades = closedTrades.filter(t => t.exit_time && isToday(new Date(t.exit_time)));
    const todayPnl = todayTrades.reduce((sum, t) => sum + (t.net_pnl || 0), 0);
    const dailyLossPercent = dailyLossRule?.value || 5;
    const dailyLossUsed = Math.abs(Math.min(0, todayPnl)) / startingBalance * 100;

    // Profit target
    const profitTargetPercent = profitTargetRule?.value || 10;
    const profitProgress = Math.max(0, totalPnl) / startingBalance * 100;

    // Trading days
    const tradingDays = new Set(
      closedTrades
        .filter(t => t.exit_time)
        .map(t => format(new Date(t.exit_time!), "yyyy-MM-dd"))
    ).size;
    const minTradingDays = minDaysRule?.value || 4;

    return {
      dailyLoss: {
        current: dailyLossUsed,
        max: dailyLossPercent,
        status: dailyLossUsed < dailyLossPercent * 0.5 ? "safe" : dailyLossUsed < dailyLossPercent * 0.8 ? "warning" : "danger",
        todayPnl,
      },
      maxDrawdown: {
        current: drawdownUsed,
        max: maxDrawdownPercent,
        status: drawdownUsed < maxDrawdownPercent * 0.5 ? "safe" : drawdownUsed < maxDrawdownPercent * 0.8 ? "warning" : "danger",
      },
      profitTarget: {
        current: profitProgress,
        target: profitTargetPercent,
        achieved: profitProgress >= profitTargetPercent,
        totalPnl,
      },
      tradingDays: {
        current: tradingDays,
        required: minTradingDays,
        achieved: tradingDays >= minTradingDays,
      },
    };
  }, [trades, rules]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Prop Firm Compliance</h1>
          <p className="text-muted-foreground">Track your progress and stay within the rules</p>
        </div>
        <Select value={selectedFirm} onValueChange={(v) => setSelectedFirm(v as PropFirm)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ftmo">FTMO</SelectItem>
            <SelectItem value="fundednext">FundedNext</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!complianceStats ? (
        <div className="text-center py-12 text-muted-foreground">
          Loading compliance data...
        </div>
      ) : (
        <>
          {/* Status Overview */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card className={cn(
              "border-l-4",
              complianceStats.dailyLoss.status === "safe" && "border-l-profit",
              complianceStats.dailyLoss.status === "warning" && "border-l-breakeven",
              complianceStats.dailyLoss.status === "danger" && "border-l-loss",
            )}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Daily Loss
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono-numbers">
                  {complianceStats.dailyLoss.current.toFixed(2)}%
                </div>
                <p className="text-xs text-muted-foreground">
                  of {complianceStats.dailyLoss.max}% limit
                </p>
                <div className="compliance-bar mt-2">
                  <div 
                    className={cn(
                      "compliance-fill",
                      complianceStats.dailyLoss.status === "safe" && "compliance-safe",
                      complianceStats.dailyLoss.status === "warning" && "compliance-warning",
                      complianceStats.dailyLoss.status === "danger" && "compliance-danger",
                    )}
                    style={{ width: `${Math.min(100, (complianceStats.dailyLoss.current / complianceStats.dailyLoss.max) * 100)}%` }}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className={cn(
              "border-l-4",
              complianceStats.maxDrawdown.status === "safe" && "border-l-profit",
              complianceStats.maxDrawdown.status === "warning" && "border-l-breakeven",
              complianceStats.maxDrawdown.status === "danger" && "border-l-loss",
            )}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Max Drawdown
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono-numbers">
                  {complianceStats.maxDrawdown.current.toFixed(2)}%
                </div>
                <p className="text-xs text-muted-foreground">
                  of {complianceStats.maxDrawdown.max}% limit
                </p>
                <div className="compliance-bar mt-2">
                  <div 
                    className={cn(
                      "compliance-fill",
                      complianceStats.maxDrawdown.status === "safe" && "compliance-safe",
                      complianceStats.maxDrawdown.status === "warning" && "compliance-warning",
                      complianceStats.maxDrawdown.status === "danger" && "compliance-danger",
                    )}
                    style={{ width: `${Math.min(100, (complianceStats.maxDrawdown.current / complianceStats.maxDrawdown.max) * 100)}%` }}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className={cn(
              "border-l-4",
              complianceStats.profitTarget.achieved ? "border-l-profit" : "border-l-primary",
            )}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  Profit Target
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono-numbers">
                  {complianceStats.profitTarget.current.toFixed(2)}%
                </div>
                <p className="text-xs text-muted-foreground">
                  of {complianceStats.profitTarget.target}% target
                </p>
                <div className="compliance-bar mt-2">
                  <div 
                    className="compliance-fill bg-primary"
                    style={{ width: `${Math.min(100, (complianceStats.profitTarget.current / complianceStats.profitTarget.target) * 100)}%` }}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className={cn(
              "border-l-4",
              complianceStats.tradingDays.achieved ? "border-l-profit" : "border-l-primary",
            )}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Trading Days
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono-numbers">
                  {complianceStats.tradingDays.current}
                </div>
                <p className="text-xs text-muted-foreground">
                  of {complianceStats.tradingDays.required} required
                </p>
                <div className="flex gap-1 mt-2">
                  {[...Array(complianceStats.tradingDays.required)].map((_, i) => (
                    <div 
                      key={i}
                      className={cn(
                        "flex-1 h-2 rounded-full",
                        i < complianceStats.tradingDays.current ? "bg-profit" : "bg-muted"
                      )}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Rules Reference */}
          <Card>
            <CardHeader>
              <CardTitle>{selectedFirm === "ftmo" ? "FTMO" : "FundedNext"} Rules</CardTitle>
              <CardDescription>Current challenge/funded rules</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                {rules?.map((rule) => (
                  <div key={rule.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div>
                      <p className="font-medium">{rule.rule_name}</p>
                      <p className="text-sm text-muted-foreground">{rule.description}</p>
                    </div>
                    <Badge variant="outline">
                      {rule.is_percentage ? `${rule.value}%` : rule.value}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}