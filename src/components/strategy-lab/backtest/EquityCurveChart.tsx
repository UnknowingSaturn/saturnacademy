import { useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Brush,
  ReferenceDot,
} from "recharts";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { TradeRecord } from "./BacktestMetricsGrid";

interface EquityCurveChartProps {
  trades: TradeRecord[];
}

export function EquityCurveChart({ trades }: EquityCurveChartProps) {
  const [showDrawdown, setShowDrawdown] = useState(true);
  const [showMarkers, setShowMarkers] = useState(false);

  if (trades.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Import a CSV trade log to view the equity curve
      </div>
    );
  }

  // Build chart data
  let peak = trades[0]?.balance ?? 0;
  const data = trades.map((t, i) => {
    if (t.balance > peak) peak = t.balance;
    const drawdown = peak - t.balance;
    const drawdownPct = peak > 0 ? (drawdown / peak) * 100 : 0;
    return {
      idx: i + 1,
      balance: t.balance,
      drawdown: -drawdownPct,
      profit: t.profit,
      date: t.date,
    };
  });

  const losers = showMarkers ? data.filter((d) => d.profit < 0) : [];
  const winners = showMarkers ? data.filter((d) => d.profit > 0) : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Switch id="dd-toggle" checked={showDrawdown} onCheckedChange={setShowDrawdown} />
          <Label htmlFor="dd-toggle" className="text-xs">Drawdown overlay</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="marker-toggle" checked={showMarkers} onCheckedChange={setShowMarkers} />
          <Label htmlFor="marker-toggle" className="text-xs">Trade markers</Label>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={320}>
        <AreaChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
          <XAxis
            dataKey="idx"
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            yAxisId="balance"
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `$${v.toLocaleString()}`}
          />
          {showDrawdown && (
            <YAxis
              yAxisId="dd"
              orientation="right"
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${v.toFixed(0)}%`}
            />
          )}
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "6px",
              fontSize: "12px",
            }}
            labelFormatter={(v) => `Trade #${v}`}
            formatter={(value: number, name: string) => {
              if (name === "balance") return [`$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, "Balance"];
              if (name === "drawdown") return [`${value.toFixed(1)}%`, "Drawdown"];
              return [value, name];
            }}
          />
          <Area
            yAxisId="balance"
            type="monotone"
            dataKey="balance"
            stroke="hsl(var(--primary))"
            fill="hsl(var(--primary))"
            fillOpacity={0.1}
            strokeWidth={1.5}
          />
          {showDrawdown && (
            <Area
              yAxisId="dd"
              type="monotone"
              dataKey="drawdown"
              stroke="hsl(var(--destructive))"
              fill="hsl(var(--destructive))"
              fillOpacity={0.15}
              strokeWidth={1}
            />
          )}
          {winners.map((w) => (
            <ReferenceDot
              key={`w-${w.idx}`}
              yAxisId="balance"
              x={w.idx}
              y={w.balance}
              r={2}
              fill="hsl(142 76% 36%)"
              stroke="none"
            />
          ))}
          {losers.map((l) => (
            <ReferenceDot
              key={`l-${l.idx}`}
              yAxisId="balance"
              x={l.idx}
              y={l.balance}
              r={2}
              fill="hsl(var(--destructive))"
              stroke="none"
            />
          ))}
          <Brush
            dataKey="idx"
            height={20}
            stroke="hsl(var(--border))"
            fill="hsl(var(--card))"
            travellerWidth={8}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
