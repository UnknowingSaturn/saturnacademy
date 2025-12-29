import * as React from "react";
import { useMemo } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Trade } from "@/types/trading";
import { format } from "date-fns";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface EquityCurveProps {
  trades: Trade[];
  startingBalance?: number;
  previousPeriodPnl?: number;
  periodLabel?: string;
}

export const EquityCurve = React.forwardRef<HTMLDivElement, EquityCurveProps>(
  function EquityCurve({ trades, startingBalance = 10000, previousPeriodPnl = 0, periodLabel = 'period' }, _ref) {
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

  // Calculate period P&L (not overall equity)
  const periodPnl = data.length > 1 ? data[data.length - 1].balance - startingBalance : 0;
  const isProfit = periodPnl >= 0;
  const periodPnlPercent = startingBalance > 0 ? ((periodPnl / startingBalance) * 100).toFixed(2) : "0.00";
  
  // Previous period comparison
  const prevIsProfit = previousPeriodPnl >= 0;
  const prevPnlPercent = startingBalance > 0 ? ((previousPeriodPnl / startingBalance) * 100).toFixed(2) : "0.00";
  
  // Calculate delta
  const delta = periodPnl - previousPeriodPnl;
  const deltaPercent = previousPeriodPnl !== 0 
    ? ((delta / Math.abs(previousPeriodPnl)) * 100).toFixed(0)
    : periodPnl !== 0 ? '100' : '0';
  
  // Determine comparison status
  const isBetter = delta > 0;
  const isWorse = delta < 0;
  const isSame = delta === 0;

  return (
    <div className="col-span-2 rounded-xl border border-border/50 bg-card/80 backdrop-blur-xl overflow-hidden"
      style={{
        boxShadow: "0 0 0 1px hsl(0 0% 100% / 0.05), 0 8px 32px -8px hsl(0 0% 0% / 0.5)"
      }}
    >
      <div className="p-6 pb-2">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              {periodLabel === 'week' ? 'Weekly' : 'Monthly'} Performance
            </h3>
            <p className="text-sm text-muted-foreground">Period balance change</p>
          </div>
          <div className="text-right space-y-1">
            {/* Current Period P&L */}
            <div>
              <p className={`text-2xl font-bold font-mono ${isProfit ? 'text-profit' : 'text-loss'}`}
                style={{ textShadow: isProfit ? "0 0 20px hsl(var(--profit) / 0.4)" : "0 0 20px hsl(var(--loss) / 0.4)" }}
              >
                {periodPnl >= 0 ? '+' : ''}${periodPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className={`text-sm font-medium ${isProfit ? 'text-profit' : 'text-loss'}`}>
                {periodPnl >= 0 ? '+' : ''}{periodPnlPercent}% this {periodLabel}
              </p>
            </div>
            
            {/* Previous Period Comparison */}
            <div className="flex items-center justify-end gap-2 pt-1 border-t border-border/50">
              <span className="text-xs text-muted-foreground">
                Last {periodLabel}: <span className={prevIsProfit ? 'text-profit/80' : 'text-loss/80'}>
                  {previousPeriodPnl >= 0 ? '+' : ''}${previousPeriodPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </span>
              {!isSame && (
                <span className={`inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded ${
                  isBetter ? 'bg-profit/15 text-profit' : 'bg-loss/15 text-loss'
                }`}>
                  {isBetter ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {isBetter ? '+' : ''}{deltaPercent}%
                </span>
              )}
              {isSame && (
                <span className="inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  <Minus className="w-3 h-3" />
                  Same
                </span>
              )}
            </div>
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
);