import { useMemo, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Shuffle, BarChart3, Shield, TrendingDown } from "lucide-react";
import type { TradeRecord } from "./BacktestMetricsGrid";

type Method = "iid" | "block";

interface MonteCarloResult {
  chartData: Array<{ idx: number; p10: number; p50: number; p90: number; original: number }>;
  probabilityOfRuin: number;
  expectedMaxDD: { p10: number; p50: number; p90: number };
  medianFinalEquity: number;
  p10FinalEquity: number;
  p90FinalEquity: number;
  paths: number;
}

function shuffleIID<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function shuffleBlocks<T>(arr: T[], blockSize: number): T[] {
  if (blockSize <= 1) return shuffleIID(arr);
  const n = arr.length;
  const out: T[] = [];
  while (out.length < n) {
    const start = Math.floor(Math.random() * Math.max(1, n - blockSize + 1));
    for (let k = 0; k < blockSize && out.length < n; k++) {
      out.push(arr[start + k]);
    }
  }
  return out;
}

function runSimulation(
  trades: TradeRecord[],
  iterations: number,
  ruinThreshold: number,
  method: Method,
  blockSize: number
): MonteCarloResult {
  const profits = trades.map((t) => t.profit);
  const startBalance = trades.length > 0 ? trades[0].balance - trades[0].profit : 10000;
  const numTrades = profits.length;

  const allPaths: number[][] = [];
  const maxDDs: number[] = [];
  const finalEquities: number[] = [];
  let ruinCount = 0;

  for (let i = 0; i < iterations; i++) {
    const shuffled =
      method === "block" ? shuffleBlocks(profits, blockSize) : shuffleIID(profits);
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

  const chartData: MonteCarloResult["chartData"] = [];
  const originalPath = [startBalance];
  for (let j = 0; j < numTrades; j++) {
    originalPath.push(originalPath[j] + profits[j]);
  }

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
    paths: iterations,
  };
}

interface MonteCarloProps {
  trades: TradeRecord[];
  oosStartIdx?: number;
}

