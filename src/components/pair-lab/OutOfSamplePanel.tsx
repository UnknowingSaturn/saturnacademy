// ============================================================================
// OutOfSamplePanel — train/test split on the date axis.
//
// Splits the in-scope trades chronologically at `splitDate` (default 70/30 by
// calendar position), runs `buildBuckets` independently on each half in a Web
// Worker, and shows where the baseline + per-cell expectancy held up
// out-of-sample. Cells profitable in train but negative in test are flagged
// as overfit candidates.
//
// Perf: dual buildBuckets runs off the main thread (oosSplit.worker). The
// slider stays at native 60fps; the heavy recompute is debounced 150ms.
// Slider bounds come from usePairLabTradeBounds — no per-memo full-sort.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { Trade } from "@/types/trading";
import type {
  PairLabFieldKeys,
  PropFirmContext,
} from "@/lib/pairLabMath";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";
import { useOosSplit } from "@/hooks/useOosSplit";
import { usePairLabTradeBounds } from "@/hooks/usePairLabTradeBounds";

interface Props {
  trades: Trade[];
  fieldKeys: PairLabFieldKeys;
  symbolResolver: (raw: string) => string;
  propFirm: PropFirmContext | null;
  dateFrom: string | null;
  dateTo: string;
}

const DAY = 86_400_000;

function fmt(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function OutOfSamplePanel({
  trades,
  fieldKeys,
  symbolResolver,
  propFirm,
  dateFrom,
  dateTo,
}: Props) {
  // Slider bounds come from the shared bounds hook (single O(n) pass on the
  // cached trade list — no per-memo sort here). The 70/30 split is computed
  // as a linear calendar fraction of [min,max]; it used to be index-based
  // (sort + percentile) which was O(n log n) on every slider drag.
  const { minMs, maxMs } = usePairLabTradeBounds();
  const defaultSplit = useMemo(
    () => Math.round(minMs + 0.7 * (maxMs - minMs)),
    [minMs, maxMs],
  );

  // Two-stage state: `sliderMs` updates instantly so the slider feels
  // responsive; `splitMs` (which drives the worker postMessage) is committed
  // 150ms after the user stops dragging.
  const [splitMs, setSplitMs] = useState<number>(defaultSplit);
  const [sliderMs, setSliderMs] = useState<number>(defaultSplit);
  const commitSplit = useDebouncedCallback((v: number) => setSplitMs(v), 150);
  useEffect(() => {
    setSliderMs(defaultSplit);
    setSplitMs(defaultSplit);
  }, [defaultSplit]);

  // Stable raw → canonical map so the worker can rebuild the resolver
  // function. Recomputed only when the trade slice or aliases shift.
  const resolverMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of trades) {
      if (!t.symbol) continue;
      if (map[t.symbol] != null) continue;
      map[t.symbol] = symbolResolver(t.symbol);
    }
    return map;
  }, [trades, symbolResolver]);

  const params = useMemo(
    () => ({
      trades,
      fieldKeys,
      resolverMap,
      propFirm,
      dateFrom,
      dateTo,
      splitIso: new Date(splitMs).toISOString(),
    }),
    [trades, fieldKeys, resolverMap, propFirm, dateFrom, dateTo, splitMs],
  );

  const { result, isComputing } = useOosSplit(params);

  // First-paint skeleton — once we have a result, keep rendering it while
  // newer requests recompute (avoids the table flickering between drags).
  if (!result) {
    return (
      <Card className="p-4 space-y-3">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-24 w-full" />
      </Card>
    );
  }

  const { trainBaseline: train, testBaseline: test, deltas } = result;
  const overfitCount = deltas.filter((d) => d.overfit).length;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            Out-of-sample split
            {isComputing && (
              <span className="text-[10px] text-muted-foreground/60">
                recomputing…
              </span>
            )}
          </div>
          <div className="text-sm">
            Train: <span className="font-mono-numbers">N {train.n} · {(train.winRate * 100).toFixed(0)}% · {(train.expectedR >= 0 ? "+" : "") + train.expectedR.toFixed(2)}R</span>
            <span className="text-muted-foreground"> → </span>
            Test: <span className="font-mono-numbers">N {test.n} · {(test.winRate * 100).toFixed(0)}% · {(test.expectedR >= 0 ? "+" : "") + test.expectedR.toFixed(2)}R</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {train.expectedR > 0 && test.expectedR <= 0 && (
            <Badge variant="destructive" className="text-[10px]">Baseline degraded OOS</Badge>
          )}
          {overfitCount > 0 && (
            <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400">
              {overfitCount} overfit cell{overfitCount === 1 ? "" : "s"}
            </Badge>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Split at</Label>
          <span className="font-mono-numbers text-xs">{fmt(sliderMs)}</span>
        </div>
        <Slider
          value={[sliderMs]}
          min={minMs}
          max={maxMs}
          step={DAY}
          onValueChange={(v) => {
            const next = v[0] ?? sliderMs;
            setSliderMs(next);
            commitSplit(next);
          }}
          aria-label="Train/test split date"
        />
      </div>

      {deltas.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b border-border/40">
                <th className="text-left font-medium py-1.5 pr-3">Pair · Session</th>
                <th className="text-right font-medium py-1.5 px-3">Train N</th>
                <th className="text-right font-medium py-1.5 px-3">Train E[R]</th>
                <th className="text-right font-medium py-1.5 px-3">Test N</th>
                <th className="text-right font-medium py-1.5 px-3">Test E[R]</th>
                <th className="text-right font-medium py-1.5 pl-3">Δ</th>
              </tr>
            </thead>
            <tbody className="font-mono-numbers">
              {deltas.slice(0, 12).map((d) => {
                const delta = d.test.expectedR - d.train.expectedR;
                return (
                  <tr
                    key={`${d.symbol}__${d.session}`}
                    className={d.overfit ? "bg-amber-500/5" : ""}
                  >
                    <td className="py-1 pr-3 font-sans">{d.symbol} · {d.session}{d.overfit && <span className="ml-1.5 text-[10px] text-amber-600 dark:text-amber-400">overfit?</span>}</td>
                    <td className="text-right px-3">{d.train.n}</td>
                    <td className={"text-right px-3 " + (d.train.expectedR >= 0 ? "text-profit" : "text-loss")}>
                      {(d.train.expectedR >= 0 ? "+" : "") + d.train.expectedR.toFixed(2)}R
                    </td>
                    <td className="text-right px-3">{d.test.n}</td>
                    <td className={"text-right px-3 " + (d.test.expectedR >= 0 ? "text-profit" : "text-loss")}>
                      {(d.test.expectedR >= 0 ? "+" : "") + d.test.expectedR.toFixed(2)}R
                    </td>
                    <td className={"text-right pl-3 " + (delta >= 0 ? "text-profit" : "text-loss")}>
                      {(delta >= 0 ? "+" : "") + delta.toFixed(2)}R
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {deltas.length > 12 && (
            <div className="text-[10px] text-muted-foreground pt-1.5">
              Showing first 12 of {deltas.length} eligible cells (≥5 trades on each side).
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
