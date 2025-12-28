import { useMemo } from "react";
import { Trade } from "@/types/trading";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell, ReferenceLine } from "recharts";

interface RMultipleDistributionProps {
  trades: Trade[];
}

export function RMultipleDistribution({ trades }: RMultipleDistributionProps) {
  const data = useMemo(() => {
    const closedTrades = trades.filter(
      t => !t.is_open && t.r_multiple_actual !== null
    );

    // Create buckets from -3R to +4R
    const buckets: { range: string; count: number; min: number; max: number }[] = [
      { range: "< -2R", count: 0, min: -Infinity, max: -2 },
      { range: "-2R to -1R", count: 0, min: -2, max: -1 },
      { range: "-1R to 0", count: 0, min: -1, max: 0 },
      { range: "0 to 1R", count: 0, min: 0, max: 1 },
      { range: "1R to 2R", count: 0, min: 1, max: 2 },
      { range: "2R to 3R", count: 0, min: 2, max: 3 },
      { range: "> 3R", count: 0, min: 3, max: Infinity },
    ];

    closedTrades.forEach(trade => {
      const r = trade.r_multiple_actual!;
      for (const bucket of buckets) {
        if (r > bucket.min && r <= bucket.max) {
          bucket.count++;
          break;
        }
      }
    });

    return buckets;
  }, [trades]);

  const maxCount = Math.max(...data.map(d => d.count));

  if (data.every(d => d.count === 0)) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/80 backdrop-blur-xl p-6"
        style={{
          boxShadow: "0 0 0 1px hsl(0 0% 100% / 0.05), 0 8px 32px -8px hsl(0 0% 0% / 0.5)"
        }}
      >
        <h3 className="text-lg font-semibold text-foreground">R-Multiple Distribution</h3>
        <p className="text-sm text-muted-foreground mt-1">No trades with R-multiple data yet</p>
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
        <h3 className="text-lg font-semibold text-foreground">R-Multiple Distribution</h3>
        <p className="text-sm text-muted-foreground">Risk/reward outcome distribution</p>
      </div>
      <div className="px-2 pb-4">
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
              <XAxis 
                dataKey="range" 
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(0, 0%, 55%)", fontSize: 10 }}
                angle={-30}
                textAnchor="end"
                height={50}
              />
              <YAxis 
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(0, 0%, 55%)", fontSize: 11 }}
                width={30}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(0, 0%, 6%)",
                  border: "1px solid hsl(0, 0%, 15%)",
                  borderRadius: "12px",
                  boxShadow: "0 8px 32px -8px hsl(0 0% 0% / 0.6)",
                  padding: "12px 16px",
                }}
                formatter={(value: number) => [
                  <span className="font-semibold">{value} trades</span>,
                  "Count"
                ]}
                labelStyle={{ color: "hsl(0, 0%, 95%)", fontWeight: 600, marginBottom: 4 }}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {data.map((entry, index) => {
                  const isNegative = entry.max <= 0;
                  return (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={isNegative ? "hsl(0, 85%, 58%)" : "hsl(152, 95%, 45%)"}
                      style={{
                        filter: `drop-shadow(0 0 6px ${isNegative ? "hsl(0, 85%, 58%, 0.4)" : "hsl(152, 95%, 45%, 0.4)"})`
                      }}
                    />
                  );
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
