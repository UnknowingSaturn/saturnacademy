// ============================================================================
// IdealWindowHeatmap — pair × hour × half ideal-entry-window heatmap.
//
// Quant-grade reading:
//   - Each cell shows worked-rate (Wilson 95% CI), expectancy in R (bootstrap
//     95% CI), and lift vs the pair's baseline.
//   - Color = lift vs baseline (diverging red→green). Opacity ~ sample size.
//   - ★ = bucket differs from baseline at p<0.05 (two-proportion z-test).
//   - Cells with n < minN render greyed (directional only).
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Clock, Info, Star, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Trade, TradeDirection } from "@/types/trading";
import {
  bucketTrades,
  subGridFifteenMin,
  cumulativeSeries,
  rollingRateSeries,
  type BucketStats,
  type Half,
  type IdealWindowFilters,
} from "@/lib/idealWindowMath";
import { useUserSettings } from "@/hooks/useUserSettings";
import { usePropertyOptions } from "@/hooks/useUserSettings";
// S3.5: groups now flow via PairLabWalkForwardContext (no extra subscription).
import { usePairLabWalkForward } from "@/contexts/PairLabWalkForwardContext";

interface Props {
  trades: Trade[];
  symbolResolver: (raw: string) => string;
  allSymbols: string[];
}

const HOURS_STORAGE_KEY = "pairLab.idealWindow.hours";
const MIN_N_STORAGE_KEY = "pairLab.idealWindow.minN";
const ALL_HOURS = Array.from({ length: 24 }, (_, i) => i);

