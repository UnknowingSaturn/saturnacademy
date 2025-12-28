import { SessionMetrics, SessionType } from "@/types/trading";
import { cn } from "@/lib/utils";

interface SessionBreakdownProps {
  bySession: Record<SessionType, SessionMetrics>;
}

const sessionConfig: Record<SessionType, { label: string; className: string; color: string }> = {
  new_york_am: { label: "New York AM", className: "session-newyork", color: "hsl(35, 95%, 50%)" },
  london: { label: "London", className: "session-london", color: "hsl(210, 90%, 60%)" },
  tokyo: { label: "Tokyo", className: "session-tokyo", color: "hsl(330, 80%, 60%)" },
  new_york_pm: { label: "New York PM", className: "session-newyork", color: "hsl(35, 95%, 50%)" },
  off_hours: { label: "Off Hours", className: "bg-muted/50 text-muted-foreground border border-border/50", color: "hsl(0, 0%, 55%)" },
};

export function SessionBreakdown({ bySession }: SessionBreakdownProps) {
  const sessions = Object.entries(bySession)
    .filter(([_, metrics]) => metrics.trades > 0)
    .sort((a, b) => b[1].trades - a[1].trades);

  return (
    <div className="rounded-xl border border-border/50 bg-card/80 backdrop-blur-xl overflow-hidden"
      style={{
        boxShadow: "0 0 0 1px hsl(0 0% 100% / 0.05), 0 8px 32px -8px hsl(0 0% 0% / 0.5)"
      }}
    >
      <div className="p-6 pb-4">
        <h3 className="text-lg font-semibold text-foreground">Session Performance</h3>
        <p className="text-sm text-muted-foreground">Win rate and P&L by trading session</p>
      </div>
      <div className="px-6 pb-6">
        <div className="space-y-4">
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No trades yet</p>
          ) : (
            sessions.map(([session, metrics]) => {
              const config = sessionConfig[session as SessionType];
              const winRatePercent = metrics.winRate;
              const isProfit = metrics.totalPnl >= 0;
              
              return (
                <div key={session} className="group space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={cn("session-badge", config.className)}>
                        {config.label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {metrics.trades} trades
                      </span>
                    </div>
                    <span className={cn(
                      "text-sm font-bold font-mono",
                      isProfit ? "text-profit" : "text-loss"
                    )}
                    style={{
                      textShadow: isProfit 
                        ? "0 0 15px hsl(var(--profit) / 0.4)"
                        : "0 0 15px hsl(var(--loss) / 0.4)"
                    }}
                    >
                      {isProfit ? "+" : ""}${metrics.totalPnl.toFixed(0)}
                    </span>
                  </div>
                  
                  {/* Win rate bar */}
                  <div className="relative h-2 rounded-full bg-muted/50 overflow-hidden">
                    <div 
                      className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                      style={{ 
                        width: `${winRatePercent}%`,
                        backgroundColor: config.color,
                        boxShadow: `0 0 12px ${config.color}`
                      }}
                    />
                  </div>
                  
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      Win Rate: <span className={cn(
                        "font-semibold",
                        winRatePercent >= 50 ? "text-profit" : "text-loss"
                      )}>{winRatePercent.toFixed(0)}%</span>
                    </span>
                    <span>
                      Avg R: <span className={cn(
                        "font-mono font-semibold",
                        metrics.avgR >= 0 ? "text-profit" : "text-loss"
                      )}>{metrics.avgR >= 0 ? "+" : ""}{metrics.avgR.toFixed(2)}</span>
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
