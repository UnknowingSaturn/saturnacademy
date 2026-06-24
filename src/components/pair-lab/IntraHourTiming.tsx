// ============================================================================
// Intra-Hour Timing — per-pair half-of-hour setup landscape.
//
// Answers, per pair: when a first-half setup (≤ :30) prints, what % work? When
// a second-half setup (> :30) prints, what % work? And when BOTH print in the
// same logged hour, which half pays more often?
//
// This deliberately does NOT bucket by fill-minute or aggregate R-multiples.
// R conflates window edge with your own execution quality (a late entry on a
// real first-half setup booked as a loss would have dragged down the "first
// half" R). Counting setup occurrences and outcomes — independent of the
// trade you actually took — isolates the window question.
//
// Inputs are the per-trade observation fields `first_half_setup` and
// `second_half_setup` (values: 'none' | 'worked' | 'failed' | null). The user
// fills these in when journaling: what did the chart offer this hour, not
// what did I make.
// ============================================================================

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Clock, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Trade, HourSetupOutcome } from "@/types/trading";

interface Props {
  trades: Trade[];
  symbolResolver: (raw: string) => string;
}

interface HalfStats {
  printed: number;   // 'worked' + 'failed'
  worked: number;
  failed: number;
}

interface PairRow {
  symbol: string;
  hoursLogged: number;       // hours where at least one half has an outcome recorded
  first: HalfStats;
  second: HalfStats;
  bothPrinted: number;       // hours where first printed AND second printed
  bothFirstWorked: number;   // of bothPrinted, first 'worked'
  bothSecondWorked: number;  // of bothPrinted, second 'worked'
}

const MIN_HOURS_FOR_TRUST = 10;

function emptyHalf(): HalfStats {
  return { printed: 0, worked: 0, failed: 0 };
}

function recordHalf(stats: HalfStats, v: HourSetupOutcome | null | undefined): boolean {
  if (v === 'worked') { stats.printed += 1; stats.worked += 1; return true; }
  if (v === 'failed') { stats.printed += 1; stats.failed += 1; return true; }
  return false;
}

function pct(num: number, denom: number): string {
  if (denom <= 0) return "—";
  return `${Math.round((num / denom) * 100)}%`;
}

