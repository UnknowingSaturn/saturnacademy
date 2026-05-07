import * as React from "react";
import { SessionMetrics, SessionType } from "@/types/trading";
import { useSessionLookup } from "@/hooks/useUserSettings";
import { cn } from "@/lib/utils";

interface SessionBreakdownProps {
  bySession: Record<SessionType, SessionMetrics>;
}

function humanize(key: string) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const SessionBreakdown = React.forwardRef<HTMLDivElement, SessionBreakdownProps>(
  function SessionBreakdown({ bySession }, _ref) {
    const { byKey } = useSessionLookup();

    const sessions = Object.entries(bySession)
      .filter(([_, metrics]) => metrics.trades > 0)
      .sort((a, b) => {
        const sa = byKey[a[0]]?.sort_order ?? 9999;
        const sb = byKey[b[0]]?.sort_order ?? 9999;
        return sa - sb;
      });

    return (
      <div
        className="rounded-xl border border-border/50 bg-card/80 backdrop-blur-xl overflow-hidden"
        style={{
          boxShadow: "0 0 0 1px hsl(0 0% 100% / 0.05), 0 8px 32px -8px hsl(0 0% 0% / 0.5)",
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
                const def = byKey[session];
                const label = def?.name || humanize(session);
                const color = def?.color || "#6B7280";
                const winRatePercent = metrics.winRate;
                const isProfit = metrics.totalPnl >= 0;

                return (
                  <div key={session} className="group space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span
                          className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold border backdrop-blur-sm"
                          style={{
                            backgroundColor: `${color}26`,
                            color,
                            borderColor: `${color}4D`,
                          }}
                        >
                          {label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {metrics.trades} trades
                        </span>
                      </div>
                      <span
                        className={cn(
                          "text-sm font-bold font-mono",
                          isProfit ? "text-profit" : "text-loss"
                        )}
                        style={{
                          textShadow: isProfit
                            ? "0 0 15px hsl(var(--profit) / 0.4)"
                            : "0 0 15px hsl(var(--loss) / 0.4)",
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
                          backgroundColor: color,
                          boxShadow: `0 0 12px ${color}`,
                        }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        Win Rate:{" "}
                        <span
                          className={cn(
                            "font-semibold",
                            winRatePercent >= 50 ? "text-profit" : "text-loss"
                          )}
                        >
                          {winRatePercent.toFixed(0)}%
                        </span>
                      </span>
                      <span>
                        Avg R:{" "}
                        <span
                          className={cn(
                            "font-mono font-semibold",
                            metrics.avgR >= 0 ? "text-profit" : "text-loss"
                          )}
                        >
                          {metrics.avgR >= 0 ? "+" : ""}
                          {metrics.avgR.toFixed(2)}
                        </span>
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
);
