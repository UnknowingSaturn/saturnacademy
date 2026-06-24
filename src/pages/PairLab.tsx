import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, FlaskConical, Info, Shield, X, Layers } from "lucide-react";
import { PageIntroBanner } from "@/components/tutorial/PageIntroBanner";
import { usePairLab } from "@/hooks/usePairLab";
import { useSymbolGroups } from "@/hooks/useSymbolGroups";
import { BucketGrid } from "@/components/pair-lab/BucketGrid";

import { QuantNotePanel } from "@/components/pair-lab/QuantNotePanel";
import { SymbolAliasManager } from "@/components/pair-lab/SymbolAliasManager";
import { SymbolGroupManager } from "@/components/pair-lab/SymbolGroupManager";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { StrategyRanker } from "@/components/pair-lab/StrategyRanker";
import { SimulatorProfileSettings } from "@/components/pair-lab/SimulatorProfileSettings";
import { StrategyLab } from "@/components/pair-lab/StrategyLab";
import { IdealWindowHeatmap } from "@/components/pair-lab/IdealWindowHeatmap";
import { WalkForwardControls, resolveWindow, type WalkForwardState } from "@/components/pair-lab/WalkForwardControls";
import { OutOfSamplePanel } from "@/components/pair-lab/OutOfSamplePanel";
import { normalizeSession } from "@/lib/pairLabMath";

type Selected = { symbol: string; session: string } | null;

