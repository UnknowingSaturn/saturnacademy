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
import type { TradeRecord } from "./BacktestMetricsGrid";

interface TradeDistributionChartsProps {
  trades: TradeRecord[];
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const chartTooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "6px",
  fontSize: "12px",
};

export function TradeDistributionCharts({ trades }: TradeDistributionChartsProps) {
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
    const wins = hourTrades.filter((t) => t.profit > 0).length;
    const losses = hourTrades.filter((t) => t.profit <= 0).length;
    const pnl = hourTrades.reduce((s, t) => s + t.profit, 0);
    return { hour: `${h.toString().padStart(2, "0")}:00`, wins, losses, pnl, total: hourTrades.length };
  }).filter((d) => d.total > 0);

  // Day of week distribution
  const dayData = Array.from({ length: 7 }, (_, d) => {
    const dayTrades = trades.filter((t) => t.dayOfWeek === d);
    const wins = dayTrades.filter((t) => t.profit > 0).length;
    const losses = dayTrades.filter((t) => t.profit <= 0).length;
    const pnl = dayTrades.reduce((s, t) => s + t.profit, 0);
    return { day: DAYS[d], wins, losses, pnl, total: dayTrades.length };
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

  // Consecutive wins/losses
  const streaks: { type: "Win" | "Loss"; length: number }[] = [];
  let currentStreak = 0;
  let currentType: "Win" | "Loss" | null = null;
  for (const t of trades) {
    const type = t.profit > 0 ? "Win" : "Loss";
    if (type === currentType) {
      currentStreak++;
    } else {
      if (currentType) streaks.push({ type: currentType, length: currentStreak });
      currentType = type;
      currentStreak = 1;
    }
  }
  if (currentType) streaks.push({ type: currentType, length: currentStreak });

  const streakData = streaks.slice(-30).map((s, i) => ({
    idx: i + 1,
    length: s.type === "Win" ? s.length : -s.length,
    type: s.type,
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                <Cell key={i} fill={d.pnl >= 0 ? "hsl(142 76% 36%)" : "hsl(var(--destructive))"} />
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
                <Cell key={i} fill={d.pnl >= 0 ? "hsl(142 76% 36%)" : "hsl(var(--destructive))"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* P&L Histogram */}
      <div>
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
                <Cell key={i} fill={d.isPositive ? "hsl(142 76% 36%)" : "hsl(var(--destructive))"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Consecutive Streaks */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Win/Loss Streaks (Last 30)
        </h4>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={streakData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
            <XAxis dataKey="idx" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => [Math.abs(v), v > 0 ? "Win streak" : "Loss streak"]} />
            <Bar dataKey="length" radius={[2, 2, 0, 0]}>
              {streakData.map((d, i) => (
                <Cell key={i} fill={d.type === "Win" ? "hsl(142 76% 36%)" : "hsl(var(--destructive))"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
