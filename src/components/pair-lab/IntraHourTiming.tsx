// ============================================================================
// Intra-Hour Timing — minute-of-hour heatmap for executed trades.
//
// Answers: "is the entry-window edge I found in backtest holding up live, or
// has it drifted to a different part of the hour?"
//
// X-axis: minute-of-hour buckets (configurable: 10/15/30-min granularity).
// Y-axis: symbol (resolved through user's symbol aliases).
// Cell:   mean R-multiple, win rate, N. Significance gate via meanRWithCI
//         (reused from the Strategy Lab edge gate) — cells whose 95% CI
//         brackets zero are shown but flagged as "not proven".
//
// Mode toggle compares executed-only vs missed-only vs all so the user can
// see whether the timing pattern they observed in backtest (`missed` trades
// are historically the backtest-tagged ones in this project) still applies
// to live execution.
//
// Minute-of-hour is timezone-invariant for whole-hour offsets — UTC minutes
// equal local minutes for every broker we support. Using UTC keeps the math
// independent of the user's clock and DST rolls.
// ============================================================================

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Clock, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Trade } from "@/types/trading";
import { meanRWithCI } from "@/lib/propFirmMonteCarlo";

type BucketGranularity = 10 | 15 | 30;
type ModeFilter = "all" | "executed" | "missed";

interface Props {
  trades: Trade[];
  symbolResolver: (raw: string) => string;
}

interface Cell {
  symbol: string;
  bucketStart: number;
  rSample: number[];
  wins: number;
  losses: number;
  meanR: number;
  ciLow: number;
  ciHigh: number;
  n: number;
}

const MODE_OPTIONS: { value: ModeFilter; label: string; hint: string }[] = [
  { value: "all", label: "All", hint: "executed + missed" },
  { value: "executed", label: "Live only", hint: "trade_type = executed" },
  { value: "missed", label: "Backtest only", hint: "trade_type = missed" },
];

const GRANULARITY_OPTIONS: BucketGranularity[] = [10, 15, 30];

const MIN_N_FOR_COLOR = 5;     // below this, cell is shown grey
const MIN_N_FOR_EDGE = 15;     // below this, "edge proven" never fires

function bucketLabel(start: number, width: number): string {
  const end = start + width - 1;
  return `:${String(start).padStart(2, "0")}–:${String(end).padStart(2, "0")}`;
}

function colorForMeanR(meanR: number, maxAbs: number): string {
  if (maxAbs <= 0) return "hsl(220 8% 50% / 0.06)";
  const ratio = Math.max(-1, Math.min(1, meanR / maxAbs));
  if (ratio >= 0) {
    // Emerald scale
    const alpha = 0.08 + ratio * 0.42;
    return `hsl(150 70% 45% / ${alpha})`;
  }
  // Red scale
  const alpha = 0.08 + Math.abs(ratio) * 0.42;
  return `hsl(0 75% 55% / ${alpha})`;
}