export default function PairLab() {
  const [searchParams, setSearchParams] = useSearchParams();

  const profile = searchParams.get("profile") ?? "any";
  const propFirmMode = searchParams.get("pf") !== "0";
  const selected: Selected = (() => {
    const symbol = searchParams.get("symbol");
    const session = searchParams.get("session");
    if (!symbol || !session) return null;
    return { symbol, session };
  })();

  const setProfile = (v: string) => {
    const next = new URLSearchParams(searchParams);
    if (v === "any") next.delete("profile"); else next.set("profile", v);
    setSearchParams(next, { replace: true });
  };
  const setPropFirmMode = (v: boolean) => {
    const next = new URLSearchParams(searchParams);
    if (v) next.delete("pf"); else next.set("pf", "0");
    setSearchParams(next, { replace: true });
  };
  const setSelected = (cell: Selected) => {
    const next = new URLSearchParams(searchParams);
    if (!cell) {
      next.delete("symbol");
      next.delete("session");
    } else {
      next.set("symbol", cell.symbol);
      next.set("session", cell.session);
    }
    setSearchParams(next, { replace: true });
  };

  const headerRef = useRef<HTMLDivElement | null>(null);

  // Walk-forward state — Analyze tab only. Ideal windows owns its own state.
  const { groups } = useSymbolGroups();
  // Scope: "all" | "grp:<id>"
  const scope = searchParams.get("scope") ?? "all";
  const activeGroup = useMemo(() => {
    if (!scope.startsWith("grp:")) return null;
    const id = scope.slice(4);
    return groups.find((g) => g.id === id) ?? null;
  }, [scope, groups]);

  // Use unfiltered hook once to find the date bounds of the user's data.
  const allData = usePairLab({
    profile: profile === "any" ? null : profile,
    propFirmMode,
  });

  const { minMs, maxMs } = useMemo(() => {
    const ts = allData.trades
      .filter((t) => !t.is_open && !t.is_archived && t.entry_time)
      .map((t) => new Date(String(t.entry_time)).getTime())
      .filter((n) => Number.isFinite(n));
    if (ts.length === 0) {
      const now = Date.now();
      return { minMs: now - 90 * 86_400_000, maxMs: now };
    }
    return { minMs: Math.min(...ts), maxMs: Math.max(...ts) };
  }, [allData.trades]);

  const [wf, setWf] = useState<WalkForwardState>({ lens: "all", asOfMs: Date.now() });
  // Clamp asOf into actual data range once data arrives.
  useEffect(() => {
    setWf((s) => ({ ...s, asOfMs: Math.max(minMs, Math.min(maxMs, s.asOfMs)) }));
  }, [minMs, maxMs]);

  const { dateFrom, dateTo } = useMemo(() => resolveWindow(wf), [wf]);

  const data = usePairLab({
    profile: profile === "any" ? null : profile,
    propFirmMode,
    dateFrom,
    dateTo,
    groupOverride: activeGroup ? { name: activeGroup.name, symbols: activeGroup.symbols } : null,
  });

  const setScope = (v: string) => {
    const next = new URLSearchParams(searchParams);
    if (v === "all") next.delete("scope"); else next.set("scope", v);
    next.delete("symbol");
    next.delete("session");
    setSearchParams(next, { replace: true });
  };

  // Scroll selection header into view when a cell is picked.
  useEffect(() => {
    if (!selected) return;
    requestAnimationFrame(() => {
      headerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [selected?.symbol, selected?.session]);

  // Esc clears the current selection.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.symbol, selected?.session]);

  const selectedBucket = useMemo(() => {
    if (!selected) return null;
    if (selected.session === "All sessions") {
      return data.perRow.find((r) => r.key.symbol === selected.symbol) ?? null;
    }
    return (
      data.perCell.find(
        (c) => c.key.symbol === selected.symbol && c.key.session === selected.session,
      ) ?? null
    );
  }, [selected, data.perRow, data.perCell]);

  const scopedTrades = useMemo(() => {
    if (!selected) return data.trades;
    return data.trades.filter((t) => {
      if (!t.symbol) return false;
      const canonical = data.symbolResolver(t.symbol);
      if (canonical !== selected.symbol) return false;
      if (selected.session !== "All sessions") {
        return normalizeSession(t.session) === selected.session;
      }
      return true;
    });
  }, [selected, data.trades, data.symbolResolver]);

  if (data.isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const scopeLabel = selected ? `${selected.symbol} · ${selected.session}` : "All trades in scope";
  const sourceLabel =
    data.simSource === "active_account" ? "active account" : "simulator profile";

  return (
    <div className="space-y-6 p-6 animate-fade-in">
      <PageIntroBanner
        routeKey="pair-lab"
        title="Pair Lab — find optimal parameters per pair × session"
        body="Buckets your closed trades by canonical symbol and session, then derives suggested stop, TP ladder (incl. a win-rate-maximizing TP1*), and risk size from your MFE / MAE / TP-hit / ideal-SL fields. Toggle Prop-firm mode to cap risk against your simulator profile's daily drawdown budget."
      />

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <FlaskConical className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Pair Lab</h1>
            <p className="text-xs text-muted-foreground">
              {data.totalTrades} closed trades in scope · {data.perCell.length} cells · {data.perRow.length} canonical pairs
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-1.5">
            <Shield className="w-3.5 h-3.5 text-primary" />
            <Label htmlFor="pf-mode" className="text-xs cursor-pointer">Prop-firm mode</Label>
            <Switch id="pf-mode" checked={propFirmMode} onCheckedChange={setPropFirmMode} />
          </div>
          <Select value={profile} onValueChange={setProfile}>
            <SelectTrigger className="w-[170px]">
              <SelectValue placeholder="Profile" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any profile</SelectItem>
              <SelectItem value="continuation">Continuation</SelectItem>
              <SelectItem value="range">Range</SelectItem>
              <SelectItem value="reversal">Reversal</SelectItem>
              <SelectItem value="hindsight">Hindsight</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {data.missingFields && (
        <Card className="p-4 flex items-start gap-3 border-amber-500/30 bg-amber-500/5">
          <Info className="w-4 h-4 text-amber-500 mt-0.5" />
          <div className="text-sm">
            <div className="font-medium mb-1">No excursion fields detected.</div>
            <div className="text-muted-foreground">
              Add custom fields named <span className="font-mono text-foreground">MFE (RR)</span>,{" "}
              <span className="font-mono text-foreground">MAE</span>, and{" "}
              <span className="font-mono text-foreground">Ideal Stop-Loss</span> from
              the Journal settings, then fill them in on your closed trades to power this page.
            </div>
          </div>
        </Card>
      )}

      {data.partialFillFlag && (
        <TooltipProvider delayDuration={150}>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Info className="w-3.5 h-3.5 text-amber-500" />
            <span>
              {data.partialFillFlag.trades} trades in {data.partialFillFlag.groups} groups may be partial-fill duplicates.
            </span>
            <Tooltip>
              <TooltipTrigger className="underline decoration-dotted">why</TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                Trades sharing account · symbol · entry-minute are counted independently today, which can inflate sample sizes and distort MFE/MAE quantiles. Consolidation isn't implemented yet.
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      )}

      <Tabs defaultValue="windows">
        <TabsList>
          <TabsTrigger value="windows">Ideal windows</TabsTrigger>
          <TabsTrigger value="analyze">Analyze</TabsTrigger>
          <TabsTrigger value="strategy">Strategy lab</TabsTrigger>
          <TabsTrigger value="groups">Pair groups</TabsTrigger>
          <TabsTrigger value="aliases">Symbol aliases</TabsTrigger>
        </TabsList>

        <TabsContent value="windows" className="mt-4">
          <IdealWindowHeatmap
            trades={data.trades}
            symbolResolver={data.symbolResolver}
            allSymbols={data.symbols}
          />
        </TabsContent>

        <TabsContent value="analyze" className="space-y-6 mt-4">
          {/* Walk-forward + scope controls */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 items-stretch">
            <WalkForwardControls state={wf} onChange={setWf} minMs={minMs} maxMs={maxMs} />
            <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/10 p-3">
              <Layers className="w-3.5 h-3.5 text-muted-foreground" />
              <Label className="text-xs">Scope</Label>
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger className="h-8 w-[200px] text-xs">
                  <SelectValue placeholder="All pairs" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All pairs (individual)</SelectItem>
                  {groups.length > 0 && (
                    <SelectGroup>
                      <SelectLabel className="text-[10px] uppercase tracking-wider">Groups (merged)</SelectLabel>
                      {groups.map((g) => (
                        <SelectItem key={g.id} value={`grp:${g.id}`}>
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="w-2 h-2 rounded-full inline-block"
                              style={{ backgroundColor: g.color ?? "hsl(var(--primary))" }}
                            />
                            {g.name}
                            <span className="text-muted-foreground text-[10px]">· {g.symbols.length}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
              {activeGroup && (
                <span className="text-[10px] text-muted-foreground max-w-[180px] truncate" title={activeGroup.symbols.join(", ")}>
                  merging {activeGroup.symbols.length}
                </span>
              )}
            </div>
          </div>

          {(() => {
            const closed = data.trades.filter((t) => !t.is_open && !t.is_archived && t.net_pnl != null);
            const withSl = closed.filter((t) => t.sl_initial != null && t.entry_price != null).length;
            const coverage = closed.length > 0 ? withSl / closed.length : 1;
            if (closed.length >= 10 && coverage < 0.7) {
              return (
                <Card className="p-4 flex items-start gap-3 border-amber-500/30 bg-amber-500/5">
                  <Info className="w-4 h-4 text-amber-500 mt-0.5" />
                  <div className="text-sm">
                    <div className="font-medium mb-1">
                      Only {withSl} of {closed.length} closed trades have <code className="text-xs">sl_initial</code> + <code className="text-xs">entry_price</code> recorded.
                    </div>
                    <div className="text-muted-foreground text-xs leading-relaxed">
                      MAE and Ideal-SL are logged in broker ticks; they need each trade's initial-SL distance to convert into R.
                      Trades without it are ineligible for MAE-based stop-out detection and for the "Tighten SL → ideal" preset.
                      Fill SL in the journal to unlock those rows.
                    </div>
                  </div>
                </Card>
              );
            }
            return null;
          })()}

          {/* Baseline summary */}
          <Card className="p-4">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">Baseline</span>
              <span><span className="text-muted-foreground">N</span> <span className="font-mono-numbers font-semibold">{data.baseline.n}</span></span>
              <span><span className="text-muted-foreground">Win rate</span> <span className="font-mono-numbers font-semibold">{(data.baseline.winRate * 100).toFixed(1)}%</span></span>
              <span><span className="text-muted-foreground">Expected R</span> <span className="font-mono-numbers font-semibold">{(data.baseline.expectedR >= 0 ? "+" : "") + data.baseline.expectedR.toFixed(2)}R</span></span>
              <span><span className="text-muted-foreground">MFE p75</span> <span className="font-mono-numbers font-semibold">{data.baseline.mfeP75?.toFixed(2) ?? "—"}R</span></span>
              <span><span className="text-muted-foreground">MAE p75</span> <span className="font-mono-numbers font-semibold">{data.baseline.maeP75 != null ? `${data.baseline.maeP75.toFixed(2)}R` : "—"}</span></span>
              {data.baseline.recommendation.suggestedRiskPct != null && (
                <Badge variant="outline">Baseline ¼-Kelly: {data.baseline.recommendation.suggestedRiskPct.toFixed(2)}%</Badge>
              )}
              {propFirmMode && data.propFirm && data.propFirm.dailyLossDollars != null && (
                <Badge variant="outline" className="border-primary/40 text-primary">
                  PF budget: ${data.propFirm.dailyLossDollars.toFixed(0)}/day
                </Badge>
              )}
            </div>
          </Card>

          <BucketGrid
            symbols={data.symbols}
            sessions={data.sessions}
            perCell={data.perCell}
            perRow={data.perRow}
            selected={selected}
            onSelect={(cell) => setSelected(cell)}
          />

          {/* Out-of-sample split — train/test integrity check within the active window. */}
          {data.totalTrades >= 30 && (
            <OutOfSamplePanel
              trades={data.trades}
              fieldKeys={data.fieldKeys}
              symbolResolver={data.symbolResolver}
              propFirm={propFirmMode ? data.propFirm : null}
              dateFrom={dateFrom}
              dateTo={dateTo}
            />
          )}



          {/* Sticky selection header — always rendered, content changes with scope */}
          <div
            ref={headerRef}
            className="sticky top-0 z-10 -mx-6 px-6 py-3 bg-background/95 backdrop-blur border-y border-border/60 scroll-mt-4"
          >
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-sm flex-wrap">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Simulating</span>
                <span className="font-medium">{scopeLabel}</span>
                <span className="text-xs text-muted-foreground">
                  · ${data.simBalance.toLocaleString()} from {sourceLabel}
                </span>
                {selected && (
                  <span className="text-[10px] text-muted-foreground/70 ml-1">
                    (Esc to clear)
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <SimulatorProfileSettings />
                {selected && (
                  <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                    <X className="w-3 h-3 mr-1" />
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </div>

          {selectedBucket && (
            <QuantNotePanel
              bucket={selectedBucket}
              baseline={data.baseline}
              propFirm={propFirmMode ? data.propFirm : null}
            />
          )}

          {data.simBalance > 0 ? (
            <StrategyRanker
              trades={scopedTrades}
              fieldKeys={data.fieldKeys}
              balance={data.simBalance}
              propFirm={propFirmMode ? data.propFirm : null}
              scopeLabel={scopeLabel}
              defaultRiskPct={data.defaultSimRiskPct}
              trailCapture={data.trailCapture}
              effectiveTrailCapture={data.effectiveTrailCapture}
            />
          ) : (
            <Card className="p-6 text-sm text-muted-foreground text-center">
              Set a notional balance in your simulator profile to convert R into $.
            </Card>
          )}
        </TabsContent>


        <TabsContent value="strategy" className="mt-4">
          <StrategyLab
            trades={data.trades}
            defaultAccountSize={data.simBalance > 0 ? data.simBalance : 100_000}
            dailyLossDollars={propFirmMode ? (data.propFirm?.dailyLossDollars ?? null) : null}
            maxDrawdownDollars={propFirmMode ? (data.propFirm?.maxDrawdownDollars ?? null) : null}
            hasPropFirmProfile={propFirmMode && data.propFirm != null && data.propFirm.dailyLossDollars != null}
          />
        </TabsContent>

        <TabsContent value="groups" className="mt-4">
          <SymbolGroupManager availableSymbols={data.symbols} />
        </TabsContent>

        <TabsContent value="aliases" className="mt-4">
          <SymbolAliasManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}
