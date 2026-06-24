// ============================================================================
// Intra-Hour Timing — minute-of-hour heatmap for executed trades.
//
// Answers three questions:
//   1. "Where in the hour does my edge actually sit?" (heatmap, all modes)
//   2. "Is my logged ideal entry window the right one?"
//      → Window discipline = "In-window only" surfaces the edge of trades
//        taken inside your plan.
//   3. "What is breaking my entry-window plan costing me?"
//      → Per-symbol discipline summary compares in-window vs out-of-window
//        mean R per symbol.
//
// `cf_ideal_entry_window` ("first 30min", "last 30min", explicit "15-30",
// etc.) is parsed into a minute range and each trade is tagged in_window /
// out_of_window / unspecified. Unparseable / missing values are treated as
// unspecified and excluded from the in/out filters.
//
// Minute-of-hour is timezone-invariant for whole-hour offsets — UTC minutes
// equal local minutes for every broker we support.
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
type DisciplineFilter = "any" | "in_window" | "out_of_window";
type WindowClass = "in_window" | "out_of_window" | "unspecified";

interface Props {
  trades: Trade[];
  symbolResolver: (raw: string) => string;
  /** Resolved custom-field key for "ideal entry window" (e.g. cf_ideal_entry_window_xxxx). */
  idealEntryWindowKey?: string | null;
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

interface SymbolDiscipline {
  symbol: string;
  inMean: number;
  inN: number;
  outMean: number;
  outN: number;
  driftCost: number; // out - in (negative = drift costs you R)
  totalTrades: number;
  parseableTrades: number;
}

const MODE_OPTIONS: { value: ModeFilter; label: string; hint: string }[] = [
  { value: "all", label: "All", hint: "executed + missed" },
  { value: "executed", label: "Live only", hint: "trade_type = executed" },
  { value: "missed", label: "Backtest only", hint: "trade_type = missed" },
];

const DISCIPLINE_OPTIONS: { value: DisciplineFilter; label: string; hint: string }[] = [
  { value: "any", label: "Any", hint: "no window filter" },
  { value: "in_window", label: "In-window only", hint: "fill minute inside logged ideal entry window" },
  { value: "out_of_window", label: "Out-of-window only", hint: "fill minute outside logged ideal entry window" },
];

const GRANULARITY_OPTIONS: BucketGranularity[] = [10, 15, 30];

const MIN_N_FOR_COLOR = 5;     // below this, cell is shown grey
const MIN_N_FOR_EDGE = 15;     // below this, "edge proven" never fires
const MIN_N_FOR_DRIFT_FLAG = 5;
const DRIFT_FLAG_R = 0.30;
const MIN_TRADES_FOR_COVERAGE_NUDGE = 10;
const MIN_PARSEABLE_FOR_DISCIPLINE = 5;

// ----------------------------------------------------------------------------
// Parse `cf_ideal_entry_window` into [startMin, endMin] inclusive.
// Returns null if unrecognized / empty.
//
// Supported:
//   first 15min / first 15 minutes / 1st 15min  → 0–14
//   first 30min                                  → 0–29
//   first 45min                                  → 0–44
//   last 15min                                   → 45–59
//   last 30min                                   → 30–59
//   last 45min                                   → 15–59
//   :15-:30   /  15-30   /  15 to 30             → 15–30
// ----------------------------------------------------------------------------
export function parseEntryWindow(raw: unknown): [number, number] | null {
  if (raw == null) return null;
  const s = String(raw).toLowerCase().replace(/\s+/g, " ").trim();
  if (!s) return null;

  // first/last N min(utes)
  const firstLast = s.match(/(first|1st|last)\s*(\d{1,2})\s*(?:min|minute|minutes|m)?\b/);
  if (firstLast) {
    const half = firstLast[1];
    const n = Math.max(1, Math.min(59, Number(firstLast[2])));
    if (half === "first" || half === "1st") return [0, n - 1];
    return [60 - n, 59];
  }

  // explicit range: ":15-:30", "15-30", "15 to 30", "15 – 30"
  const range = s.match(/:?(\d{1,2})\s*(?:-|–|to)\s*:?(\d{1,2})/);
  if (range) {
    let a = Number(range[1]);
    let b = Number(range[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      a = Math.max(0, Math.min(59, a));
      b = Math.max(0, Math.min(59, b));
      if (a > b) [a, b] = [b, a];
      return [a, b];
    }
  }

  return null;
}

function classifyTrade(
  minute: number,
  windowLabel: unknown,
): WindowClass {
  const w = parseEntryWindow(windowLabel);
  if (!w) return "unspecified";
  return minute >= w[0] && minute <= w[1] ? "in_window" : "out_of_window";
}

function bucketLabel(start: number, width: number): string {
  const end = start + width - 1;
  return `:${String(start).padStart(2, "0")}–:${String(end).padStart(2, "0")}`;
}

function colorForMeanR(meanR: number, maxAbs: number): string {
  if (maxAbs <= 0) return "hsl(220 8% 50% / 0.06)";
  const ratio = Math.max(-1, Math.min(1, meanR / maxAbs));
  if (ratio >= 0) {
    const alpha = 0.08 + ratio * 0.42;
    return `hsl(150 70% 45% / ${alpha})`;
  }
  const alpha = 0.08 + Math.abs(ratio) * 0.42;
  return `hsl(0 75% 55% / ${alpha})`;
}

function meanOf(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function IntraHourTiming({ trades, symbolResolver, idealEntryWindowKey }: Props) {
  const [granularity, setGranularity] = useState<BucketGranularity>(15);
  const [mode, setMode] = useState<ModeFilter>("all");
  const [discipline, setDiscipline] = useState<DisciplineFilter>("any");
  const [symbolFilter, setSymbolFilter] = useState<string>("__all__");

  const {
    cells,
    symbols,
    buckets,
    divergence,
    totalEligible,
    excludedUnspecified,
    disciplineBySymbol,
    coverageNudges,
    hasDisciplineData,
  } = useMemo(() => {
    const numBuckets = Math.floor(60 / granularity);
    const bucketStarts = Array.from({ length: numBuckets }, (_, i) => i * granularity);

    const cellMap = new Map<string, Cell>();
    const symbolSet = new Set<string>();

    // Per-symbol discipline aggregates (independent of the discipline filter)
    const inSamples = new Map<string, number[]>();
    const outSamples = new Map<string, number[]>();
    const totalBySymbol = new Map<string, number>();
    const parseableBySymbol = new Map<string, number>();

    let totalEligible = 0;
    let excludedUnspecified = 0;

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

      // Window classification
      const windowLabel = idealEntryWindowKey
        ? (t as { custom_fields?: Record<string, unknown> }).custom_fields?.[idealEntryWindowKey]
        : null;
      const cls = classifyTrade(minute, windowLabel);

      // Track per-symbol totals + per-class samples regardless of filter so the
      // discipline summary always reflects the full mode-filtered set.
      totalBySymbol.set(canonical, (totalBySymbol.get(canonical) ?? 0) + 1);
      if (cls !== "unspecified") {
        parseableBySymbol.set(canonical, (parseableBySymbol.get(canonical) ?? 0) + 1);
        const bag = cls === "in_window" ? inSamples : outSamples;
        if (!bag.has(canonical)) bag.set(canonical, []);
        bag.get(canonical)!.push(t.r_multiple_actual);
      }

      // Apply discipline filter to the heatmap itself
      if (discipline === "in_window" && cls !== "in_window") {
        if (cls === "unspecified") excludedUnspecified += 1;
        continue;
      }
      if (discipline === "out_of_window" && cls !== "out_of_window") {
        if (cls === "unspecified") excludedUnspecified += 1;
        continue;
      }

      symbolSet.add(canonical);
      totalEligible += 1;

      const key = `${canonical}|${bucketStart}`;
      let cell = cellMap.get(key);
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
        cellMap.set(key, cell);
      }
      cell.rSample.push(t.r_multiple_actual);
      if (t.r_multiple_actual > 0) cell.wins += 1;
      else if (t.r_multiple_actual < 0) cell.losses += 1;
    }

    for (const cell of cellMap.values()) {
      const ci = meanRWithCI(cell.rSample, { resamples: 800, seed: 0xA17C0DE });
      cell.meanR = ci.mean;
      cell.ciLow = ci.ciLow;
      cell.ciHigh = ci.ciHigh;
      cell.n = ci.n;
    }

    const symbols = Array.from(symbolSet).sort();

    // First-half vs second-half divergence (legacy fallback when there's not
    // enough window-tagged data to drive the discipline view).
    const divergence = symbols.map((sym) => {
      let bestFirst: Cell | null = null;
      let bestSecond: Cell | null = null;
      let nFirst = 0;
      let nSecond = 0;
      for (const start of bucketStarts) {
        const cell = cellMap.get(`${sym}|${start}`);
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

    // Per-symbol discipline summary across the full mode-filtered set, only
    // for symbols that show up in the current (filtered) heatmap so the lists
    // stay aligned with what the user is looking at.
    const disciplineSet = new Set<string>([
      ...symbols,
      ...Array.from(inSamples.keys()),
      ...Array.from(outSamples.keys()),
    ]);
    if (symbolFilter !== "__all__") {
      for (const s of Array.from(disciplineSet)) {
        if (s !== symbolFilter) disciplineSet.delete(s);
      }
    }
    const disciplineBySymbol: SymbolDiscipline[] = Array.from(disciplineSet)
      .sort()
      .map((sym) => {
        const inArr = inSamples.get(sym) ?? [];
        const outArr = outSamples.get(sym) ?? [];
        const inMean = meanOf(inArr);
        const outMean = meanOf(outArr);
        return {
          symbol: sym,
          inMean,
          inN: inArr.length,
          outMean,
          outN: outArr.length,
          driftCost: outMean - inMean,
          totalTrades: totalBySymbol.get(sym) ?? 0,
          parseableTrades: parseableBySymbol.get(sym) ?? 0,
        };
      })
      .filter((d) => d.inN > 0 || d.outN > 0);

    const coverageNudges = disciplineBySymbol
      .filter(
        (d) =>
          d.totalTrades >= MIN_TRADES_FOR_COVERAGE_NUDGE &&
          d.parseableTrades < MIN_PARSEABLE_FOR_DISCIPLINE,
      )
      .map((d) => ({
        symbol: d.symbol,
        missing: Math.max(0, MIN_PARSEABLE_FOR_DISCIPLINE - d.parseableTrades),
      }));

    // Use discipline view when *any* symbol has enough parseable trades to be
    // meaningful — otherwise fall back to the halves block.
    const totalParseable = Array.from(parseableBySymbol.values()).reduce((a, b) => a + b, 0);
    const hasDisciplineData = totalParseable >= MIN_PARSEABLE_FOR_DISCIPLINE;

    return {
      cells: cellMap,
      symbols,
      buckets: bucketStarts,
      divergence,
      totalEligible,
      excludedUnspecified,
      disciplineBySymbol,
      coverageNudges,
      hasDisciplineData,
    };
  }, [trades, granularity, mode, discipline, symbolResolver, symbolFilter, idealEntryWindowKey]);

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

  const hasWindowKey = Boolean(idealEntryWindowKey);

  if (totalEligible === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground text-center space-y-2">
        <div>No trades with <code className="text-xs">r_multiple_actual</code> and <code className="text-xs">entry_time</code> in this filter.</div>
        <div className="text-xs">Switch the mode toggle, change Window discipline, or widen the symbol filter to see results.</div>
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
            Mean R-multiple by minute-of-hour bucket × symbol. Use it to check whether a
            backtested entry window still holds live, whether your fills have drifted, and —
            using your logged <code className="text-[11px]">ideal entry window</code> — whether
            breaking your plan is costing you R. Significance gate is the same bootstrap CI used
            in the Strategy Lab edge check.
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
          <Label className="text-xs">Window discipline</Label>
          <div
            className="flex items-center gap-1 mt-1 rounded-md border border-border/60 bg-muted/20 p-0.5"
            title={hasWindowKey ? undefined : "Add an 'ideal entry window' custom field in Journal settings to enable"}
          >
            {DISCIPLINE_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                size="sm"
                variant={discipline === opt.value ? "default" : "ghost"}
                className="h-7 px-2 text-xs"
                onClick={() => setDiscipline(opt.value)}
                disabled={!hasWindowKey && opt.value !== "any"}
                title={opt.hint}
              >
                {opt.label}
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
          {excludedUnspecified > 0 && (
            <span className="block text-amber-600/80 dark:text-amber-400/80">
              {excludedUnspecified} excluded — no ideal window logged
            </span>
          )}
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

      {/* Discipline summary — replaces the halves block when there is enough
          window-tagged data, otherwise fall back to first/second half. */}
      {hasWindowKey && hasDisciplineData ? (
        <div className="rounded-md border border-border/60 bg-muted/10 p-3 space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            Window discipline
            <span className="text-[10px] normal-case text-muted-foreground/70">
              in-window vs out-of-window, per symbol — from your logged ideal entry window
            </span>
          </div>
          <div className="space-y-1.5">
            {disciplineBySymbol.length === 0 && (
              <div className="text-xs text-muted-foreground">No symbols with window-tagged trades in this view.</div>
            )}
            {disciplineBySymbol.map((d) => {
              const haveBoth = d.inN >= MIN_N_FOR_DRIFT_FLAG && d.outN >= MIN_N_FOR_DRIFT_FLAG;
              const driftBad = haveBoth && d.driftCost <= -DRIFT_FLAG_R;
              const driftGood = haveBoth && d.driftCost >= DRIFT_FLAG_R;
              return (
                <div key={d.symbol} className="grid grid-cols-12 gap-2 items-center text-xs">
                  <div className="col-span-2 font-medium truncate">{d.symbol}</div>
                  <div className="col-span-4 font-mono-numbers">
                    {d.inN > 0 ? (
                      <span className="text-emerald-700 dark:text-emerald-400">
                        in-window {d.inMean >= 0 ? "+" : ""}{d.inMean.toFixed(2)}R · N {d.inN}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">in-window: none</span>
                    )}
                  </div>
                  <div className="col-span-4 font-mono-numbers">
                    {d.outN > 0 ? (
                      <span className={cn(d.outMean < 0 && "text-red-600 dark:text-red-400")}>
                        out-of-window {d.outMean >= 0 ? "+" : ""}{d.outMean.toFixed(2)}R · N {d.outN}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">out-of-window: none</span>
                    )}
                  </div>
                  <div className="col-span-2 text-right">
                    {driftBad ? (
                      <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 text-[10px]">
                        drift cost {d.driftCost.toFixed(2)}R
                      </Badge>
                    ) : driftGood ? (
                      <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-[10px]">
                        drift +{d.driftCost.toFixed(2)}R
                      </Badge>
                    ) : (
                      <span className="text-[10px] text-muted-foreground font-mono-numbers">
                        {haveBoth ? `Δ ${d.driftCost >= 0 ? "+" : ""}${d.driftCost.toFixed(2)}R` : `need N≥${MIN_N_FOR_DRIFT_FLAG} both sides`}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {coverageNudges.length > 0 && (
            <div className="pt-1 border-t border-border/40 space-y-0.5">
              {coverageNudges.map((n) => (
                <div key={n.symbol} className="text-[11px] text-muted-foreground/80">
                  {n.symbol} — log ideal window on {n.missing} more trade{n.missing === 1 ? "" : "s"} to unlock discipline view
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-md border border-border/60 bg-muted/10 p-3 space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            First half vs second half
            <span className="text-[10px] normal-case text-muted-foreground/70">
              best bucket in :00–:29 vs :30–:59 by mean R, per symbol
              {hasWindowKey && " · log ideal entry window on more trades to switch to discipline view"}
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
      )}

      <p className="text-xs text-muted-foreground border-t pt-3 leading-relaxed flex items-start gap-1.5">
        <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
        <span>
          Buckets are minute-of-hour in UTC; for brokers on whole-hour offsets this matches your local
          minutes (e.g. UTC :30 = NY :30 = London :30). Cells with N&lt;{MIN_N_FOR_COLOR} are greyed; an
          emerald border means the 95% bootstrap CI on that bucket's mean R is strictly &gt; 0 with
          N≥{MIN_N_FOR_EDGE}.
          {" "}
          Window discipline reads <code className="text-[11px]">cf_ideal_entry_window</code> — supported
          phrases: <code className="text-[11px]">first 15min / 30min / 45min</code>,
          {" "}<code className="text-[11px]">last 15min / 30min / 45min</code>, or explicit ranges
          like <code className="text-[11px]">:15-:30</code>. Anything else counts as unspecified.
          Drift cost amber chip requires N≥{MIN_N_FOR_DRIFT_FLAG} on both sides and |Δ|≥{DRIFT_FLAG_R.toFixed(2)}R.
        </span>
      </p>
    </Card>
  );
}
