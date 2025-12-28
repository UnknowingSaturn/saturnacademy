import { useTrades } from "@/hooks/useTrades";
import { useDashboardMetrics } from "@/hooks/useDashboardMetrics";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { EquityCurve } from "@/components/dashboard/EquityCurve";
import { SessionBreakdown } from "@/components/dashboard/SessionBreakdown";
import { 
  TrendingUp, 
  TrendingDown, 
  Target, 
  Percent, 
  DollarSign,
  BarChart3,
  Flame,
  Trophy
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const { data: trades, isLoading } = useTrades();
  const metrics = useDashboardMetrics(trades || []);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">Your trading performance at a glance</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-[120px] rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Your trading performance at a glance</p>
      </div>

      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total P&L"
          value={`${metrics.totalPnl >= 0 ? "+" : ""}$${metrics.totalPnl.toFixed(2)}`}
          subtitle={`${metrics.totalTrades} closed trades`}
          icon={<DollarSign className="w-5 h-5" />}
          trend={metrics.totalPnl >= 0 ? "up" : "down"}
        />
        <MetricCard
          title="Win Rate"
          value={`${metrics.winRate.toFixed(1)}%`}
          subtitle={`${Math.round(metrics.totalTrades * metrics.winRate / 100)} wins`}
          icon={<Percent className="w-5 h-5" />}
          trend={metrics.winRate >= 50 ? "up" : "down"}
        />
        <MetricCard
          title="Profit Factor"
          value={metrics.profitFactor === Infinity ? "∞" : metrics.profitFactor.toFixed(2)}
          subtitle="Gross profit / Gross loss"
          icon={<BarChart3 className="w-5 h-5" />}
          trend={metrics.profitFactor >= 1.5 ? "up" : metrics.profitFactor >= 1 ? "neutral" : "down"}
        />
        <MetricCard
          title="Avg R-Multiple"
          value={`${metrics.avgRMultiple >= 0 ? "+" : ""}${metrics.avgRMultiple.toFixed(2)}R`}
          subtitle="Risk-adjusted returns"
          icon={<Target className="w-5 h-5" />}
          trend={metrics.avgRMultiple >= 0 ? "up" : "down"}
        />
        <MetricCard
          title="Best Trade"
          value={`+$${metrics.bestTrade.toFixed(2)}`}
          icon={<Trophy className="w-5 h-5" />}
          trend="up"
        />
        <MetricCard
          title="Worst Trade"
          value={`$${metrics.worstTrade.toFixed(2)}`}
          icon={<TrendingDown className="w-5 h-5" />}
          trend="down"
        />
        <MetricCard
          title="Expectancy"
          value={`$${metrics.expectancy.toFixed(2)}`}
          subtitle="Per trade average"
          icon={<TrendingUp className="w-5 h-5" />}
          trend={metrics.expectancy >= 0 ? "up" : "down"}
        />
        <MetricCard
          title="Current Streak"
          value={`${metrics.currentStreak.count} ${metrics.currentStreak.type}${metrics.currentStreak.count !== 1 ? "s" : ""}`}
          icon={<Flame className="w-5 h-5" />}
          trend={metrics.currentStreak.type === "win" ? "up" : "down"}
        />
      </div>

      {/* Charts Row */}
      <div className="grid gap-4 lg:grid-cols-3">
        <EquityCurve trades={trades || []} />
        <SessionBreakdown bySession={metrics.bySession} />
      </div>
    </div>
  );
}