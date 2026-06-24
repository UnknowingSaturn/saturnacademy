import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, FlaskConical, Info, Shield } from "lucide-react";
import { PageIntroBanner } from "@/components/tutorial/PageIntroBanner";
import { usePairLab } from "@/hooks/usePairLab";
import { BucketGrid } from "@/components/pair-lab/BucketGrid";

import { QuantNotePanel } from "@/components/pair-lab/QuantNotePanel";
import { SymbolAliasManager } from "@/components/pair-lab/SymbolAliasManager";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { StrategyRanker } from "@/components/pair-lab/StrategyRanker";
import { SimulatorProfileSettings } from "@/components/pair-lab/SimulatorProfileSettings";
import { StrategyLab } from "@/components/pair-lab/StrategyLab";
import { IntraHourTiming } from "@/components/pair-lab/IntraHourTiming";
import { IdealWindowHeatmap } from "@/components/pair-lab/IdealWindowHeatmap";
import { normalizeSession } from "@/lib/pairLabMath";

export default function PairLab() {
  const [profile, setProfile] = useState<string>("any");
  const [propFirmMode, setPropFirmMode] = useState(true);
  const [selected, setSelected] = useState<{ symbol: string; session: string } | null>(null);

  const data = usePairLab({
    profile: profile === "any" ? null : profile,
    propFirmMode,
  });

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

  if (data.isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

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
          <TabsTrigger value="grid">Grid</TabsTrigger>
          <TabsTrigger value="simulator">Simulator</TabsTrigger>
          <TabsTrigger value="strategy">Strategy lab</TabsTrigger>
          <TabsTrigger value="timing">Intra-hour timing</TabsTrigger>
          <TabsTrigger value="aliases">Symbol aliases</TabsTrigger>
        </TabsList>

        <TabsContent value="windows" className="mt-4">
          <IdealWindowHeatmap
            trades={data.trades}
            symbolResolver={data.symbolResolver}
            allSymbols={data.symbols}
          />
        </TabsContent>

        <TabsContent value="grid" className="space-y-6 mt-4">
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
            onSelect={setSelected}
          />

          {selectedBucket ? (
            <QuantNotePanel
              bucket={selectedBucket}
              baseline={data.baseline}
              propFirm={propFirmMode ? data.propFirm : null}
            />
          ) : (
            <Card className="p-6 text-sm text-muted-foreground text-center">
              Select a cell in the grid to see this bucket's stats and generate an AI quant note.
              Actionable parameters live in the Simulator tab.
            </Card>
          )}
        </TabsContent>

        <TabsContent value="simulator" className="space-y-4 mt-4">
          {(() => {
            // Scope trades for the simulator: selected bucket if any, else all.
            const scopedTrades = selected
              ? data.trades.filter((t) => {
                  if (!t.symbol) return false;
                  const canonical = data.symbolResolver(t.symbol);
                  if (canonical !== selected.symbol) return false;
                  if (selected.session !== "All sessions") {
                    return normalizeSession(t.session) === selected.session;
                  }
                  return true;
                })
              : data.trades;
            const scopeLabel = selected
              ? `${selected.symbol} · ${selected.session}`
              : "All trades in scope";
            const sourceLabel =
              data.simSource === "active_account" ? "active account" : "simulator profile";
            return (
              <>
                <Card className="p-3 text-xs text-muted-foreground flex items-start justify-between gap-3">
                  <span>
                    Simulating <span className="text-foreground font-medium">{scopeLabel}</span> ·{" "}
                    <span className="text-foreground">
                      ${data.simBalance.toLocaleString()}
                    </span>{" "}
                    from {sourceLabel}.
                    {selected
                      ? " Click another cell in the Grid tab to switch scope."
                      : " Select a cell in the Grid tab to narrow to one pair × session."}
                  </span>
                  <SimulatorProfileSettings />
                </Card>
                {data.simBalance > 0 ? (
                  <>
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
                  </>
                ) : (
                  <Card className="p-6 text-sm text-muted-foreground text-center">
                    Set a notional balance in your simulator profile to convert R into $.
                  </Card>
                )}
              </>
            );
          })()}
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

        <TabsContent value="timing" className="mt-4">
          <IntraHourTiming
            trades={data.trades}
            symbolResolver={data.symbolResolver}
          />
        </TabsContent>

        <TabsContent value="aliases" className="mt-4">
          <SymbolAliasManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}
