import { useMemo } from "react";
import { Trade } from "@/types/trading";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from "recharts";

interface SymbolBreakdownProps {
  trades: Trade[];
}

export function SymbolBreakdown({ trades }: SymbolBreakdownProps) {
  const data = useMemo(() => {
    const closedTrades = trades.filter(t => !t.is_open && t.net_pnl !== null);
    
    const symbolMap: Record<string, { pnl: number; trades: number; wins: number }> = {};

    closedTrades.forEach(trade => {
      const symbol = trade.symbol;
      if (!symbolMap[symbol]) {
        symbolMap[symbol] = { pnl: 0, trades: 0, wins: 0 };
      }
      symbolMap[symbol].pnl += trade.net_pnl || 0;
      symbolMap[symbol].trades += 1;
      if ((trade.net_pnl || 0) > 0) {
        symbolMap[symbol].wins += 1;
      }
    });

    return Object.entries(symbolMap)
      .map(([symbol, stats]) => ({
        symbol,
        pnl: stats.pnl,
        trades: stats.trades,
        wins: stats.wins,
        winRate: stats.trades > 0 ? (stats.wins / stats.trades) * 100 : 0,
      }))
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, 8); // Top 8 symbols
  }, [trades]);

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/80 backdrop-blur-xl p-6"
        style={{
          boxShadow: "0 0 0 1px hsl(0 0% 100% / 0.05), 0 8px 32px -8px hsl(0 0% 0% / 0.5)"
        }}
      >
        <h3 className="text-lg font-semibold text-foreground">Symbol Performance</h3>
        <p className="text-sm text-muted-foreground mt-1">No trades yet</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card/80 backdrop-blur-xl overflow-hidden"
      style={{
        boxShadow: "0 0 0 1px hsl(0 0% 100% / 0.05), 0 8px 32px -8px hsl(0 0% 0% / 0.5)"
      }}
    >
      <div className="p-6 pb-2">
        <h3 className="text-lg font-semibold text-foreground">Symbol Performance</h3>
        <p className="text-sm text-muted-foreground">P&L by trading instrument</p>
      </div>
      <div className="px-2 pb-4">
        <div className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 10, right: 20, left: 60, bottom: 5 }}>
              <XAxis 
                type="number"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(0, 0%, 55%)", fontSize: 11 }}
                tickFormatter={(value) => `$${value >= 0 ? '' : '-'}${Math.abs(value).toFixed(0)}`}
              />
              <YAxis 
                type="category"
                dataKey="symbol"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(0, 0%, 75%)", fontSize: 11, fontWeight: 500 }}
                width={55}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(0, 0%, 6%)",
                  border: "1px solid hsl(0, 0%, 15%)",
                  borderRadius: "12px",
                  boxShadow: "0 8px 32px -8px hsl(0 0% 0% / 0.6)",
                  padding: "12px 16px",
                }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const data = payload[0].payload;
                  return (
                    <div className="bg-popover border border-border rounded-xl p-4 shadow-glass">
                      <p className="font-semibold text-foreground mb-2">{data.symbol}</p>
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
              <Bar dataKey="pnl" radius={[0, 6, 6, 0]}>
                {data.map((entry, index) => (
                  <Cell 
                    key={`cell-${index}`} 
                    fill={entry.pnl >= 0 ? "hsl(152, 95%, 45%)" : "hsl(0, 85%, 58%)"}
                    style={{
                      filter: `drop-shadow(0 0 8px ${entry.pnl >= 0 ? "hsl(152, 95%, 45%, 0.4)" : "hsl(0, 85%, 58%, 0.4)"})`
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