export function IntraHourTiming({ trades, symbolResolver }: Props) {
  const [symbolFilter, setSymbolFilter] = useState<string>("__all__");

  const { rows, totalLoggedHours, allSymbols } = useMemo(() => {
    const map = new Map<string, PairRow>();
    const symSet = new Set<string>();

    for (const t of trades) {
      if (t.is_archived) continue;
      if (!t.symbol) continue;
      const canonical = symbolResolver(t.symbol);
      symSet.add(canonical);

      const fh = (t.first_half_setup ?? null) as HourSetupOutcome | null;
      const sh = (t.second_half_setup ?? null) as HourSetupOutcome | null;
      // Need at least one half tagged to count this trade as a logged hour.
      if (!fh && !sh) continue;

      let row = map.get(canonical);
      if (!row) {
        row = {
          symbol: canonical,
          hoursLogged: 0,
          first: emptyHalf(),
          second: emptyHalf(),
          bothPrinted: 0,
          bothFirstWorked: 0,
          bothSecondWorked: 0,
        };
        map.set(canonical, row);
      }
      row.hoursLogged += 1;
      const firstPrinted = recordHalf(row.first, fh);
      const secondPrinted = recordHalf(row.second, sh);
      if (firstPrinted && secondPrinted) {
        row.bothPrinted += 1;
        if (fh === 'worked') row.bothFirstWorked += 1;
        if (sh === 'worked') row.bothSecondWorked += 1;
      }
    }

    const rows = Array.from(map.values())
      .filter((r) => symbolFilter === "__all__" || r.symbol === symbolFilter)
      .sort((a, b) => b.hoursLogged - a.hoursLogged);

    const totalLoggedHours = rows.reduce((s, r) => s + r.hoursLogged, 0);
    return { rows, totalLoggedHours, allSymbols: Array.from(symSet).sort() };
  }, [trades, symbolResolver, symbolFilter]);

  if (totalLoggedHours === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground space-y-2">
        <div className="font-medium text-foreground">No hour setup observations yet.</div>
        <div className="text-xs leading-relaxed">
          Open any trade in the Journal and fill in the new <span className="font-mono text-foreground">1st-half setup (≤ :30)</span>{" "}
          and <span className="font-mono text-foreground">2nd-half setup (&gt; :30)</span> fields. Mark each half as{" "}
          <span className="font-mono text-foreground">Worked</span>, <span className="font-mono text-foreground">Failed</span>, or{" "}
          <span className="font-mono text-foreground">None</span> based on what the chart actually offered — regardless of which one
          you took. After ~10–15 hours per pair, this tab will show base rates.
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start gap-2 flex-wrap">
        <Clock className="w-4 h-4 text-primary mt-0.5" />
        <div className="flex-1 min-w-[260px]">
          <h3 className="font-semibold">Hour setup landscape</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Per pair, the rate at which a setup prints in each half of the hour and the rate at
            which it works when it does. No R, no fill-minute bucketing — just base rates of what
            the chart offers. Fill the per-trade <span className="font-mono">1st-half / 2nd-half setup</span>{" "}
            fields in the Journal to populate this.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <Label className="text-xs">Symbol</Label>
          <select
            className="mt-1 h-8 rounded-md border border-border/60 bg-background px-2 text-xs"
            value={symbolFilter}
            onChange={(e) => setSymbolFilter(e.target.value)}
          >
            <option value="__all__">All symbols</option>
            {allSymbols.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div className="ml-auto text-[11px] text-muted-foreground font-mono-numbers self-end pb-1">
          {totalLoggedHours} logged hours · {rows.length} pairs
        </div>
      </div>

      {/* Per-pair table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr className="text-xs uppercase tracking-wider text-muted-foreground">
              <th className="text-left py-2 pr-2">Symbol</th>
              <th className="text-center py-2 px-2">Hours</th>
              <th className="text-center py-2 px-2 border-l border-border/30">1st printed</th>
              <th className="text-center py-2 px-2">1st hit rate</th>
              <th className="text-center py-2 px-2 border-l border-border/30">2nd printed</th>
              <th className="text-center py-2 px-2">2nd hit rate</th>
              <th className="text-center py-2 px-2 border-l border-border/30">Edge</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const firstHit = r.first.printed > 0 ? r.first.worked / r.first.printed : null;
              const secondHit = r.second.printed > 0 ? r.second.worked / r.second.printed : null;
              const trusted = r.hoursLogged >= MIN_HOURS_FOR_TRUST;
              const delta = firstHit != null && secondHit != null ? firstHit - secondHit : null;
              const edgeLabel = delta == null
                ? "—"
                : Math.abs(delta) < 0.05
                  ? "≈ even"
                  : delta > 0 ? `1st +${Math.round(delta * 100)}pp` : `2nd +${Math.round(-delta * 100)}pp`;
              const edgeTone =
                delta == null || Math.abs(delta) < 0.05 ? "text-muted-foreground"
                : delta > 0 ? "text-emerald-600 dark:text-emerald-400"
                : "text-blue-600 dark:text-blue-400";

              return (
                <tr key={r.symbol} className="border-t border-border/20">
                  <td className="py-2 pr-2 font-medium whitespace-nowrap">
                    {r.symbol}
                    {!trusted && (
                      <Badge variant="outline" className="ml-2 text-[9px] px-1 py-0 h-4">
                        low N
                      </Badge>
                    )}
                  </td>
                  <td className="py-2 px-2 text-center font-mono-numbers text-xs">
                    {r.hoursLogged}
                  </td>
                  <td className="py-2 px-2 text-center font-mono-numbers text-xs border-l border-border/30">
                    {r.first.printed} / {r.hoursLogged}
                    <div className="text-[10px] text-muted-foreground">
                      {pct(r.first.printed, r.hoursLogged)}
                    </div>
                  </td>
                  <td className="py-2 px-2 text-center font-mono-numbers">
                    <span className={cn(
                      "font-semibold",
                      firstHit == null ? "text-muted-foreground" :
                      firstHit >= 0.6 ? "text-emerald-600 dark:text-emerald-400" :
                      firstHit <= 0.4 ? "text-loss" : "",
                    )}>
                      {firstHit == null ? "—" : `${Math.round(firstHit * 100)}%`}
                    </span>
                    <div className="text-[10px] text-muted-foreground">
                      {r.first.worked}W / {r.first.failed}L
                    </div>
                  </td>
                  <td className="py-2 px-2 text-center font-mono-numbers text-xs border-l border-border/30">
                    {r.second.printed} / {r.hoursLogged}
                    <div className="text-[10px] text-muted-foreground">
                      {pct(r.second.printed, r.hoursLogged)}
                    </div>
                  </td>
                  <td className="py-2 px-2 text-center font-mono-numbers">
                    <span className={cn(
                      "font-semibold",
                      secondHit == null ? "text-muted-foreground" :
                      secondHit >= 0.6 ? "text-emerald-600 dark:text-emerald-400" :
                      secondHit <= 0.4 ? "text-loss" : "",
                    )}>
                      {secondHit == null ? "—" : `${Math.round(secondHit * 100)}%`}
                    </span>
                    <div className="text-[10px] text-muted-foreground">
                      {r.second.worked}W / {r.second.failed}L
                    </div>
                  </td>
                  <td className={cn("py-2 px-2 text-center font-mono-numbers text-xs border-l border-border/30", edgeTone)}>
                    {edgeLabel}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Co-occurrence panel */}
      <div className="rounded-md border border-border/60 bg-muted/10 p-3 space-y-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          Co-occurrence — when both halves printed in the same hour
        </div>
        <div className="space-y-1.5">
          {rows.filter((r) => r.bothPrinted > 0).length === 0 && (
            <div className="text-xs text-muted-foreground">
              No hours yet where both halves had a printed setup.
            </div>
          )}
          {rows.filter((r) => r.bothPrinted > 0).map((r) => {
            const fW = r.bothFirstWorked;
            const sW = r.bothSecondWorked;
            const winner = fW > sW ? "first" : sW > fW ? "second" : "tie";
            return (
              <div key={r.symbol} className="grid grid-cols-12 gap-2 items-center text-xs">
                <div className="col-span-2 font-medium truncate">{r.symbol}</div>
                <div className="col-span-2 text-muted-foreground font-mono-numbers">
                  {r.bothPrinted} hours
                </div>
                <div className={cn(
                  "col-span-3 font-mono-numbers",
                  winner === "first" && "text-emerald-600 dark:text-emerald-400",
                )}>
                  1st worked {fW} / {r.bothPrinted}
                </div>
                <div className={cn(
                  "col-span-3 font-mono-numbers",
                  winner === "second" && "text-emerald-600 dark:text-emerald-400",
                )}>
                  2nd worked {sW} / {r.bothPrinted}
                </div>
                <div className="col-span-2 text-right text-[10px] text-muted-foreground">
                  {winner === "tie" ? "tied" : winner === "first" ? "take 1st" : "wait for 2nd"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-muted-foreground border-t pt-3 leading-relaxed flex items-start gap-1.5">
        <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
        <span>
          Halves are split on the candle close: a setup whose final candle closes at or before :30
          is first-half; after :30 is second-half. Rows with fewer than {MIN_HOURS_FOR_TRUST} logged
          hours are flagged "low N" — treat their hit rates as directional, not decisive. Selection
          bias caveat: only hours you opened a trade in are in this dataset. If a pair's hit-rate
          gap widens past ~15pp with N ≥ 20, that's a real signal — rewrite or confirm the rule on
          which half to take.
        </span>
      </p>
    </Card>
  );
}
