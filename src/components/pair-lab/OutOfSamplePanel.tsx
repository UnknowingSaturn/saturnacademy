// ============================================================================
// OutOfSamplePanel — train/test split on the date axis.
//
// Splits the in-scope trades chronologically at `splitDate` (default 70/30 by
// time), runs `buildBuckets` independently on each half, and shows where the
// baseline + per-cell expectancy held up out-of-sample. Cells profitable in
// train but negative in test are flagged as overfit candidates.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import type { Trade } from "@/types/trading";
import {
  buildBuckets,
  type BucketReport,
  type PairLabFieldKeys,
  type PropFirmContext,
} from "@/lib/pairLabMath";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";

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

function deltaCell(train: BucketReport | null, test: BucketReport | null) {
  if (!train || !test || train.n < 5 || test.n < 5) return null;
  const overfit = train.expectedR > 0 && test.expectedR <= 0;
  return { train, test, overfit };
}

export function OutOfSamplePanel({
  trades,
  fieldKeys,
  symbolResolver,
  propFirm,
  dateFrom,
  dateTo,
}: Props) {
  // Bound the slider by the in-scope trade timestamps.
  const { minMs, maxMs, defaultSplit } = useMemo(() => {
    const tsList = trades
      .filter((t) => !t.is_open && !t.is_archived && t.entry_time)
      .map((t) => new Date(String(t.entry_time)).getTime())
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    const min = tsList[0] ?? Date.now() - 90 * DAY;
    const max = tsList[tsList.length - 1] ?? Date.now();
    // 70/30 by time index, not by calendar — handles bursty trading.
    const split = tsList.length > 0
      ? tsList[Math.floor(tsList.length * 0.7)] ?? max
      : (min + max) / 2;
    return { minMs: min, maxMs: max, defaultSplit: split };
  }, [trades]);

  // Two-stage state: `sliderMs` updates instantly so the slider feels
  // responsive; `splitMs` (which drives the heavy buildBuckets call) is
  // committed 150ms after the user stops dragging.
  const [splitMs, setSplitMs] = useState<number>(defaultSplit);
  const [sliderMs, setSliderMs] = useState<number>(defaultSplit);
  const commitSplit = useDebouncedCallback((v: number) => setSplitMs(v), 150);
  useEffect(() => {
    setSliderMs(defaultSplit);
    setSplitMs(defaultSplit);
  }, [defaultSplit]);

  const { train, test, deltas } = useMemo(() => {
    const splitIso = new Date(splitMs).toISOString();
    const trainRes = buildBuckets(trades, fieldKeys, {
      symbolResolver,
      propFirm,
      closedOnly: true,
      dateFrom,
      dateTo: splitIso,
    });
    const testRes = buildBuckets(trades, fieldKeys, {
      symbolResolver,
      propFirm,
      closedOnly: true,
      dateFrom: splitIso,
      dateTo,
    });
    const cellKey = (b: BucketReport) => `${b.key.symbol}__${b.key.session}`;
    const testMap = new Map(testRes.perCell.map((b) => [cellKey(b), b]));
    const out: Array<{ symbol: string; session: string; train: BucketReport; test: BucketReport; overfit: boolean }> = [];
    for (const tr of trainRes.perCell) {
      const te = testMap.get(cellKey(tr));
      const d = deltaCell(tr, te ?? null);
      if (d) {
        out.push({ symbol: tr.key.symbol, session: tr.key.session, ...d });
      }
    }
    out.sort((a, b) => (b.overfit ? 1 : 0) - (a.overfit ? 1 : 0) || b.train.n - a.train.n);
    return { train: trainRes.baseline, test: testRes.baseline, deltas: out };
  }, [trades, fieldKeys, symbolResolver, propFirm, dateFrom, dateTo, splitMs]);

  const overfitCount = deltas.filter((d) => d.overfit).length;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Out-of-sample split
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
          <span className="font-mono-numbers text-xs">{fmt(splitMs)}</span>
        </div>
        <Slider
          value={[splitMs]}
          min={minMs}
          max={maxMs}
          step={DAY}
          onValueChange={(v) => setSplitMs(v[0] ?? splitMs)}
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
