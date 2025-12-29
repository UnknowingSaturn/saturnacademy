import { useTrades } from "@/hooks/useTrades";
import { PnLCalendar } from "@/components/analytics/PnLCalendar";
import { PerformanceByDay } from "@/components/analytics/PerformanceByDay";
import { PerformanceByHour } from "@/components/analytics/PerformanceByHour";
import { SymbolBreakdown } from "@/components/analytics/SymbolBreakdown";
import { DrawdownChart } from "@/components/analytics/DrawdownChart";
import { RMultipleDistribution } from "@/components/analytics/RMultipleDistribution";
import { StreakAnalysis } from "@/components/analytics/StreakAnalysis";
import { StrategyBreakdown } from "@/components/analytics/StrategyBreakdown";
import { Skeleton } from "@/components/ui/skeleton";

export default function Analytics() {
  const { data: trades, isLoading } = useTrades();

  if (isLoading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold">Analytics</h1>
          <p className="text-muted-foreground">Deep dive into your trading performance</p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-[300px] rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Analytics</h1>
        <p className="text-muted-foreground">Deep dive into your trading performance</p>
      </div>

      {/* P&L Calendar - Full Width */}
      <PnLCalendar trades={trades || []} />

      {/* Strategy Breakdown - Full Width */}
      <StrategyBreakdown />

      {/* Charts Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <PerformanceByDay trades={trades || []} />
        <SymbolBreakdown trades={trades || []} />
        <DrawdownChart trades={trades || []} />
        <StreakAnalysis trades={trades || []} />
        <PerformanceByHour trades={trades || []} />
        <RMultipleDistribution trades={trades || []} />
      </div>
    </div>
  );
}