export function MonteCarloPanel({ trades, oosStartIdx }: MonteCarloProps) {
  const [result, setResult] = useState<MonteCarloResult | null>(null);
  const [running, setRunning] = useState(false);
  const [method, setMethod] = useState<Method>("block");
  const [blockSize, setBlockSize] = useState(5);
  const [ruinThreshold, setRuinThreshold] = useState(20);

  const hasOos = oosStartIdx != null && oosStartIdx > 0 && oosStartIdx < trades.length;
  const [oosOnly, setOosOnly] = useState(true);

  const activeTrades = useMemo(
    () => (oosOnly && hasOos ? trades.slice(oosStartIdx!) : trades),
    [trades, oosOnly, hasOos, oosStartIdx]
  );

  const canRun = activeTrades.length >= 10;

  const handleRun = () => {
    setRunning(true);
    setTimeout(() => {
      const r = runSimulation(activeTrades, 1000, ruinThreshold, method, blockSize);
      setResult(r);
      setRunning(false);
    }, 50);
  };

  if (!canRun) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Need at least 10 trades to run Monte Carlo simulation.
      </div>
    );
  }

  const fmt = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card>
        <CardContent className="pt-3 pb-3 px-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Resample method</Label>
              <RadioGroup
                value={method}
                onValueChange={(v) => setMethod(v as Method)}
                className="flex gap-3"
              >
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="iid" id="mc-iid" />
                  <Label htmlFor="mc-iid" className="text-xs cursor-pointer">IID shuffle</Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="block" id="mc-block" />
                  <Label htmlFor="mc-block" className="text-xs cursor-pointer" title="Preserves local trade clustering — more honest for walk-forward">
                    Block bootstrap
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Block size</Label>
              <Input
                type="number"
                min={1}
                max={50}
                value={blockSize}
                onChange={(e) => setBlockSize(Math.max(1, Math.min(50, parseInt(e.target.value || "1", 10))))}
                disabled={method !== "block"}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Ruin threshold (DD %)</Label>
              <Input
                type="number"
                min={5}
                max={90}
                value={ruinThreshold}
                onChange={(e) => setRuinThreshold(Math.max(1, Math.min(99, parseInt(e.target.value || "20", 10))))}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              {hasOos && (
                <div className="flex items-center gap-2 h-8">
                  <Switch id="oos-only" checked={oosOnly} onCheckedChange={setOosOnly} />
                  <Label htmlFor="oos-only" className="text-xs cursor-pointer">
                    OOS slice only ({activeTrades.length} trades)
                  </Label>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={handleRun} disabled={running} size="sm">
              <Shuffle className="h-3.5 w-3.5 mr-1.5" />
              {running ? "Simulating…" : result ? "Re-run (1,000 paths)" : "Run Monte Carlo"}
            </Button>
            <span className="text-[11px] text-muted-foreground">
              {method === "block"
                ? `Block bootstrap preserves order within ${blockSize}-trade chunks (better for autocorrelated edges).`
                : "IID shuffle assumes trade order is irrelevant — useful as a stress test."}
            </span>
          </div>
        </CardContent>
      </Card>

      {!result ? (
        <div className="flex flex-col items-center justify-center h-48 gap-3 text-center text-muted-foreground">
          <Shuffle className="h-8 w-8" />
          <p className="text-sm max-w-sm">
            Run the simulation to stress-test the equity curve against random trade orderings.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {[
              {
                label: "Probability of Ruin",
                value: `${result.probabilityOfRuin.toFixed(1)}%`,
                desc: `DD > ${ruinThreshold}% in any path`,
                icon: Shield,
                color:
                  result.probabilityOfRuin < 10
                    ? "text-profit"
                    : result.probabilityOfRuin < 30
                    ? "text-amber-500"
                    : "text-destructive",
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
                color:
                  result.expectedMaxDD.p50 < 15
                    ? "text-profit"
                    : result.expectedMaxDD.p50 < 25
                    ? "text-amber-500"
                    : "text-destructive",
              },
            ].map((s) => (
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
                label={{
                  value: "Trade #",
                  position: "insideBottomRight",
                  offset: -5,
                  fontSize: 10,
                  fill: "hsl(var(--muted-foreground))",
                }}
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
                formatter={(v: number, name: string) => [
                  `$${fmt(v)}`,
                  name === "p10"
                    ? "P10 (worst)"
                    : name === "p50"
                    ? "P50 (median)"
                    : name === "p90"
                    ? "P90 (best)"
                    : "Original",
                ]}
              />
              <Area type="monotone" dataKey="p90" stroke="none" fill="hsl(var(--profit))" fillOpacity={0.1} />
              <Area type="monotone" dataKey="p50" stroke="none" fill="hsl(var(--primary))" fillOpacity={0.15} />
              <Area type="monotone" dataKey="p10" stroke="none" fill="hsl(var(--destructive))" fillOpacity={0.1} />
              <Area type="monotone" dataKey="p90" stroke="hsl(var(--profit))" strokeWidth={1} fill="none" strokeDasharray="4 2" />
              <Area type="monotone" dataKey="p50" stroke="hsl(var(--primary))" strokeWidth={1.5} fill="none" />
              <Area type="monotone" dataKey="p10" stroke="hsl(var(--destructive))" strokeWidth={1} fill="none" strokeDasharray="4 2" />
              <Area type="monotone" dataKey="original" stroke="hsl(var(--foreground))" strokeWidth={1.5} fill="none" strokeDasharray="2 2" />
            </AreaChart>
          </ResponsiveContainer>

          <div className="flex items-center gap-4 text-[10px] text-muted-foreground justify-center flex-wrap">
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-profit inline-block" /> P90 (best)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-primary inline-block" /> P50 (median)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-destructive inline-block" /> P10 (worst)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-foreground inline-block" /> Original
            </span>
            <span>· {result.paths.toLocaleString()} paths × {activeTrades.length} trades</span>
          </div>
        </>
      )}
    </div>
  );
}
