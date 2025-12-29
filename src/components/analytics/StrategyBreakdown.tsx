import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { usePlaybookStats } from "@/hooks/usePlaybookStats";
import { Target, TrendingUp, TrendingDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function StrategyBreakdown() {
  const { data: stats, isLoading } = usePlaybookStats();
  const navigate = useNavigate();

  const sortedStrategies = useMemo(() => {
    if (!stats) return [];
    return Object.values(stats)
      .filter(s => s.totalTrades > 0)
      .sort((a, b) => b.totalPnl - a.totalPnl);
  }, [stats]);

  const maxPnl = useMemo(() => {
    if (sortedStrategies.length === 0) return 0;
    return Math.max(...sortedStrategies.map(s => Math.abs(s.totalPnl)));
  }, [sortedStrategies]);

  const handleStrategyClick = (strategyName: string) => {
    navigate(`/journal?model=${encodeURIComponent(strategyName)}`);
  };

  if (isLoading) {
    return (
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="w-5 h-5 text-primary" />
            Strategy Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 animate-pulse">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 bg-muted rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (sortedStrategies.length === 0) {
    return (
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="w-5 h-5 text-primary" />
            Strategy Performance
          </CardTitle>
          <CardDescription>P&L and win rate by trading strategy</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Target className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p>No strategy data yet</p>
            <p className="text-sm">Assign playbooks to trades to see performance</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="w-5 h-5 text-primary" />
          Strategy Performance
        </CardTitle>
        <CardDescription>P&L and win rate by trading strategy</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {sortedStrategies.map((strategy) => {
          const isProfit = strategy.totalPnl >= 0;
          const barWidth = maxPnl > 0 ? (Math.abs(strategy.totalPnl) / maxPnl) * 100 : 0;
          
          return (
            <div
              key={strategy.playbookId}
              onClick={() => handleStrategyClick(strategy.playbookName)}
              className="group relative p-3 rounded-lg border border-border/50 hover:border-primary/50 hover:bg-muted/50 cursor-pointer transition-all"
            >
              {/* Background bar */}
              <div
                className={cn(
                  "absolute inset-y-0 left-0 rounded-l-lg opacity-10 transition-all",
                  isProfit ? "bg-profit" : "bg-destructive"
                )}
                style={{ width: `${barWidth}%` }}
              />
              
              <div className="relative flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{strategy.playbookName}</span>
                    <span className="text-xs text-muted-foreground">
                      {strategy.totalTrades} trade{strategy.totalTrades !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      Win Rate: <span className={cn(
                        "font-medium",
                        strategy.winRate >= 50 ? "text-profit" : "text-destructive"
                      )}>{strategy.winRate.toFixed(0)}%</span>
                    </span>
                    <span className="flex items-center gap-1">
                      Avg R: <span className={cn(
                        "font-medium",
                        strategy.avgR >= 0 ? "text-profit" : "text-destructive"
                      )}>{strategy.avgR.toFixed(2)}R</span>
                    </span>
                    <span className="flex items-center gap-1">
                      PF: <span className="font-medium">
                        {strategy.profitFactor === Infinity ? '∞' : strategy.profitFactor.toFixed(2)}
                      </span>
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "flex items-center gap-1 font-semibold",
                    isProfit ? "text-profit" : "text-destructive"
                  )}>
                    {isProfit ? (
                      <TrendingUp className="w-4 h-4" />
                    ) : (
                      <TrendingDown className="w-4 h-4" />
                    )}
                    <span>${Math.abs(strategy.totalPnl).toFixed(0)}</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
