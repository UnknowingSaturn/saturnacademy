import { useMemo } from "react";
import { Trade } from "@/types/trading";
import { getHours, format } from "date-fns";
import { cn } from "@/lib/utils";

interface PerformanceByHourProps {
  trades: Trade[];
}

export function PerformanceByHour({ trades }: PerformanceByHourProps) {
  const data = useMemo(() => {
    const closedTrades = trades.filter(t => !t.is_open && t.exit_time);
    
    // Initialize all 24 hours
    const hourStats = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      label: `${hour.toString().padStart(2, "0")}:00`,
      pnl: 0,
      trades: 0,
      wins: 0,
      winRate: 0,
    }));

    closedTrades.forEach(trade => {
      if (!trade.entry_time) return;
      const hour = getHours(new Date(trade.entry_time));
      hourStats[hour].pnl += trade.net_pnl || 0;
      hourStats[hour].trades += 1;
      if ((trade.net_pnl || 0) > 0) {
        hourStats[hour].wins += 1;
      }
    });

    hourStats.forEach(stat => {
      stat.winRate = stat.trades > 0 ? (stat.wins / stat.trades) * 100 : 0;
    });

    return hourStats;
  }, [trades]);

  const maxPnl = Math.max(...data.map(d => Math.abs(d.pnl)));
  const maxTrades = Math.max(...data.map(d => d.trades));

  // Show only trading hours (4am to 11pm) 
  const tradingHours = data.filter(d => d.hour >= 4 && d.hour <= 23);

  return (
    <div className="rounded-xl border border-border/50 bg-card/80 backdrop-blur-xl overflow-hidden"
      style={{
        boxShadow: "0 0 0 1px hsl(0 0% 100% / 0.05), 0 8px 32px -8px hsl(0 0% 0% / 0.5)"
      }}
    >
      <div className="p-6 pb-4">
        <h3 className="text-lg font-semibold text-foreground">Performance by Hour</h3>
        <p className="text-sm text-muted-foreground">Trade entry time heatmap (UTC)</p>
      </div>
      <div className="px-6 pb-6">
        {/* Hour grid */}
        <div className="grid grid-cols-10 gap-1">
          {tradingHours.map(hourData => {
            const hasActivity = hourData.trades > 0;
            const isProfit = hourData.pnl > 0;
            const isLoss = hourData.pnl < 0;
            const intensity = hasActivity && maxPnl > 0
              ? Math.min(Math.abs(hourData.pnl) / maxPnl, 1) * 0.6 + 0.1
              : 0;

            return (
              <div
                key={hourData.hour}
                className={cn(
                  "aspect-square rounded-lg flex flex-col items-center justify-center p-1 transition-all duration-200 group relative",
                  hasActivity && "cursor-pointer hover:scale-110",
                  !hasActivity && "opacity-30"
                )}
                style={{
                  backgroundColor: hasActivity
                    ? isProfit 
                      ? `hsl(152, 95%, 45%, ${intensity})`
                      : `hsl(0, 85%, 58%, ${intensity})`
                    : "hsl(0, 0%, 10%)",
                  border: hasActivity
                    ? isProfit
                      ? "1px solid hsl(152, 95%, 45%, 0.3)"
                      : "1px solid hsl(0, 85%, 58%, 0.3)"
                    : "1px solid hsl(0, 0%, 12%)"
                }}
              >
                <span className="text-[10px] font-medium text-foreground/80">
                  {hourData.hour}h
                </span>
                {hasActivity && (
                  <span className={cn(
                    "text-[9px] font-bold font-mono",
                    isProfit ? "text-profit" : "text-loss"
                  )}>
                    {hourData.trades}
                  </span>
                )}

                {/* Tooltip */}
                {hasActivity && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                    <div className="bg-popover border border-border rounded-lg p-3 shadow-glass text-xs whitespace-nowrap">
                      <p className="font-semibold mb-1">{hourData.label}</p>
                      <p>
                        <span className="text-muted-foreground">P&L: </span>
                        <span className={cn("font-mono font-semibold", isProfit ? "text-profit" : "text-loss")}>
                          {hourData.pnl >= 0 ? "+" : ""}${hourData.pnl.toFixed(0)}
                        </span>
                      </p>
                      <p>
                        <span className="text-muted-foreground">Trades: </span>
                        <span className="font-medium">{hourData.trades}</span>
                      </p>
                      <p>
                        <span className="text-muted-foreground">Win Rate: </span>
                        <span className={cn("font-medium", hourData.winRate >= 50 ? "text-profit" : "text-loss")}>
                          {hourData.winRate.toFixed(0)}%
                        </span>
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
          <span>4:00 UTC</span>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-profit/50" />
              <span>Profit</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-loss/50" />
              <span>Loss</span>
            </div>
          </div>
          <span>23:00 UTC</span>
        </div>
      </div>
    </div>
  );
}
