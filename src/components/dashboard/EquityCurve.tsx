import { useMemo } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Trade } from "@/types/trading";
import { format } from "date-fns";

interface EquityCurveProps {
  trades: Trade[];
  startingBalance?: number;
  currentEquity?: number;
}

export function EquityCurve({ trades, startingBalance = 10000, currentEquity }: EquityCurveProps) {
  const data = useMemo(() => {
    const closedTrades = trades
      .filter(t => !t.is_open && t.exit_time)
      .sort((a, b) => new Date(a.exit_time!).getTime() - new Date(b.exit_time!).getTime());

    let balance = startingBalance;
    const points = [{ date: "Start", balance, pnl: 0 }];

    closedTrades.forEach((trade) => {
      balance += trade.net_pnl || 0;
      points.push({
        date: format(new Date(trade.exit_time!), "MMM d"),
        balance: Math.round(balance * 100) / 100,
        pnl: trade.net_pnl || 0,
      });
    });

    return points;
  }, [trades, startingBalance]);

  // Use actual current equity if provided, otherwise calculate from chart data
  const displayEquity = currentEquity ?? (data.length > 0 ? data[data.length - 1].balance : startingBalance);
  const isProfit = displayEquity > startingBalance;
  const periodPnl = data.length > 1 ? data[data.length - 1].balance - startingBalance : 0;
  const totalPnl = displayEquity - startingBalance;
  const pnlPercent = startingBalance > 0 ? ((totalPnl / startingBalance) * 100).toFixed(2) : "0.00";

  return (
    <div className="col-span-2 rounded-xl border border-border/50 bg-card/80 backdrop-blur-xl overflow-hidden"
      style={{
        boxShadow: "0 0 0 1px hsl(0 0% 100% / 0.05), 0 8px 32px -8px hsl(0 0% 0% / 0.5)"
      }}
    >
      <div className="p-6 pb-2">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Equity Curve</h3>
            <p className="text-sm text-muted-foreground">Account balance over time</p>
          </div>
          <div className="text-right">
            <p className={`text-2xl font-bold font-mono ${isProfit ? 'text-profit' : 'text-loss'}`}
              style={{ textShadow: isProfit ? "0 0 20px hsl(var(--profit) / 0.4)" : "0 0 20px hsl(var(--loss) / 0.4)" }}
            >
              ${displayEquity.toLocaleString()}
            </p>
            <p className={`text-sm font-medium ${isProfit ? 'text-profit' : 'text-loss'}`}>
              {totalPnl >= 0 ? '+' : ''}{pnlPercent}% total
            </p>
            {periodPnl !== 0 && (
              <p className={`text-xs ${periodPnl >= 0 ? 'text-profit/70' : 'text-loss/70'}`}>
                {periodPnl >= 0 ? '+' : ''}${periodPnl.toFixed(2)} this period
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="px-2 pb-4">
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                  <stop 
                    offset="0%" 
                    stopColor={isProfit ? "hsl(152, 95%, 45%)" : "hsl(0, 85%, 58%)"} 
                    stopOpacity={0.4}
                  />
                  <stop 
                    offset="100%" 
                    stopColor={isProfit ? "hsl(152, 95%, 45%)" : "hsl(0, 85%, 58%)"} 
                    stopOpacity={0}
                  />
                </linearGradient>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                  <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                  </feMerge>
                </filter>
              </defs>
              <XAxis 
                dataKey="date" 
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(0, 0%, 55%)", fontSize: 11 }}
                dy={10}
              />
              <YAxis 
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(0, 0%, 55%)", fontSize: 11 }}
                tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                width={50}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(0, 0%, 6%)",
                  border: "1px solid hsl(0, 0%, 15%)",
                  borderRadius: "12px",
                  boxShadow: "0 8px 32px -8px hsl(0 0% 0% / 0.6)",
                  padding: "12px 16px",
                }}
                labelStyle={{ color: "hsl(0, 0%, 95%)", fontWeight: 600, marginBottom: 4 }}
                formatter={(value: number) => [
                  <span style={{ color: isProfit ? "hsl(152, 95%, 45%)" : "hsl(0, 85%, 58%)", fontFamily: "JetBrains Mono", fontWeight: 600 }}>
                    ${value.toLocaleString()}
                  </span>, 
                  "Balance"
                ]}
              />
              <Area
                type="monotone"
                dataKey="balance"
                stroke={isProfit ? "hsl(152, 95%, 45%)" : "hsl(0, 85%, 58%)"}
                strokeWidth={2.5}
                fillOpacity={1}
                fill="url(#colorBalance)"
                filter="url(#glow)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
