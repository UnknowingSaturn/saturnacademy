import { useMemo } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Trade } from "@/types/trading";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface EquityCurveProps {
  trades: Trade[];
  startingBalance?: number;
}

export function EquityCurve({ trades, startingBalance = 10000 }: EquityCurveProps) {
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

  const isProfit = data.length > 1 && data[data.length - 1].balance > startingBalance;

  return (
    <Card className="col-span-2">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-medium">Equity Curve</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                  <stop 
                    offset="5%" 
                    stopColor={isProfit ? "hsl(var(--profit))" : "hsl(var(--loss))"} 
                    stopOpacity={0.3}
                  />
                  <stop 
                    offset="95%" 
                    stopColor={isProfit ? "hsl(var(--profit))" : "hsl(var(--loss))"} 
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <XAxis 
                dataKey="date" 
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
              />
              <YAxis 
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                tickFormatter={(value) => `$${value.toLocaleString()}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
                labelStyle={{ color: "hsl(var(--foreground))" }}
                formatter={(value: number) => [`$${value.toLocaleString()}`, "Balance"]}
              />
              <Area
                type="monotone"
                dataKey="balance"
                stroke={isProfit ? "hsl(var(--profit))" : "hsl(var(--loss))"}
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorBalance)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}