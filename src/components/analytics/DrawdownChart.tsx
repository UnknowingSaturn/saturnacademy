import { useMemo } from "react";
import { Trade } from "@/types/trading";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import { format } from "date-fns";

interface DrawdownChartProps {
  trades: Trade[];
  startingBalance?: number;
}

export function DrawdownChart({ trades, startingBalance = 10000 }: DrawdownChartProps) {
  const data = useMemo(() => {
    const closedTrades = trades
      .filter(t => !t.is_open && t.exit_time)
      .sort((a, b) => new Date(a.exit_time!).getTime() - new Date(b.exit_time!).getTime());

    let balance = startingBalance;
    let peak = startingBalance;
    const points: { date: string; drawdown: number; drawdownPercent: number; balance: number }[] = [];

    points.push({ 
      date: "Start", 
      drawdown: 0, 
      drawdownPercent: 0,
      balance: startingBalance 
    });

    closedTrades.forEach((trade) => {
      balance += trade.net_pnl || 0;
      peak = Math.max(peak, balance);
      const drawdown = peak - balance;
      const drawdownPercent = (drawdown / peak) * 100;

      points.push({
        date: format(new Date(trade.exit_time!), "MMM d"),
        drawdown: -drawdown, // Negative for visual
        drawdownPercent,
        balance,
      });
    });

    return points;
  }, [trades, startingBalance]);

  const maxDrawdown = Math.max(...data.map(d => d.drawdownPercent));
  const currentDrawdown = data.length > 0 ? data[data.length - 1].drawdownPercent : 0;

  return (
    <div className="rounded-xl border border-border/50 bg-card/80 backdrop-blur-xl overflow-hidden"
      style={{
        boxShadow: "0 0 0 1px hsl(0 0% 100% / 0.05), 0 8px 32px -8px hsl(0 0% 0% / 0.5)"
      }}
    >
      <div className="p-6 pb-2">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Drawdown</h3>
            <p className="text-sm text-muted-foreground">Decline from equity peak</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-loss font-mono"
              style={{ textShadow: "0 0 15px hsl(var(--loss) / 0.4)" }}
            >
              -{maxDrawdown.toFixed(1)}%
            </p>
            <p className="text-xs text-muted-foreground">Max Drawdown</p>
          </div>
        </div>
      </div>
      <div className="px-2 pb-4">
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="drawdownGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(0, 85%, 58%)" stopOpacity={0} />
                  <stop offset="100%" stopColor="hsl(0, 85%, 58%)" stopOpacity={0.4} />
                </linearGradient>
              </defs>
              <XAxis 
                dataKey="date" 
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(0, 0%, 55%)", fontSize: 11 }}
              />
              <YAxis 
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(0, 0%, 55%)", fontSize: 11 }}
                tickFormatter={(value) => `$${Math.abs(value).toFixed(0)}`}
                width={50}
                domain={['dataMin', 0]}
              />
              <ReferenceLine y={0} stroke="hsl(0, 0%, 20%)" strokeDasharray="3 3" />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(0, 0%, 6%)",
                  border: "1px solid hsl(0, 0%, 15%)",
                  borderRadius: "12px",
                  boxShadow: "0 8px 32px -8px hsl(0 0% 0% / 0.6)",
                  padding: "12px 16px",
                }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const data = payload[0].payload;
                  return (
                    <div className="bg-popover border border-border rounded-xl p-4 shadow-glass">
                      <p className="font-semibold text-foreground mb-2">{label}</p>
                      <div className="space-y-1 text-sm">
                        <p>
                          <span className="text-muted-foreground">Drawdown: </span>
                          <span className="font-mono font-semibold text-loss">
                            -${Math.abs(data.drawdown).toFixed(2)}
                          </span>
                        </p>
                        <p>
                          <span className="text-muted-foreground">Percentage: </span>
                          <span className="font-mono font-semibold text-loss">
                            -{data.drawdownPercent.toFixed(2)}%
                          </span>
                        </p>
                      </div>
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="drawdown"
                stroke="hsl(0, 85%, 58%)"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#drawdownGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
