import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import type { TradeRecord } from "./BacktestMetricsGrid";

interface TradeDistributionChartsProps {
  trades: TradeRecord[];
  oosStartIdx?: number;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const chartTooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "6px",
  fontSize: "12px",
};

function statsFor(trades: TradeRecord[]) {
  if (trades.length === 0) {
    return { netPnl: 0, profitFactor: 0, sharpe: 0, maxDdPct: 0, winRate: 0, count: 0 };
  }
  const wins = trades.filter((t) => t.profit > 0);
  const losses = trades.filter((t) => t.profit < 0);
  const netPnl = trades.reduce((s, t) => s + t.profit, 0);
  const grossW = wins.reduce((s, t) => s + t.profit, 0);
  const grossL = Math.abs(losses.reduce((s, t) => s + t.profit, 0));
  const profitFactor = grossL > 0 ? grossW / grossL : grossW > 0 ? Infinity : 0;
  const winRate = (wins.length / trades.length) * 100;

  const startBal = trades[0].balance - trades[0].profit;
  const returns = trades.map((t, i) => {
    const prev = i > 0 ? trades[i - 1].balance : startBal;
    return prev > 0 ? t.profit / prev : 0;
  });
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const sd = Math.sqrt(variance);
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(252) : 0;

  let peak = startBal;
  let maxDdPct = 0;
  for (const t of trades) {
    if (t.balance > peak) peak = t.balance;
    const ddPct = peak > 0 ? ((peak - t.balance) / peak) * 100 : 0;
    if (ddPct > maxDdPct) maxDdPct = ddPct;
  }

  return { netPnl, profitFactor, sharpe, maxDdPct, winRate, count: trades.length };
}

