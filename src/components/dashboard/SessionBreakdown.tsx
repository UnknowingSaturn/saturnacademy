import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SessionMetrics, SessionType } from "@/types/trading";
import { cn } from "@/lib/utils";

interface SessionBreakdownProps {
  bySession: Record<SessionType, SessionMetrics>;
}

const sessionConfig: Record<SessionType, { label: string; className: string }> = {
  tokyo: { label: "Tokyo", className: "session-tokyo" },
  london: { label: "London", className: "session-london" },
  new_york: { label: "New York", className: "session-newyork" },
  overlap_london_ny: { label: "Overlap", className: "session-overlap" },
  off_hours: { label: "Off Hours", className: "bg-muted text-muted-foreground" },
};

export function SessionBreakdown({ bySession }: SessionBreakdownProps) {
  const sessions = Object.entries(bySession)
    .filter(([_, metrics]) => metrics.trades > 0)
    .sort((a, b) => b[1].trades - a[1].trades);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-medium">Session Performance</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No trades yet</p>
          ) : (
            sessions.map(([session, metrics]) => {
              const config = sessionConfig[session as SessionType];
              return (
                <div key={session} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className={cn("session-badge", config.className)}>
                      {config.label}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {metrics.trades} trades
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Win Rate: </span>
                      <span className={cn(
                        "font-medium",
                        metrics.winRate >= 50 ? "text-profit" : "text-loss"
                      )}>
                        {metrics.winRate.toFixed(1)}%
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Avg R: </span>
                      <span className={cn(
                        "font-medium font-mono-numbers",
                        metrics.avgR >= 0 ? "text-profit" : "text-loss"
                      )}>
                        {metrics.avgR >= 0 ? "+" : ""}{metrics.avgR.toFixed(2)}R
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">P&L: </span>
                      <span className={cn(
                        "font-medium font-mono-numbers",
                        metrics.totalPnl >= 0 ? "text-profit" : "text-loss"
                      )}>
                        {metrics.totalPnl >= 0 ? "+" : ""}${metrics.totalPnl.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}