export function IntraHourTiming({ trades, symbolResolver }: Props) {
  const [granularity, setGranularity] = useState<BucketGranularity>(15);
  const [mode, setMode] = useState<ModeFilter>("all");
  const [symbolFilter, setSymbolFilter] = useState<string>("__all__");

  // Build (symbol, bucket) → R[] map from eligible trades.
  const { cells, symbols, buckets, divergence, totalEligible } = useMemo(() => {
    const numBuckets = Math.floor(60 / granularity);
    const bucketStarts = Array.from({ length: numBuckets }, (_, i) => i * granularity);

    const map = new Map<string, Cell>();
    const symbolSet = new Set<string>();
    let totalEligible = 0;

    for (const t of trades) {
      if (t.is_archived) continue;
      if (t.is_open) continue;
      if (t.r_multiple_actual == null) continue;
      if (!t.entry_time) continue;
      if (!t.symbol) continue;
      if (mode === "executed" && t.trade_type !== "executed") continue;
      if (mode === "missed" && t.trade_type !== "missed") continue;

      const ts = new Date(t.entry_time);
      if (Number.isNaN(ts.getTime())) continue;
      const minute = ts.getUTCMinutes();
      const bucketStart = Math.floor(minute / granularity) * granularity;
      const canonical = symbolResolver(t.symbol);
      if (symbolFilter !== "__all__" && canonical !== symbolFilter) continue;

      symbolSet.add(canonical);
      totalEligible += 1;

      const key = `${canonical}|${bucketStart}`;
      let cell = map.get(key);
      if (!cell) {
        cell = {
          symbol: canonical,
          bucketStart,
          rSample: [],
          wins: 0,
          losses: 0,
          meanR: 0,
          ciLow: 0,
          ciHigh: 0,
          n: 0,
        };
        map.set(key, cell);
      }
      cell.rSample.push(t.r_multiple_actual);
      if (t.r_multiple_actual > 0) cell.wins += 1;
      else if (t.r_multiple_actual < 0) cell.losses += 1;
    }

    for (const cell of map.values()) {
      const ci = meanRWithCI(cell.rSample, { resamples: 800, seed: 0xA17C0DE });
      cell.meanR = ci.mean;
      cell.ciLow = ci.ciLow;
      cell.ciHigh = ci.ciHigh;
      cell.n = ci.n;
    }

    const symbols = Array.from(symbolSet).sort();

    // Per-symbol divergence: best bucket in :00–:29 vs :30–:59 by mean R.
    const divergence = symbols.map((sym) => {
      let bestFirst: Cell | null = null;
      let bestSecond: Cell | null = null;
      let nFirst = 0;
      let nSecond = 0;
      for (const start of bucketStarts) {
        const cell = map.get(`${sym}|${start}`);
        if (!cell) continue;
        const half = start < 30 ? "first" : "second";
        if (half === "first") {
          nFirst += cell.n;
          if (cell.n >= MIN_N_FOR_COLOR && (!bestFirst || cell.meanR > bestFirst.meanR)) bestFirst = cell;
        } else {
          nSecond += cell.n;
          if (cell.n >= MIN_N_FOR_COLOR && (!bestSecond || cell.meanR > bestSecond.meanR)) bestSecond = cell;
        }
      }
      const delta = (bestFirst?.meanR ?? 0) - (bestSecond?.meanR ?? 0);
      return { symbol: sym, bestFirst, bestSecond, nFirst, nSecond, delta };
    });

    return { cells: map, symbols, buckets: bucketStarts, divergence, totalEligible };
  }, [trades, granularity, mode, symbolResolver, symbolFilter]);

  // Heatmap colour scale based on per-cell mean R among the populated cells.
  const maxAbsR = useMemo(() => {
    let m = 0.1;
    cells.forEach((c) => {
      if (c.n >= MIN_N_FOR_COLOR) m = Math.max(m, Math.abs(c.meanR));
    });
    return m;
  }, [cells]);

  const allSymbolsForFilter = useMemo(() => {
    const s = new Set<string>();
    for (const t of trades) {
      if (!t.symbol) continue;
      s.add(symbolResolver(t.symbol));
    }
    return Array.from(s).sort();
  }, [trades, symbolResolver]);

  if (totalEligible === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground text-center space-y-2">
        <div>No trades with <code className="text-xs">r_multiple_actual</code> and <code className="text-xs">entry_time</code> in this filter.</div>
        <div className="text-xs">Switch the mode toggle or widen the symbol filter to see results.</div>
      </Card>
    );
  }

  return (
    <Card className="p-5 space-y-4">
      {/* Header + controls */}
      <div className="flex items-start gap-2 flex-wrap">
        <Clock className="w-4 h-4 text-primary mt-0.5" />
        <div className="flex-1 min-w-[260px]">
          <h3 className="font-semibold">Intra-hour timing</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Mean R-multiple by minute-of-hour bucket × symbol. Use this to check whether a
            backtested entry window still holds live, or whether your fills have drifted to a
            different part of the hour. Significance gate is the same bootstrap CI used in the
            Strategy Lab edge check.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <Label className="text-xs">Mode</Label>
          <div className="flex items-center gap-1 mt-1 rounded-md border border-border/60 bg-muted/20 p-0.5">
            {MODE_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                size="sm"
                variant={mode === opt.value ? "default" : "ghost"}
                className="h-7 px-2 text-xs"
                onClick={() => setMode(opt.value)}
                title={opt.hint}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <Label className="text-xs">Bucket size</Label>
          <div className="flex items-center gap-1 mt-1 rounded-md border border-border/60 bg-muted/20 p-0.5">
            {GRANULARITY_OPTIONS.map((g) => (
              <Button
                key={g}
                size="sm"
                variant={granularity === g ? "default" : "ghost"}
                className="h-7 px-2 text-xs font-mono-numbers"
                onClick={() => setGranularity(g)}
              >
                {g}m
              </Button>
            ))}
          </div>
        </div>

        <div>
          <Label className="text-xs">Symbol</Label>
          <select
            className="mt-1 h-8 rounded-md border border-border/60 bg-background px-2 text-xs"
            value={symbolFilter}
            onChange={(e) => setSymbolFilter(e.target.value)}
          >
            <option value="__all__">All symbols</option>
            {allSymbolsForFilter.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div className="ml-auto text-[11px] text-muted-foreground font-mono-numbers self-end pb-1">
          N {totalEligible} eligible · {symbols.length} symbols × {buckets.length} buckets
        </div>
      </div>

      {/* Heatmap */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr className="text-xs uppercase tracking-wider text-muted-foreground">
              <th className="text-left py-2 pr-2 sticky left-0 bg-card">Symbol</th>
              {buckets.map((b) => (
                <th key={b} className="text-center py-2 px-1 font-mono-numbers">
                  {bucketLabel(b, granularity)}
                </th>
              ))}
              <th className="text-center py-2 pl-2 text-muted-foreground/70">Row N</th>
            </tr>
          </thead>
          <tbody>
            {symbols.map((sym) => {
              let rowN = 0;
              buckets.forEach((b) => {
                const c = cells.get(`${sym}|${b}`);
                if (c) rowN += c.n;
              });
              return (
                <tr key={sym}>
                  <td className="py-1.5 pr-2 font-medium text-sm whitespace-nowrap sticky left-0 bg-card">
                    {sym}
                  </td>
                  {buckets.map((b) => {
                    const cell = cells.get(`${sym}|${b}`);
                    if (!cell || cell.n === 0) {
                      return (
                        <td key={b} className="p-0.5">
                          <div className="w-full rounded px-2 py-2 text-center border border-border/20 bg-muted/10 text-[11px] text-muted-foreground/50">
                            —
                          </div>
                        </td>
                      );
                    }
                    const lowN = cell.n < MIN_N_FOR_COLOR;
                    const proven = cell.n >= MIN_N_FOR_EDGE && cell.ciLow > 0;
                    const winRate = cell.wins / Math.max(1, cell.wins + cell.losses);
                    const bg = lowN
                      ? "hsl(220 8% 50% / 0.06)"
                      : colorForMeanR(cell.meanR, maxAbsR);
                    const tip = [
                      `N ${cell.n}`,
                      `Mean R ${cell.meanR >= 0 ? "+" : ""}${cell.meanR.toFixed(3)}`,
                      `95% CI [${cell.ciLow >= 0 ? "+" : ""}${cell.ciLow.toFixed(2)}, ${cell.ciHigh >= 0 ? "+" : ""}${cell.ciHigh.toFixed(2)}]`,
                      `Win ${(winRate * 100).toFixed(0)}%`,
                      proven ? "Edge proven (CI > 0)" : cell.n < MIN_N_FOR_EDGE ? `Need ≥${MIN_N_FOR_EDGE} for edge gate` : "CI brackets zero",
                    ].join(" · ");
                    return (
                      <td key={b} className="p-0.5">
                        <div
                          className={cn(
                            "w-full rounded px-2 py-2 text-center border transition-colors",
                            proven ? "border-emerald-500/50" : "border-border/30",
                          )}
                          style={{ backgroundColor: bg }}
                          title={tip}
                        >
                          <div className={cn(
                            "font-mono-numbers font-semibold text-sm",
                            lowN && "text-muted-foreground",
                          )}>
                            {cell.meanR >= 0 ? "+" : ""}{cell.meanR.toFixed(2)}R
                          </div>
                          <div className="font-mono-numbers text-[10px] text-muted-foreground">
                            N {cell.n} · {(winRate * 100).toFixed(0)}%
                          </div>
                        </div>
                      </td>
                    );
                  })}
                  <td className="text-center text-xs text-muted-foreground/80 font-mono-numbers pl-2">{rowN}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Per-symbol first-half vs second-half divergence */}
      <div className="rounded-md border border-border/60 bg-muted/10 p-3 space-y-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          First half vs second half
          <span className="text-[10px] normal-case text-muted-foreground/70">
            best bucket in :00–:29 vs :30–:59 by mean R, per symbol
          </span>
        </div>
        <div className="space-y-1.5">
          {divergence.length === 0 && (
            <div className="text-xs text-muted-foreground">No symbols with enough samples to compare halves.</div>
          )}
          {divergence.map((d) => {
            const flag = d.bestFirst && d.bestSecond && Math.abs(d.delta) >= 0.2;
            const winner = !d.bestFirst && !d.bestSecond
              ? null
              : !d.bestSecond || (d.bestFirst && d.bestFirst.meanR >= d.bestSecond.meanR)
                ? "first"
                : "second";
            return (
              <div key={d.symbol} className="grid grid-cols-12 gap-2 items-center text-xs">
                <div className="col-span-2 font-medium truncate">{d.symbol}</div>
                <div className={cn(
                  "col-span-4 font-mono-numbers",
                  winner === "first" && "text-emerald-600 dark:text-emerald-400",
                )}>
                  {d.bestFirst
                    ? <>1st half: {bucketLabel(d.bestFirst.bucketStart, granularity)} · {d.bestFirst.meanR >= 0 ? "+" : ""}{d.bestFirst.meanR.toFixed(2)}R · N {d.bestFirst.n}</>
                    : <span className="text-muted-foreground">1st half: no qualifying bucket (N&lt;{MIN_N_FOR_COLOR})</span>}
                </div>
                <div className={cn(
                  "col-span-4 font-mono-numbers",
                  winner === "second" && "text-emerald-600 dark:text-emerald-400",
                )}>
                  {d.bestSecond
                    ? <>2nd half: {bucketLabel(d.bestSecond.bucketStart, granularity)} · {d.bestSecond.meanR >= 0 ? "+" : ""}{d.bestSecond.meanR.toFixed(2)}R · N {d.bestSecond.n}</>
                    : <span className="text-muted-foreground">2nd half: no qualifying bucket (N&lt;{MIN_N_FOR_COLOR})</span>}
                </div>
                <div className="col-span-2 text-right">
                  {flag ? (
                    <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 text-[10px]">
                      Δ {d.delta >= 0 ? "+" : ""}{d.delta.toFixed(2)}R
                    </Badge>
                  ) : (
                    <span className="text-[10px] text-muted-foreground font-mono-numbers">
                      Δ {d.delta >= 0 ? "+" : ""}{d.delta.toFixed(2)}R
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-muted-foreground border-t pt-3 leading-relaxed flex items-start gap-1.5">
        <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
        <span>
          Buckets are minute-of-hour in UTC; for brokers on whole-hour offsets this matches your local
          minutes (e.g. UTC :30 = NY :30 = London :30). Cells with N&lt;{MIN_N_FOR_COLOR} are greyed; an
          emerald border means the 95% bootstrap CI on that bucket's mean R is strictly &gt; 0 with
          N≥{MIN_N_FOR_EDGE}. The divergence row flags symbols where the best 1st-half bucket and the
          best 2nd-half bucket differ by ≥0.20R — a sign the entry-window edge isn't where backtest
          said it would be. If "Backtest only" and "Live only" disagree on the same symbol, the backtest
          window most likely overfit a small sample; trust the live row.
        </span>
      </p>
    </Card>
  );
}