function loadStoredHours(): number[] | null {
  try {
    const raw = localStorage.getItem(HOURS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((h) => Number.isInteger(h) && h >= 0 && h <= 23);
  } catch { return null; }
}

function loadStoredMinN(): number {
  try {
    const raw = localStorage.getItem(MIN_N_STORAGE_KEY);
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n >= 1 ? n : 10;
  } catch { return 10; }
}

function fmtPct(x: number | null): string {
  if (x == null) return "—";
  return `${(x * 100).toFixed(0)}%`;
}

function fmtR(x: number | null, withSign = false): string {
  if (x == null) return "—";
  const sign = withSign && x >= 0 ? "+" : "";
  return `${sign}${x.toFixed(2)}R`;
}

/**
 * Lift → diverging red/green color. Opacity scales with how close the bucket
 * is to `minN` so below-N cells still get directional color (just dimmer).
 * Min-N gates the ★ significance flag, not the color itself.
 */
function cellTone(b: BucketStats | undefined, minN: number): { bg: string; ring: string } {
  if (!b || b.n === 0) return { bg: "transparent", ring: "border-border/30" };
  const lift = b.expectancyLift ?? 0;
  // Clamp lift to ±0.6R for color saturation.
  const clamped = Math.max(-0.6, Math.min(0.6, lift));
  const intensity = Math.abs(clamped) / 0.6; // 0..1
  // Confidence: ramps 0 → 1 as n approaches 2 × minN, with a 0.25 floor so
  // small-N cells are still visibly colored (just dimmer than trusted cells).
  const conf = Math.max(0.25, Math.min(1, b.n / (minN * 2)));
  const alpha = (0.10 + 0.50 * intensity) * conf;
  // M9 fix: tokens, not raw rgba — so the heatmap follows the theme and
  // matches the chart canvas (which already reads --heat-positive/--heat-negative).
  const bg = clamped >= 0
    ? `hsl(var(--heat-positive) / ${alpha.toFixed(3)})`
    : `hsl(var(--heat-negative) / ${alpha.toFixed(3)})`;
  const ring = b.significant
    ? "border-primary/60"
    : b.belowMinN
      ? "border-dashed border-border/40"
      : "border-border/40";
  return { bg, ring };
}

export function IdealWindowHeatmap({ trades, symbolResolver, allSymbols }: Props) {
  const { data: settings } = useUserSettings();
  const tz = settings?.display_timezone || "America/New_York";

  // Regime options (rotational/transitional + user customs).
  const { data: regimeOptions = [] } = usePropertyOptions("regime", true);

  // S3.5: read groups + window from PairLabWalkForwardContext instead of
  // re-subscribing to `useSymbolGroups()` (extra query) and re-resolving the
  // walk-forward window (parity drift risk).
  const { wf, dateFrom, dateTo, groups } = usePairLabWalkForward();

  // Audit U-B1: use `useSearchParams` (React Router) instead of
  // `window.history.replaceState`, so `heatmapPair` participates in the
  // browser back-stack and any parent listeners re-render on change.
  const [searchParams, setSearchParams] = useSearchParams();

  const defaultScope = useMemo(() => {
    if (allSymbols.length === 0) return null;
    return `sym:${allSymbols[0]}`;
  }, [allSymbols]);

  const scope = searchParams.get("heatmapPair") || defaultScope;
  const setScope = useCallback(
    (next: string | null) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next) p.set("heatmapPair", next);
          else p.delete("heatmapPair");
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const [regime, setRegime] = useState<string>("any");
  const [direction, setDirection] = useState<string>("any");
  const [minN, setMinN] = useState<number>(() => loadStoredMinN());
  const [sortBy, setSortBy] = useState<"lift" | "expectancy" | "rate">("lift");
  const [selectedCell, setSelectedCell] = useState<{ hour: number; half: Half } | null>(null);

  // Close any drilled-in cell when the lens OR scope shifts (Audit U-B4).
  useEffect(() => {
    setSelectedCell(null);
  }, [wf.lens, wf.asOfMs, scope]);

  // M10 — Escape closes drill-down, parity with PairGridTab.
  useEffect(() => {
    if (!selectedCell) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedCell(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedCell]);

  // Resolve scope → effective pair label + wrapped resolver that collapses
  // group members into the group's name (so bucketTrades treats them as one).
  const { pair, effectiveResolver, activeGroup } = useMemo(() => {
    if (scope?.startsWith("grp:")) {
      const id = scope.slice(4);
      const g = groups.find((x) => x.id === id);
      if (g) {
        const set = new Set(g.symbols.map((s) => s.toUpperCase()));
        const wrapped = (raw: string) => {
          const c = symbolResolver(raw);
          return set.has(c.toUpperCase()) ? g.name : c;
        };
        return { pair: g.name, effectiveResolver: wrapped, activeGroup: g };
      }
    }
    const sym = scope?.startsWith("sym:") ? scope.slice(4) : null;
    return { pair: sym, effectiveResolver: symbolResolver, activeGroup: null };
  }, [scope, groups, symbolResolver]);

  // Hours-I-trade chip selector. Persisted in localStorage; default = hours
  // that have at least one tagged trade for the selected pair (or 7-11 + 20-21
  // when there's no signal yet).
  const [hours, setHoursState] = useState<number[]>(() => {
    const stored = loadStoredHours();
    return stored ?? [7, 8, 9, 10, 11, 20, 21];
  });
  const setHours = (next: number[]) => {
    const sorted = Array.from(new Set(next)).sort((a, b) => a - b);
    setHoursState(sorted);
    try { localStorage.setItem(HOURS_STORAGE_KEY, JSON.stringify(sorted)); } catch { /* ignore */ }
  };
  const toggleHour = (h: number) => {
    const next = hours.includes(h) ? hours.filter((x) => x !== h) : [...hours, h];
    setHours(next);
    // If we just removed the hour that was drilled into, close the panel.
    if (selectedCell && !next.includes(selectedCell.hour)) {
      setSelectedCell(null);
    }
  };
  const handleMinN = (n: number) => {
    setMinN(n);
    try { localStorage.setItem(MIN_N_STORAGE_KEY, String(n)); } catch { /* ignore */ }
  };

  const filters: IdealWindowFilters | null = useMemo(() => {
    if (pair == null) return null;
    return {
      pair,
      hours,
      regime: regime === "any" ? null : regime,
      direction: direction === "any" ? null : (direction as TradeDirection),
      minN,
      dateFrom,
      dateTo,
      recentN: 10,
    };
  }, [pair, hours, regime, direction, minN, dateFrom, dateTo]);

  const result = useMemo(() => {
    if (!filters) return null;
    return bucketTrades({ trades, filters, symbolResolver: effectiveResolver, timezone: tz });
  }, [filters, trades, effectiveResolver, tz]);

  const subGrid = useMemo(() => {
    if (!filters || !selectedCell) return null;
    return subGridFifteenMin({
      trades, filters, symbolResolver: effectiveResolver, timezone: tz,
      hour: selectedCell.hour, half: selectedCell.half,
    });
  }, [filters, selectedCell, trades, effectiveResolver, tz]);

  // Sorted hours for display (only the selected ones), ranked by best edge per sortBy.
  const displayHours = useMemo(() => {
    if (!result) return hours;
    const rank = (h: number) => {
      const a = result.byKey.get(`${h}|first`);
      const b = result.byKey.get(`${h}|second`);
      const candidates = [a, b].filter((x): x is BucketStats => !!x && !x.belowMinN);
      if (candidates.length === 0) return -Infinity;
      const score = (c: BucketStats) =>
        sortBy === "rate" ? (c.rate ?? 0)
        : sortBy === "expectancy" ? (c.expectancy ?? 0)
        : (c.expectancyLift ?? 0);
      return Math.max(...candidates.map(score));
    };
    return [...hours].sort((x, y) => rank(y) - rank(x));
  }, [result, hours, sortBy]);

  const totalTaggedTrades = useMemo(() => {
    let n = 0;
    for (const t of trades) {
      const v = (t.custom_fields && Object.keys(t.custom_fields).some((k) => k.startsWith("cf_ideal_entry_window")))
        ? 1 : 0;
      n += v;
    }
    return n;
  }, [trades]);

  if (!pair || allSymbols.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        No closed trades in scope.
      </Card>
    );
  }

  if (totalTaggedTrades === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground space-y-2">
        <div className="font-medium text-foreground">No hour setup observations yet.</div>
        <div className="text-xs leading-relaxed">
          Open any trade in the Journal and set the{" "}
          <span className="font-mono text-foreground">Ideal entry window</span> property to
          tag which half of the hour produced a working setup (✓) and which produced one
          that printed but failed (✗). After ~20 tagged trades per pair·hour·half, this
          heatmap surfaces statistically meaningful edges.
        </div>
      </Card>
    );
  }

  const baseline = result?.baseline;

  return (
    <Card className="p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start gap-2 flex-wrap">
        <Clock className="w-4 h-4 text-primary mt-0.5" />
        <div className="flex-1 min-w-[260px]">
          <h3 className="font-semibold">Ideal entry windows — quant view</h3>
          <p className="text-xs text-muted-foreground mt-1">
            For the selected pair, each hour-half cell shows worked-rate (Wilson 95% CI),
            expectancy in R (bootstrap 95% CI), and lift vs the pair's baseline.
            Color = expectancy lift, opacity = sample-size confidence, ★ = p&lt;0.05 vs
            baseline. Hours are in your display timezone ({tz}).
          </p>
        </div>
      </div>

      {/* Filters row */}
      <div className="grid gap-3 md:grid-cols-[minmax(160px,1fr)_minmax(140px,auto)_minmax(140px,auto)_minmax(120px,auto)_minmax(140px,auto)]">
        <div>
          <Label className="text-xs flex items-center gap-1.5">
            Scope
            {activeGroup && (
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: activeGroup.color ?? "hsl(var(--primary))" }}
                aria-hidden
              />
            )}
          </Label>
          <Select
            value={scope ?? ""}
            onValueChange={(v) => { setScope(v); setSelectedCell(null); }}
          >
            <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue placeholder="Pick pair or group" /></SelectTrigger>
            <SelectContent>
              {groups.length > 0 && (
                <>
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                    Groups (merged)
                  </div>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={`grp:${g.id}`}>
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="inline-block w-2 h-2 rounded-full"
                          style={{ backgroundColor: g.color ?? "hsl(var(--primary))" }}
                          aria-hidden
                        />
                        {g.name}
                        <span className="text-muted-foreground text-[10px]">· {g.symbols.length}</span>
                      </span>
                    </SelectItem>
                  ))}
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground border-t mt-1 pt-2">
                    Individual pairs
                  </div>
                </>
              )}
              {allSymbols.map((s) => (
                <SelectItem key={s} value={`sym:${s}`}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {activeGroup && (
            <div className="mt-1 text-[10px] text-muted-foreground truncate" title={activeGroup.symbols.join(", ")}>
              Merging: {activeGroup.symbols.join(", ")}
            </div>
          )}
        </div>
        <div>
          <Label className="text-xs">Regime</Label>
          <Select value={regime} onValueChange={(v) => { setRegime(v); setSelectedCell(null); }}>
            <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any regime</SelectItem>
              {regimeOptions.map((o) => (
                <SelectItem key={o.id} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Direction</Label>
          <Select value={direction} onValueChange={(v) => { setDirection(v); setSelectedCell(null); }}>
            <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any direction</SelectItem>
              <SelectItem value="buy">Long</SelectItem>
              <SelectItem value="sell">Short</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Min N</Label>
          <Select value={String(minN)} onValueChange={(v) => handleMinN(parseInt(v, 10))}>
            <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[10, 20, 30, 50].map((n) => (
                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Sort by</Label>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
            <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="lift">Lift vs baseline</SelectItem>
              <SelectItem value="expectancy">Expectancy</SelectItem>
              <SelectItem value="rate">Worked rate</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Hour chip selector */}
      <div>
        <Label className="text-xs">Hours I trade</Label>
        <div className="mt-1 flex flex-wrap gap-1">
          {ALL_HOURS.map((h) => {
            const on = hours.includes(h);
            return (
              <button
                key={h}
                type="button"
                onClick={() => toggleHour(h)}
                className={cn(
                  "h-7 min-w-[36px] rounded-md border px-2 text-xs font-mono-numbers transition-colors",
                  on
                    ? "border-primary/60 bg-primary/15 text-foreground"
                    : "border-border/40 text-muted-foreground hover:border-border",
                )}
              >
                {String(h).padStart(2, "0")}
              </button>
            );
          })}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[11px]"
            onClick={() => setHours([])}
            disabled={hours.length === 0}
          >
            Clear
          </Button>
        </div>
      </div>

      {/* Walk-forward lens is owned by Overview tab — no duplicate slider here. */}



      {/* Baseline strip */}
      {baseline && (
        <div className="rounded-md border border-border/60 bg-muted/10 p-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-xs">
          <span className="uppercase tracking-wider text-muted-foreground">Baseline · {pair}</span>
          <span>
            <span className="text-muted-foreground">Worked</span>{" "}
            <span className="font-mono-numbers font-semibold">
              {fmtPct(baseline.rate)} ({baseline.worked}/{baseline.n})
            </span>
          </span>
          <span>
            <span className="text-muted-foreground">Expectancy</span>{" "}
            <span className="font-mono-numbers font-semibold">
              {fmtR(baseline.expectancy, true)}
            </span>
            <span className="text-muted-foreground"> · n={baseline.rSamples}</span>
          </span>
          {regime !== "any" && <Badge variant="outline" className="text-[10px]">Regime: {regime}</Badge>}
          {direction !== "any" && <Badge variant="outline" className="text-[10px]">{direction === "buy" ? "Long" : "Short"} only</Badge>}
        </div>
      )}

      {/* Heatmap */}
      {hours.length === 0 ? (
        <Card className="p-4 text-xs text-muted-foreground border-dashed">
          Select at least one hour above to populate the heatmap.
        </Card>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-separate border-spacing-0">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="text-left py-2 pr-3 font-medium">Hour</th>
                <th className="text-left py-2 px-2 font-medium">1st half (:00–:30)</th>
                <th className="text-left py-2 px-2 font-medium">2nd half (:30–:60)</th>
              </tr>
            </thead>
            <tbody>
              {displayHours.map((h) => {
                const first = result?.byKey.get(`${h}|first`);
                const second = result?.byKey.get(`${h}|second`);
                return (
                  <tr key={h} className="align-top">
                    <td className="py-2 pr-3 font-mono-numbers font-medium text-foreground/80 align-middle">
                      {String(h).padStart(2, "0")}:00
                    </td>
                    {(["first", "second"] as const).map((half) => {
                      const b = half === "first" ? first : second;
                      const tone = cellTone(b, minN);
                      const isSelected = selectedCell?.hour === h && selectedCell.half === half;
                      return (
                        <td key={half} className="py-1 px-1">
                          <button
                            type="button"
                            onClick={() => b && b.n > 0 && setSelectedCell({ hour: h, half })}
                            disabled={!b || b.n === 0}
                            aria-pressed={isSelected}
                            aria-label={
                              !b || b.n === 0
                                ? `Hour ${h} ${half === "first" ? "00-29" : "30-59"} — no data`
                                : `Hour ${h} ${half === "first" ? "00-29" : "30-59"} — N=${b.n}, worked ${fmtPct(b.rate)}, expR ${fmtR(b.expectancy)}${b.significant ? ", FDR significant" : ""}`
                            }
                            className={cn(
                              "w-full text-left rounded-md border p-2 transition-all",
                              tone.ring,
                              isSelected && "ring-2 ring-primary/70",
                              b && b.n > 0 ? "cursor-pointer hover:border-foreground/40" : "cursor-default",
                            )}
                            style={{ backgroundColor: tone.bg }}
                          >
                            {!b || b.n === 0 ? (
                              <span className="text-muted-foreground/50 font-mono-numbers">no data</span>
                            ) : (
                              <div className="space-y-0.5 font-mono-numbers">
                                <div className="flex items-center gap-1.5">
                                  <span className={cn(
                                    "font-semibold tabular-nums",
                                    b.belowMinN && "text-muted-foreground",
                                  )}>
                                    {fmtPct(b.rate)}
                                  </span>
                                  <span className={cn(
                                    "tabular-nums",
                                    b.belowMinN && "text-muted-foreground",
                                  )}>
                                    · {fmtR(b.expectancy)}
                                  </span>
                                  {b.significant && (
                                    <Star className="w-3 h-3 fill-primary text-primary" />
                                  )}
                                  {b.drift != null && Math.abs(b.drift) >= 0.15 && b.recentSamples >= 5 && (
                                    b.drift > 0 ? (
                                      <span className="inline-flex items-center gap-0.5 text-emerald-500 text-[10px]" title={`Recent ${b.recentSamples} setups: ${fmtPct(b.recentRate)} (drift ${(b.drift * 100).toFixed(0)}pp)`}>
                                        <TrendingUp className="w-3 h-3" />{(b.drift * 100).toFixed(0)}pp
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-0.5 text-red-500 text-[10px]" title={`Recent ${b.recentSamples} setups: ${fmtPct(b.recentRate)} (drift ${(b.drift * 100).toFixed(0)}pp)`}>
                                        <TrendingDown className="w-3 h-3" />{(b.drift * 100).toFixed(0)}pp
                                      </span>
                                    )
                                  )}
                                </div>
                                <div className="text-[10px] text-muted-foreground tabular-nums">
                                  lift {fmtR(b.expectancyLift, true)} · n={b.n}
                                  {b.belowMinN && <span className="ml-1 opacity-70">(below N)</span>}
                                </div>
                              </div>
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Drill-down */}
      {selectedCell && result && (() => {
        const b = result.byKey.get(`${selectedCell.hour}|${selectedCell.half}`);
        if (!b) return null;
        return (
          <Card className="p-4 border-primary/30 bg-primary/[0.02] space-y-3">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div className="font-semibold text-sm">
                {pair} · {String(selectedCell.hour).padStart(2, "0")}:00 ·{" "}
                {selectedCell.half === "first" ? "1st half" : "2nd half"}
              </div>
              <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => setSelectedCell(null)}>
                Close
              </Button>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 text-xs">
              <div className="rounded-md border border-border/40 p-2 space-y-1">
                <div className="text-muted-foreground uppercase tracking-wider text-[10px]">Worked rate</div>
                <div className="font-mono-numbers">
                  <span className="font-semibold">{b.worked} / {b.n}</span>{" "}
                  <span className="text-muted-foreground">({fmtPct(b.rate)})</span>
                </div>
                {b.rateCI && (
                  <div className="text-[11px] text-muted-foreground font-mono-numbers">
                    Wilson 95% CI: {fmtPct(b.rateCI[0])} – {fmtPct(b.rateCI[1])}
                  </div>
                )}
                {b.pValue != null && (
                  <div className="text-[11px] text-muted-foreground font-mono-numbers">
                    vs baseline: p = {b.pValue.toFixed(3)}
                    {b.significant && <span className="ml-1 text-primary">★ significant</span>}
                  </div>
                )}
              </div>
              <div className="rounded-md border border-border/40 p-2 space-y-1">
                <div className="text-muted-foreground uppercase tracking-wider text-[10px]">Expectancy</div>
                <div className="font-mono-numbers font-semibold">{fmtR(b.expectancy)}</div>
                {b.expectancyCI && (
                  <div className="text-[11px] text-muted-foreground font-mono-numbers">
                    Bootstrap 95% CI: {fmtR(b.expectancyCI[0])} – {fmtR(b.expectancyCI[1])}
                  </div>
                )}
                <div className="text-[11px] text-muted-foreground font-mono-numbers">
                  Lift vs baseline: {fmtR(b.expectancyLift, true)} · R samples: {b.rSamples}
                </div>
              </div>
            </div>


            {/* Walk-forward chart: cumulative rate + Wilson band + rolling-10 + per-event dots */}
            {b.events.length >= 3 && (() => {
              const cum = cumulativeSeries(b.events);
              const roll = rollingRateSeries(b.events, Math.min(10, b.events.length));
              const W = 480, H = 110, padL = 28, padR = 8, padT = 8, padB = 18;
              const innerW = W - padL - padR;
              const innerH = H - padT - padB;
              const n = b.events.length;
              const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
              const y = (r: number) => padT + (1 - r) * innerH;
              const bandPath =
                "M" + cum.map((p, i) => `${x(i)},${y(p.ci[1])}`).join(" L") +
                " L" + [...cum].reverse().map((p, j) => `${x(n - 1 - j)},${y(p.ci[0])}`).join(" L") + " Z";
              const cumPath = "M" + cum.map((p, i) => `${x(i)},${y(p.rate)}`).join(" L");
              const rollPath = "M" + roll.map((p, i) => `${x(i)},${y(p.rate)}`).join(" L");
              const yAxisVals = [0, 0.25, 0.5, 0.75, 1];
              return (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-3">
                    <span>Walk-forward (causal)</span>
                    <span className="inline-flex items-center gap-1 normal-case tracking-normal">
                      <span className="inline-block w-3 h-0.5 bg-primary" /> cumulative
                    </span>
                    <span className="inline-flex items-center gap-1 normal-case tracking-normal">
                      <span className="inline-block w-3 h-0.5 bg-orange-400" /> rolling-10
                    </span>
                    <span className="inline-flex items-center gap-1 normal-case tracking-normal">
                      <span className="inline-block w-3 h-2 bg-primary/15" /> Wilson 95% CI
                    </span>
                  </div>
                  <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="block">
                    {yAxisVals.map((v) => (
                      <g key={v}>
                        <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)}
                          stroke="hsl(var(--border))" strokeWidth={0.5} strokeDasharray={v === 0.5 ? undefined : "2 3"} />
                        <text x={padL - 4} y={y(v) + 3} textAnchor="end"
                          className="fill-muted-foreground" fontSize={9}>{Math.round(v * 100)}%</text>
                      </g>
                    ))}
                    <path d={bandPath} fill="hsl(var(--primary))" fillOpacity={0.12} />
                    <path d={cumPath} stroke="hsl(var(--primary))" strokeWidth={1.5} fill="none" />
                    <path d={rollPath} stroke="hsl(var(--chart-trail))" strokeWidth={1.2} fill="none" strokeDasharray="3 2" />
                    {b.events.map((e, i) => (
                      <circle key={i} cx={x(i)} cy={y(e.worked ? 1 : 0)} r={1.8}
                        fill={e.worked ? "hsl(var(--heat-positive))" : "hsl(var(--heat-negative))"} fillOpacity={0.7} />
                    ))}
                  </svg>
                  <div className="text-[10px] text-muted-foreground mt-0.5 flex justify-between font-mono-numbers">
                    <span>{new Date(b.events[0].ts).toISOString().slice(0, 10)}</span>
                    <span>{b.events.length} events</span>
                    <span>{new Date(b.events[n - 1].ts).toISOString().slice(0, 10)}</span>
                  </div>
                </div>
              );
            })()}

            {/* 15-min sub-grid */}
            {subGrid && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  15-min sub-grid (entry minute within the half)
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {subGrid.map((bin) => (
                    <div key={bin.startMinute} className="rounded-md border border-border/40 p-2 text-xs font-mono-numbers">
                      <div className="text-foreground/80">
                        :{String(bin.startMinute).padStart(2, "0")} – :{String(bin.endMinute).padStart(2, "0")}
                      </div>
                      {bin.n === 0 ? (
                        <div className="text-muted-foreground/60 text-[11px]">no data</div>
                      ) : (
                        <>
                          <div className="font-semibold">{fmtPct(bin.rate)} · {fmtR(bin.expectancy)}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {bin.worked}W / {bin.failed}L · n={bin.n}
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
                <div className="text-[10px] text-muted-foreground mt-1 italic">
                  Sub-grid samples are small — directional only, no CI.
                </div>
              </div>
            )}
          </Card>
        );
      })()}

      <p className="text-[11px] text-muted-foreground border-t pt-3 leading-relaxed flex items-start gap-1.5">
        <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
        <span>
          Setup worked/failed comes from the per-trade "Ideal entry window" property —
          decoupled from the trade's own W/L. R-multiples for expectancy come from{" "}
          <span className="font-mono">r_multiple_actual</span>. Cells with n &lt; {minN} are
          rendered greyed and excluded from the significance flag. Filters condition the
          baseline as well as the cells.
        </span>
      </p>
    </Card>
  );
}
