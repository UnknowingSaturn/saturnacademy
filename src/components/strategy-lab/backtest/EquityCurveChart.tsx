import { useMemo, useState } from "react";
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Brush,
  ReferenceLine,
  ReferenceDot,
} from "recharts";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { TradeRecord } from "./BacktestMetricsGrid";

interface EquityCurveChartProps {
  trades: TradeRecord[];
  oosStartIdx?: number;
}

function rollingSharpe(returns: number[], window: number): (number | null)[] {
  const out: (number | null)[] = new Array(returns.length).fill(null);
  for (let i = window - 1; i < returns.length; i++) {
    const slice = returns.slice(i - window + 1, i + 1);
    const mean = slice.reduce((s, r) => s + r, 0) / window;
    const variance = slice.reduce((s, r) => s + (r - mean) ** 2, 0) / window;
    const sd = Math.sqrt(variance);
    out[i] = sd > 0 ? (mean / sd) * Math.sqrt(252) : 0;
  }
  return out;
}

export function EquityCurveChart({ trades, oosStartIdx }: EquityCurveChartProps) {
  const [showDrawdown, setShowDrawdown] = useState(true);
  const [highlightWorstDD, setHighlightWorstDD] = useState(false);
  const [useDateAxis, setUseDateAxis] = useState(true);

  const hasDates = useMemo(
    () => trades.some((t) => t.date && !isNaN(new Date(t.date).getTime())),
    [trades]
  );

  const { data, worstDDs, rollingSharpeData } = useMemo(() => {
    if (trades.length === 0) {
      return { data: [], worstDDs: [], rollingSharpeData: [] };
    }
    let peak = trades[0].balance;
    const startBalance = trades[0].balance - trades[0].profit;
    const data = trades.map((t, i) => {
      if (t.balance > peak) peak = t.balance;
      const drawdown = peak - t.balance;
      const drawdownPct = peak > 0 ? (drawdown / peak) * 100 : 0;
      return {
        idx: i + 1,
        balance: t.balance,
        drawdown: -drawdownPct,
        drawdownPctValue: drawdownPct,
        profit: t.profit,
        date: t.date,
        timestamp: t.date && !isNaN(new Date(t.date).getTime()) ? new Date(t.date).getTime() : i,
      };
    });

    // Identify top-5 trough drawdowns (local maxima of drawdownPctValue)
    const candidates = data
      .map((d, i) => ({ ...d, i }))
      .sort((a, b) => b.drawdownPctValue - a.drawdownPctValue);
    const worst: typeof candidates = [];
    const usedRanges: number[] = [];
    for (const c of candidates) {
      if (worst.length >= 5) break;
      if (c.drawdownPctValue < 0.1) break;
      if (usedRanges.some((r) => Math.abs(r - c.i) < Math.max(5, data.length * 0.03))) continue;
      worst.push(c);
      usedRanges.push(c.i);
    }

    // Rolling Sharpe (per-trade returns)
    const returns = trades.map((t, i) => {
      const prev = i > 0 ? trades[i - 1].balance : startBalance;
      return prev > 0 ? t.profit / prev : 0;
    });
    const window = Math.min(60, Math.max(15, Math.floor(trades.length / 10)));
    const rs = rollingSharpe(returns, window);
    const rollingSharpeData = data.map((d, i) => ({
      idx: d.idx,
      timestamp: d.timestamp,
      sharpe: rs[i],
    }));

    return { data, worstDDs: worst, rollingSharpeData };
  }, [trades]);

  if (trades.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Import a CSV trade log to view the equity curve
      </div>
    );
  }

  const xKey = hasDates && useDateAxis ? "timestamp" : "idx";
  const splitXValue =
    oosStartIdx != null && oosStartIdx < data.length
      ? hasDates && useDateAxis
        ? data[oosStartIdx].timestamp
        : data[oosStartIdx].idx
      : undefined;

  const formatX = (v: number) => {
    if (hasDates && useDateAxis) {
      const d = new Date(v);
      return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
    }
    return `#${v}`;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Switch id="dd-toggle" checked={showDrawdown} onCheckedChange={setShowDrawdown} />
          <Label htmlFor="dd-toggle" className="text-xs">Drawdown overlay</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="worst-dd-toggle" checked={highlightWorstDD} onCheckedChange={setHighlightWorstDD} />
          <Label htmlFor="worst-dd-toggle" className="text-xs">Highlight worst 5 drawdowns</Label>
        </div>
        {hasDates && (
          <div className="flex items-center gap-2">
            <Switch id="date-axis-toggle" checked={useDateAxis} onCheckedChange={setUseDateAxis} />
            <Label htmlFor="date-axis-toggle" className="text-xs">Date axis</Label>
          </div>
        )}
        {splitXValue !== undefined && (
          <span className="text-[11px] text-muted-foreground ml-auto">
            IS / OOS split @ trade #{(oosStartIdx ?? 0) + 1}
            {hasDates && useDateAxis && data[oosStartIdx!]?.date
              ? ` (${new Date(data[oosStartIdx!].date).toISOString().slice(0, 10)})`
              : ""}
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
          <XAxis
            dataKey={xKey}
            type={hasDates && useDateAxis ? "number" : "category"}
            domain={hasDates && useDateAxis ? ["dataMin", "dataMax"] : undefined}
            scale={hasDates && useDateAxis ? "time" : undefined}
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={formatX}
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
            labelFormatter={(v) => formatX(v as number)}
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
          {splitXValue !== undefined && (
            <ReferenceLine
              x={splitXValue}
              yAxisId="balance"
              stroke="hsl(var(--foreground))"
              strokeDasharray="4 4"
              strokeOpacity={0.6}
              label={{ value: "OOS →", position: "insideTopRight", fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            />
          )}
          {highlightWorstDD &&
            worstDDs.map((w) => (
              <ReferenceDot
                key={`dd-${w.i}`}
                yAxisId="balance"
                x={hasDates && useDateAxis ? w.timestamp : w.idx}
                y={w.balance}
                r={5}
                fill="hsl(var(--destructive))"
                stroke="hsl(var(--card))"
                strokeWidth={2}
              />
            ))}
          <Brush
            dataKey={xKey}
            height={20}
            stroke="hsl(var(--border))"
            fill="hsl(var(--card))"
            travellerWidth={8}
            tickFormatter={formatX}
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Rolling Sharpe */}
      <div>
        <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
          Rolling Sharpe (window auto-sized to dataset)
        </h4>
        <ResponsiveContainer width="100%" height={100}>
          <ComposedChart data={rollingSharpeData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
            <XAxis
              dataKey={xKey}
              type={hasDates && useDateAxis ? "number" : "category"}
              domain={hasDates && useDateAxis ? ["dataMin", "dataMax"] : undefined}
              scale={hasDates && useDateAxis ? "time" : undefined}
              tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={formatX}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => v.toFixed(1)}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "6px",
                fontSize: "11px",
              }}
              labelFormatter={(v) => formatX(v as number)}
              formatter={(value: number) => [value?.toFixed(2) ?? "—", "Rolling Sharpe"]}
            />
            <ReferenceLine y={0} stroke="hsl(var(--border))" />
            {splitXValue !== undefined && (
              <ReferenceLine
                x={splitXValue}
                stroke="hsl(var(--foreground))"
                strokeDasharray="4 4"
                strokeOpacity={0.6}
              />
            )}
            <Line
              type="monotone"
              dataKey="sharpe"
              stroke="hsl(var(--primary))"
              strokeWidth={1.5}
              dot={false}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
