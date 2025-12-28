import { useMemo } from "react";
import { Trade } from "@/types/trading";
import { getDay, format } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from "recharts";

interface PerformanceByDayProps {
  trades: Trade[];
}

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function PerformanceByDay({ trades }: PerformanceByDayProps) {
  const data = useMemo(() => {
    const closedTrades = trades.filter(t => !t.is_open && t.exit_time);
    
    const dayStats = dayNames.map((name, index) => ({
      day: name,
      dayIndex: index,
      pnl: 0,
      trades: 0,
      wins: 0,
      winRate: 0,
    }));

    closedTrades.forEach(trade => {
      if (!trade.exit_time) return;
      const dayIndex = getDay(new Date(trade.exit_time));
      dayStats[dayIndex].pnl += trade.net_pnl || 0;
      dayStats[dayIndex].trades += 1;
      if ((trade.net_pnl || 0) > 0) {
        dayStats[dayIndex].wins += 1;
      }
    });

    dayStats.forEach(day => {
      day.winRate = day.trades > 0 ? (day.wins / day.trades) * 100 : 0;
    });

    return dayStats;
  }, [trades]);

  const maxPnl = Math.max(...data.map(d => Math.abs(d.pnl)));

  return (
    <div className="rounded-xl border border-border/50 bg-card/80 backdrop-blur-xl overflow-hidden"
      style={{
        boxShadow: "0 0 0 1px hsl(0 0% 100% / 0.05), 0 8px 32px -8px hsl(0 0% 0% / 0.5)"
      }}
    >
      <div className="p-6 pb-2">
        <h3 className="text-lg font-semibold text-foreground">Performance by Day</h3>
        <p className="text-sm text-muted-foreground">P&L breakdown by day of week</p>
      </div>
      <div className="px-2 pb-4">
        <div className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 20, right: 20, left: 0, bottom: 5 }}>
              <XAxis 
                dataKey="day" 
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(0, 0%, 55%)", fontSize: 11 }}
              />
              <YAxis 
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(0, 0%, 55%)", fontSize: 11 }}
                tickFormatter={(value) => `$${value >= 0 ? '' : '-'}${Math.abs(value).toFixed(0)}`}
                width={60}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(0, 0%, 6%)",
                  border: "1px solid hsl(0, 0%, 15%)",
                  borderRadius: "12px",
                  boxShadow: "0 8px 32px -8px hsl(0 0% 0% / 0.6)",
                  padding: "12px 16px",
                }}
                labelStyle={{ color: "hsl(0, 0%, 95%)", fontWeight: 600, marginBottom: 8 }}
                formatter={(value: number, name: string) => {
                  if (name === "pnl") {
                    return [
                      <span style={{ color: value >= 0 ? "hsl(152, 95%, 45%)" : "hsl(0, 85%, 58%)", fontFamily: "JetBrains Mono", fontWeight: 600 }}>
                        {value >= 0 ? '+' : ''}${value.toFixed(2)}
                      </span>,
                      "P&L"
                    ];
                  }
                  return [value, name];
                }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const data = payload[0].payload;
                  return (
                    <div className="bg-popover border border-border rounded-xl p-4 shadow-glass">
                      <p className="font-semibold text-foreground mb-2">{label}</p>
                      <div className="space-y-1 text-sm">
                        <p>
                          <span className="text-muted-foreground">P&L: </span>
                          <span className={`font-mono font-semibold ${data.pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                            {data.pnl >= 0 ? '+' : ''}${data.pnl.toFixed(2)}
                          </span>
                        </p>
                        <p>
                          <span className="text-muted-foreground">Trades: </span>
                          <span className="text-foreground font-medium">{data.trades}</span>
                        </p>
                        <p>
                          <span className="text-muted-foreground">Win Rate: </span>
                          <span className={`font-medium ${data.winRate >= 50 ? 'text-profit' : 'text-loss'}`}>
                            {data.winRate.toFixed(0)}%
                          </span>
                        </p>
                      </div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="pnl" radius={[6, 6, 0, 0]}>
                {data.map((entry, index) => (
                  <Cell 
                    key={`cell-${index}`} 
                    fill={entry.pnl >= 0 ? "hsl(152, 95%, 45%)" : "hsl(0, 85%, 58%)"}
                    style={{
                      filter: `drop-shadow(0 0 8px ${entry.pnl >= 0 ? "hsl(152, 95%, 45%, 0.5)" : "hsl(0, 85%, 58%, 0.5)"})`
                    }}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
