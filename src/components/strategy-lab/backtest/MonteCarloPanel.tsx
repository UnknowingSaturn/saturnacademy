import { useState, useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Shuffle, BarChart3, Shield, TrendingDown } from "lucide-react";
import type { TradeRecord } from "./BacktestMetricsGrid";

interface MonteCarloResult {
  chartData: Array<{ idx: number; p10: number; p50: number; p90: number; original: number }>;
  probabilityOfRuin: number;
  expectedMaxDD: { p10: number; p50: number; p90: number };
  medianFinalEquity: number;
  p10FinalEquity: number;
  p90FinalEquity: number;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function runSimulation(trades: TradeRecord[], iterations: number, ruinThreshold: number): MonteCarloResult {
  const profits = trades.map((t) => t.profit);
  const startBalance = trades.length > 0 ? trades[0].balance - trades[0].profit : 10000;
  const numTrades = profits.length;

  // Store final equities and max drawdowns for each path
  const allPaths: number[][] = [];
  const maxDDs: number[] = [];
  const finalEquities: number[] = [];
  let ruinCount = 0;

  for (let i = 0; i < iterations; i++) {
    const shuffled = shuffle(profits);
    const path: number[] = [startBalance];
    let peak = startBalance;
    let maxDD = 0;

    for (let j = 0; j < numTrades; j++) {
      const bal = path[j] + shuffled[j];
      path.push(bal);
      if (bal > peak) peak = bal;
      const dd = peak > 0 ? ((peak - bal) / peak) * 100 : 0;
      if (dd > maxDD) maxDD = dd;
    }

    allPaths.push(path);
    maxDDs.push(maxDD);
    finalEquities.push(path[numTrades]);
    if (maxDD > ruinThreshold) ruinCount++;
  }

  // Compute percentiles at each trade index
  const chartData: MonteCarloResult["chartData"] = [];
  // Original equity path
  const originalPath = [startBalance];
  for (let j = 0; j < numTrades; j++) {
    originalPath.push(originalPath[j] + profits[j]);
  }

  // Sample every Nth point for performance
  const step = Math.max(1, Math.floor(numTrades / 100));
  for (let j = 0; j <= numTrades; j += step) {
    const vals = allPaths.map((p) => p[j]).sort((a, b) => a - b);
    chartData.push({
      idx: j,
      p10: vals[Math.floor(iterations * 0.1)],
      p50: vals[Math.floor(iterations * 0.5)],
      p90: vals[Math.floor(iterations * 0.9)],
      original: originalPath[j],
    });
  }
  // Ensure last point is included
  if (chartData[chartData.length - 1]?.idx !== numTrades) {
    const vals = allPaths.map((p) => p[numTrades]).sort((a, b) => a - b);
    chartData.push({
      idx: numTrades,
      p10: vals[Math.floor(iterations * 0.1)],
      p50: vals[Math.floor(iterations * 0.5)],
      p90: vals[Math.floor(iterations * 0.9)],
      original: originalPath[numTrades],
    });
  }

  maxDDs.sort((a, b) => a - b);
  finalEquities.sort((a, b) => a - b);

  return {
    chartData,
    probabilityOfRuin: (ruinCount / iterations) * 100,
    expectedMaxDD: {
      p10: maxDDs[Math.floor(iterations * 0.1)],
      p50: maxDDs[Math.floor(iterations * 0.5)],
      p90: maxDDs[Math.floor(iterations * 0.9)],
    },
    medianFinalEquity: finalEquities[Math.floor(iterations * 0.5)],
    p10FinalEquity: finalEquities[Math.floor(iterations * 0.1)],
    p90FinalEquity: finalEquities[Math.floor(iterations * 0.9)],
  };
}

interface MonteCarloProps {
  trades: TradeRecord[];
}

export function MonteCarloPanel({ trades }: MonteCarloProps) {
  const [result, setResult] = useState<MonteCarloResult | null>(null);
  const [running, setRunning] = useState(false);

  const canRun = trades.length >= 10;

  const handleRun = () => {
    setRunning(true);
    // Use setTimeout to avoid blocking UI
    setTimeout(() => {
      const r = runSimulation(trades, 1000, 20);
      setResult(r);
      setRunning(false);
    }, 50);
  };

  if (!canRun) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Need at least 10 trades to run Monte Carlo simulation. Import a CSV trade log first.
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Shuffle className="h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground text-center max-w-sm">
          Monte Carlo simulation reshuffles your {trades.length} trades 1,000 times to test if results
          survive different trade sequencing.
        </p>
        <Button onClick={handleRun} disabled={running}>
          {running ? "Simulating..." : "Run Monte Carlo (1,000 paths)"}
        </Button>
      </div>
    );
  }

  const fmt = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });

  const statCards = [
    {
      label: "Probability of Ruin",
      value: `${result.probabilityOfRuin.toFixed(1)}%`,
      desc: "DD > 20% in any path",
      icon: Shield,
      color: result.probabilityOfRuin < 10 ? "text-green-500" : result.probabilityOfRuin < 30 ? "text-amber-500" : "text-red-500",
    },
    {
      label: "Median Final Equity",
      value: `$${fmt(result.medianFinalEquity)}`,
      desc: "50th percentile outcome",
      icon: BarChart3,
      color: "text-primary",
    },
    {
      label: "Worst Case (P10)",
      value: `$${fmt(result.p10FinalEquity)}`,
      desc: "10th percentile final equity",
      icon: TrendingDown,
      color: "text-amber-500",
    },
    {
      label: "Expected Max DD",
      value: `${result.expectedMaxDD.p50.toFixed(1)}%`,
      desc: `Range: ${result.expectedMaxDD.p10.toFixed(1)}% – ${result.expectedMaxDD.p90.toFixed(1)}%`,
      icon: TrendingDown,
      color: result.expectedMaxDD.p50 < 15 ? "text-green-500" : result.expectedMaxDD.p50 < 25 ? "text-amber-500" : "text-red-500",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Monte Carlo Simulation — 1,000 paths × {trades.length} trades
        </h4>
        <Button variant="outline" size="sm" className="text-xs" onClick={handleRun} disabled={running}>
          <Shuffle className="h-3 w-3 mr-1" />
          Re-run
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {statCards.map((s) => (
          <Card key={s.label} className="border-border/50">
            <CardContent className="pt-3 pb-2 px-3">
              <div className="flex items-center gap-2">
                <s.icon className={`h-4 w-4 shrink-0 ${s.color}`} />
                <div>
                  <p className="text-[10px] text-muted-foreground">{s.label}</p>
                  <p className={`text-sm font-mono font-semibold ${s.color}`}>{s.value}</p>
                  <p className="text-[9px] text-muted-foreground">{s.desc}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={result.chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
          <XAxis
            dataKey="idx"
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={false}
            label={{ value: "Trade #", position: "insideBottomRight", offset: -5, fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "6px",
              fontSize: "12px",
            }}
            formatter={(v: number, name: string) => [`$${fmt(v)}`, name === "p10" ? "P10 (worst)" : name === "p50" ? "P50 (median)" : name === "p90" ? "P90 (best)" : "Original"]}
          />
          <Area type="monotone" dataKey="p90" stroke="none" fill="hsl(142 76% 36%)" fillOpacity={0.1} />
          <Area type="monotone" dataKey="p50" stroke="none" fill="hsl(var(--primary))" fillOpacity={0.15} />
          <Area type="monotone" dataKey="p10" stroke="none" fill="hsl(var(--destructive))" fillOpacity={0.1} />
          <Area type="monotone" dataKey="p90" stroke="hsl(142 76% 36%)" strokeWidth={1} fill="none" strokeDasharray="4 2" />
          <Area type="monotone" dataKey="p50" stroke="hsl(var(--primary))" strokeWidth={1.5} fill="none" />
          <Area type="monotone" dataKey="p10" stroke="hsl(var(--destructive))" strokeWidth={1} fill="none" strokeDasharray="4 2" />
          <Area type="monotone" dataKey="original" stroke="hsl(var(--foreground))" strokeWidth={1.5} fill="none" strokeDasharray="2 2" />
        </AreaChart>
      </ResponsiveContainer>

      <div className="flex items-center gap-4 text-[10px] text-muted-foreground justify-center">
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-green-500 inline-block" /> P90 (best)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-primary inline-block" /> P50 (median)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-destructive inline-block" /> P10 (worst)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-foreground inline-block" style={{ borderTop: "1px dashed" }} /> Original</span>
      </div>
    </div>
  );
}