export function TradeDistributionCharts({ trades, oosStartIdx }: TradeDistributionChartsProps) {
  const isSplit = oosStartIdx != null && oosStartIdx > 0 && oosStartIdx < trades.length;
  const isTrades = useMemo(() => (isSplit ? trades.slice(0, oosStartIdx!) : []), [trades, oosStartIdx, isSplit]);
  const oosTrades = useMemo(() => (isSplit ? trades.slice(oosStartIdx!) : []), [trades, oosStartIdx, isSplit]);

  const isStats = useMemo(() => statsFor(isTrades), [isTrades]);
  const oosStats = useMemo(() => statsFor(oosTrades), [oosTrades]);

  // Monthly returns heatmap data
  const monthlyData = useMemo(() => {
    const map = new Map<string, { year: number; month: number; pnl: number; trades: number }>();
    for (const t of trades) {
      if (!t.date) continue;
      const d = new Date(t.date);
      if (isNaN(d.getTime())) continue;
      const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
      const existing = map.get(key) || {
        year: d.getUTCFullYear(),
        month: d.getUTCMonth(),
        pnl: 0,
        trades: 0,
      };
      existing.pnl += t.profit;
      existing.trades += 1;
      map.set(key, existing);
    }
    const arr = Array.from(map.values()).sort(
      (a, b) => (a.year - b.year) * 100 + (a.month - b.month)
    );
    const years = Array.from(new Set(arr.map((m) => m.year))).sort();
    return { cells: arr, years };
  }, [trades]);

  if (trades.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Import a CSV trade log to view distributions
      </div>
    );
  }

  // Hour of day distribution
  const hourData = Array.from({ length: 24 }, (_, h) => {
    const hourTrades = trades.filter((t) => t.hour === h);
    const pnl = hourTrades.reduce((s, t) => s + t.profit, 0);
    return { hour: `${h.toString().padStart(2, "0")}:00`, pnl, total: hourTrades.length };
  }).filter((d) => d.total > 0);

  // Day of week distribution
  const dayData = Array.from({ length: 7 }, (_, d) => {
    const dayTrades = trades.filter((t) => t.dayOfWeek === d);
    const pnl = dayTrades.reduce((s, t) => s + t.profit, 0);
    return { day: DAYS[d], pnl, total: dayTrades.length };
  }).filter((d) => d.total > 0);

  // P&L histogram
  const profits = trades.map((t) => t.profit);
  const min = Math.min(...profits);
  const max = Math.max(...profits);
  const range = max - min || 1;
  const bucketSize = range / 20;
  const histogramData: { range: string; count: number; isPositive: boolean }[] = [];
  for (let i = 0; i < 20; i++) {
    const lo = min + i * bucketSize;
    const hi = lo + bucketSize;
    const count = profits.filter((p) => p >= lo && (i === 19 ? p <= hi : p < hi)).length;
    if (count > 0) {
      histogramData.push({
        range: `$${lo.toFixed(0)}`,
        count,
        isPositive: lo + bucketSize / 2 >= 0,
      });
    }
  }

  // IS vs OOS comparison data — normalised for plotting
  const compareData = isSplit
    ? [
        { metric: "Net P&L", IS: isStats.netPnl, OOS: oosStats.netPnl },
        { metric: "Profit Factor", IS: isFinite(isStats.profitFactor) ? isStats.profitFactor : 0, OOS: isFinite(oosStats.profitFactor) ? oosStats.profitFactor : 0 },
        { metric: "Sharpe", IS: isStats.sharpe, OOS: oosStats.sharpe },
        { metric: "Max DD %", IS: isStats.maxDdPct, OOS: oosStats.maxDdPct },
        { metric: "Win %", IS: isStats.winRate, OOS: oosStats.winRate },
      ]
    : [];

  // Heatmap color
  const maxAbsMonthly = Math.max(
    1,
    ...monthlyData.cells.map((c) => Math.abs(c.pnl))
  );
  const cellColor = (pnl: number) => {
    const intensity = Math.min(1, Math.abs(pnl) / maxAbsMonthly);
    const alpha = 0.15 + intensity * 0.6;
    return pnl >= 0
      ? `hsl(var(--profit) / ${alpha})`
      : `hsl(var(--destructive) / ${alpha})`;
  };

  return (
    <div className="space-y-6">
      {/* IS vs OOS comparison */}
      {isSplit && (
        <Card>
          <CardContent className="pt-3 pb-3 px-4 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                IS vs OOS — {isStats.count} in-sample · {oosStats.count} out-of-sample
              </h4>
              <span className="text-[10px] text-muted-foreground">
                Edge holds when OOS bars match or exceed IS
              </span>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={compareData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="metric" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  formatter={(v: number) => v.toFixed(2)}
                />
                <Bar dataKey="IS" fill="hsl(var(--muted-foreground))" radius={[2, 2, 0, 0]} />
                <Bar dataKey="OOS" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly returns heatmap */}
        <div className="lg:col-span-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Monthly Returns
          </h4>
          {monthlyData.cells.length === 0 ? (
            <div className="text-xs text-muted-foreground py-8 text-center">
              CSV did not include valid trade dates — monthly view unavailable.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="text-[10px] border-collapse">
                <thead>
                  <tr>
                    <th className="px-2 py-1 text-left text-muted-foreground font-medium">Year</th>
                    {MONTHS.map((m) => (
                      <th key={m} className="px-1.5 py-1 text-center text-muted-foreground font-medium">
                        {m}
                      </th>
                    ))}
                    <th className="px-2 py-1 text-right text-muted-foreground font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyData.years.map((y) => {
                    const yearCells = monthlyData.cells.filter((c) => c.year === y);
                    const yearTotal = yearCells.reduce((s, c) => s + c.pnl, 0);
                    return (
                      <tr key={y}>
                        <td className="px-2 py-1 font-medium">{y}</td>
                        {MONTHS.map((_, mi) => {
                          const cell = yearCells.find((c) => c.month === mi);
                          if (!cell) {
                            return (
                              <td key={mi} className="px-1.5 py-1 text-center text-muted-foreground/30">
                                ·
                              </td>
                            );
                          }
                          return (
                            <td
                              key={mi}
                              className="px-1.5 py-1 text-center font-mono"
                              style={{ backgroundColor: cellColor(cell.pnl) }}
                              title={`${cell.trades} trades · $${cell.pnl.toFixed(2)}`}
                            >
                              {cell.pnl >= 0 ? "+" : ""}
                              {cell.pnl.toFixed(0)}
                            </td>
                          );
                        })}
                        <td
                          className={`px-2 py-1 text-right font-mono font-semibold ${
                            yearTotal >= 0 ? "text-profit" : "text-destructive"
                          }`}
                        >
                          {yearTotal >= 0 ? "+" : ""}
                          {yearTotal.toFixed(0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Hour of Day */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            P&L by Hour of Day
          </h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={hourData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
              <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => [`$${v.toFixed(2)}`, "P&L"]} />
              <Bar dataKey="pnl" radius={[2, 2, 0, 0]}>
                {hourData.map((d, i) => (
                  <Cell key={i} fill={d.pnl >= 0 ? "hsl(var(--profit))" : "hsl(var(--destructive))"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Day of Week */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            P&L by Day of Week
          </h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dayData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="day" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
              <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => [`$${v.toFixed(2)}`, "P&L"]} />
              <Bar dataKey="pnl" radius={[2, 2, 0, 0]}>
                {dayData.map((d, i) => (
                  <Cell key={i} fill={d.pnl >= 0 ? "hsl(var(--profit))" : "hsl(var(--destructive))"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* P&L Histogram */}
        <div className="lg:col-span-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            P&L Distribution
          </h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={histogramData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="range" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={chartTooltipStyle} />
              <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                {histogramData.map((d, i) => (
                  <Cell key={i} fill={d.isPositive ? "hsl(var(--profit))" : "hsl(var(--destructive))"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
