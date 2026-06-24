// ============================================================================
// Intra-Hour Timing — per-pair half-of-hour setup landscape.
//
// Reads the user's custom field `cf_ideal_entry_window_*` (9-state vocabulary
// — see `src/lib/hourSetup.ts`). The value independently tags each half of
// the hour as `worked` (setup printed and played out) or `failed` (setup
// printed but didn't follow through), so per-half hit rates and co-occurrence
// fall out without R-multiples.
//
// A half tagged `worked` on a losing trade still counts as a working window —
// the tag describes the setup, not your execution. R-multiples are deliberately
// ignored — they'd conflate window edge with execution quality.
// ============================================================================


import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Clock, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Trade } from "@/types/trading";
import { decode, readIdealWindow } from "@/lib/hourSetup";

interface Props {
  trades: Trade[];
  symbolResolver: (raw: string) => string;
}

interface HalfStats {
  worked: number;
  failed: number;
}

interface PairRow {
  symbol: string;
  hoursLogged: number;       // hours where at least one of the two columns is set
  first: HalfStats;
  second: HalfStats;
  bothPrinted: number;       // hours where first AND second produced any observation
  bothFirstWorked: number;
  bothSecondWorked: number;
}

const MIN_HOURS_FOR_TRUST = 10;

function emptyHalf(): HalfStats {
  return { worked: 0, failed: 0 };
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

      const value = readIdealWindow(t);
      if (!value || value === 'none') continue;
      const { firstWorked, secondWorked, firstFailed, secondFailed } = decode(value);
      const hasAny = firstWorked || secondWorked || firstFailed || secondFailed;
      if (!hasAny) continue;

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


      if (firstWorked) row.first.worked += 1;
      if (firstFailed) row.first.failed += 1;
      if (secondWorked) row.second.worked += 1;
      if (secondFailed) row.second.failed += 1;

      const firstPrinted = firstWorked || firstFailed;
      const secondPrinted = secondWorked || secondFailed;
      if (firstPrinted && secondPrinted) {
        row.bothPrinted += 1;
        if (firstWorked) row.bothFirstWorked += 1;
        if (secondWorked) row.bothSecondWorked += 1;
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
          Open any trade in the Journal and set the{" "}
          <span className="font-mono text-foreground">Ideal entry window</span> property to
          tag which half of the hour produced a working setup (<span className="font-mono">✓</span>)
          and which produced one that printed but failed (<span className="font-mono">✗</span>) —
          regardless of whether the trade itself won or lost. After ~10–15 hours per pair,
          this tab will show base rates.
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
            Per pair, how often a setup prints in each half of the hour and how often it
            works when it does. No R, no fill-minute bucketing — just base rates of what
            the chart offers. Tag the per-trade{" "}
            <span className="font-mono">Ideal entry window</span> field in the Journal to
            populate this — it tracks the setup, not the trade outcome.
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
              const firstPrinted = r.first.worked + r.first.failed;
              const secondPrinted = r.second.worked + r.second.failed;
              const firstHit = firstPrinted > 0 ? r.first.worked / firstPrinted : null;
              const secondHit = secondPrinted > 0 ? r.second.worked / secondPrinted : null;
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
                    {firstPrinted} / {r.hoursLogged}
                    <div className="text-[10px] text-muted-foreground">
                      {pct(firstPrinted, r.hoursLogged)}
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
                    {secondPrinted} / {r.hoursLogged}
                    <div className="text-[10px] text-muted-foreground">
                      {pct(secondPrinted, r.hoursLogged)}
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
          Halves are split on the candle close: a setup whose final candle closes at or before
          :30 is first-half; after :30 is second-half. Rows with fewer than{" "}
          {MIN_HOURS_FOR_TRUST} logged hours are flagged "low N" — treat their hit rates as
          directional, not decisive. Selection bias caveat: only hours you opened a trade in
          are in this dataset. If a pair's hit-rate gap widens past ~15pp with N ≥ 20, that's
          a real signal — rewrite or confirm the rule on which half to take.
        </span>
      </p>
    </Card>
  );
}
