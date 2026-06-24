// ============================================================================
// Overview tab — single surface for walk-forward lens + filters + baseline.
// All controls write into URL + PairLabWalkForwardContext so every other tab
// (Pair Grid, Ideal Windows, Strategy) reads from the same window.
// ============================================================================

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info, Layers, Shield, AlertTriangle, Clock } from "lucide-react";
import { WalkForwardControls } from "@/components/pair-lab/WalkForwardControls";
import { useSymbolGroups } from "@/hooks/useSymbolGroups";
import { usePairLabWalkForward } from "@/contexts/PairLabWalkForwardContext";
import { classifySymbol, getTickSizeOverrides } from "@/lib/symbolMapping";
import { normalizeSymbol } from "../../../../shared/quant/symbolAliasing";
import type { usePairLab } from "@/hooks/usePairLab";

type PairLabData = ReturnType<typeof usePairLab>;

interface Props {
  data: PairLabData;
  profile: string;
  setProfile: (v: string) => void;
  propFirmMode: boolean;
  setPropFirmMode: (v: boolean) => void;
  includeUnrealized: boolean;
  setIncludeUnrealized: (v: boolean) => void;
  /** Include trades with NULL account_id even when an account is selected. */
  includeUnassigned: boolean;
  setIncludeUnassigned: (v: boolean) => void;
  scope: string;
  setScope: (v: string) => void;
}

export function OverviewTab({
  data,
  profile,
  setProfile,
  propFirmMode,
  setPropFirmMode,
  includeUnrealized,
  setIncludeUnrealized,
  includeUnassigned,
  setIncludeUnassigned,
  scope,
  setScope,
}: Props) {

  const { wf, setWf, minMs, maxMs } = usePairLabWalkForward();
  const { groups } = useSymbolGroups();
  const activeGroup = useMemo(() => {
    if (!scope.startsWith("grp:")) return null;
    return groups.find((g) => g.id === scope.slice(4)) ?? null;
  }, [scope, groups]);

  const closed = data.trades.filter(
    (t) => !t.is_open && !t.is_archived && t.net_pnl != null,
  );
  const withSl = closed.filter(
    (t) => t.sl_initial != null && t.entry_price != null,
  ).length;
  const slCoverage = closed.length > 0 ? withSl / closed.length : 1;
  const slWarn = closed.length >= 10 && slCoverage < 0.7;

  // H3 — flag crypto symbols that ship MAE data without a tick-size override.
  // The default classifier ticks crypto at 0.01, which is wrong for any broker
  // that quotes BTC/ETH in whole dollars — MAE would render ~100× too large.
  const cryptoWithoutOverride = useMemo(() => {
    const overrides = getTickSizeOverrides();
    const offenders = new Set<string>();
    for (const t of closed) {
      if (!t.symbol) continue;
      if (classifySymbol(t.symbol) !== "crypto") continue;
      if (overrides[normalizeSymbol(t.symbol)] != null) continue;
      // Treat presence of any logged MAE custom-field value as the trigger —
      // until that exists, the mis-scaling is invisible.
      const cf = (t as any).custom_fields;
      const hasMae =
        cf &&
        typeof cf === "object" &&
        Object.entries(cf).some(
          ([k, v]) => /mae/i.test(k) && v != null && v !== "",
        );
      if (hasMae) offenders.add(t.symbol);
    }
    return Array.from(offenders);
  }, [closed]);

  return (
    <div className="space-y-6">
      {/* Filter controls */}
      <Card className="p-4 space-y-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          Filters
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-1.5">
            <Shield className="w-3.5 h-3.5 text-primary" />
            <Label htmlFor="pf-mode" className="text-xs cursor-pointer">
              Prop-firm mode
            </Label>
            <Switch
              id="pf-mode"
              checked={propFirmMode}
              onCheckedChange={setPropFirmMode}
            />
          </div>
          <div className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-1.5">
            <Label htmlFor="unreal-mode" className="text-xs cursor-pointer">
              Include unrealized
            </Label>
            <Switch
              id="unreal-mode"
              checked={includeUnrealized}
              onCheckedChange={setIncludeUnrealized}
            />
          </div>
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-1.5 cursor-help">
                  <Label htmlFor="orphan-mode" className="text-xs cursor-pointer">
                    Include orphan trades
                  </Label>
                  <Switch
                    id="orphan-mode"
                    checked={includeUnassigned}
                    onCheckedChange={setIncludeUnassigned}
                    aria-label="Include trades with no account assigned"
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                When off, only trades attached to the selected account are
                bucketed. When on, trades whose <code>account_id</code> is NULL
                (legacy CSV imports, advisory closes) are also included. Off by
                default in Pair Lab so cross-account orphan rows can't pollute
                expectancy.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

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
          <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/10 px-3 py-1.5">
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
                    <SelectLabel className="text-[10px] uppercase tracking-wider">
                      Groups (merged)
                    </SelectLabel>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={`grp:${g.id}`}>
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="w-2 h-2 rounded-full inline-block"
                            style={{
                              backgroundColor:
                                g.color ?? "hsl(var(--primary))",
                            }}
                          />
                          {g.name}
                          <span className="text-muted-foreground text-[10px]">
                            · {g.symbols.length}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
            {activeGroup && (
              <span
                className="text-[10px] text-muted-foreground max-w-[180px] truncate"
                title={activeGroup.symbols.join(", ")}
              >
                merging {activeGroup.symbols.length}
              </span>
            )}
          </div>
        </div>
        <WalkForwardControls
          state={wf}
          onChange={setWf}
          minMs={minMs}
          maxMs={maxMs}
        />
      </Card>

      {/* Unrealized exclusion chip */}
      {data.unrealizedExcluded > 0 && !includeUnrealized && (
        <TooltipProvider delayDuration={150}>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="font-mono-numbers">
              {data.unrealizedExcluded} unrealized excluded
            </Badge>
            <Tooltip>
              <TooltipTrigger className="underline decoration-dotted">
                why
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                Ideas, paper trades, missed entries, manually-dismissed rows,
                and zero-PnL trades with no SL/TP changes don't contribute a
                real outcome — including them would dilute win-rate and
                expectancy. Toggle "Include unrealized" above to fold them
                back in.
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      )}

      {data.missingFields && (
        <Card className="p-4 flex items-start gap-3 border-amber-500/30 bg-amber-500/5">
          <Info className="w-4 h-4 text-amber-500 mt-0.5" />
          <div className="text-sm">
            <div className="font-medium mb-1">
              No excursion fields detected.
            </div>
            <div className="text-muted-foreground">
              Add custom fields named{" "}
              <span className="font-mono text-foreground">MFE (RR)</span>,{" "}
              <span className="font-mono text-foreground">MAE</span>, and{" "}
              <span className="font-mono text-foreground">Ideal Stop-Loss</span>{" "}
              from the Journal settings, then fill them in on your closed
              trades to power this page.
            </div>
          </div>
        </Card>
      )}

      {data.partialFillFlag && (
        <TooltipProvider delayDuration={150}>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Info className="w-3.5 h-3.5 text-amber-500" />
            <span>
              {data.partialFillFlag.trades} trades in{" "}
              {data.partialFillFlag.groups} groups may be partial-fill
              duplicates.
            </span>
            <Tooltip>
              <TooltipTrigger className="underline decoration-dotted">
                why
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                Trades sharing account · symbol · entry-minute are counted
                independently today, which can inflate sample sizes and distort
                MFE/MAE quantiles. Consolidation isn't implemented yet.
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      )}

      {slWarn && (
        <Card className="p-4 flex items-start gap-3 border-amber-500/30 bg-amber-500/5">
          <Info className="w-4 h-4 text-amber-500 mt-0.5" />
          <div className="text-sm">
            <div className="font-medium mb-1">
              Only {withSl} of {closed.length} closed trades have{" "}
              <code className="text-xs">sl_initial</code> +{" "}
              <code className="text-xs">entry_price</code> recorded.
            </div>
            <div className="text-muted-foreground text-xs leading-relaxed">
              MAE and Ideal-SL are logged in broker ticks; they need each
              trade's initial-SL distance to convert into R. Trades without it
              are ineligible for MAE-based stop-out detection and for the
              "Tighten SL → ideal" preset.
            </div>
          </div>
        </Card>
      )}

      {/* H3 — crypto without tick-size override produces ~100× mis-scaled MAE. */}
      {cryptoWithoutOverride.length > 0 && (
        <Card className="p-4 flex items-start gap-3 border-amber-500/30 bg-amber-500/5">
          <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          <div className="text-sm">
            <div className="font-medium mb-1">
              Crypto symbols with logged MAE but no tick-size override.
            </div>
            <div className="text-muted-foreground text-xs leading-relaxed">
              {cryptoWithoutOverride.join(", ")} —{" "}
              the default classifier ticks crypto at 0.01. If your broker
              quotes these in whole dollars (most do for BTC/ETH), MAE and
              Ideal-SL will render ~100× too large and SL recommendations will
              be unusable. Set a tick-size override under{" "}
              <span className="font-medium text-foreground">Setup → Symbol groups</span>{" "}
              (e.g. BTCUSD = 1.0, ETHUSD = 0.1).
            </div>
          </div>
        </Card>
      )}


      {/* Baseline summary */}
      <Card className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
          Baseline (in-scope window)
        </div>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
          <span>
            <span className="text-muted-foreground">N</span>{" "}
            <span className="font-mono-numbers font-semibold">
              {data.baseline.n}
            </span>
          </span>
          <span>
            <span className="text-muted-foreground">Win rate</span>{" "}
            <span className="font-mono-numbers font-semibold">
              {(data.baseline.winRate * 100).toFixed(1)}%
            </span>
          </span>
          <span>
            <span className="text-muted-foreground">Expected R</span>{" "}
            <span className="font-mono-numbers font-semibold">
              {(data.baseline.expectedR >= 0 ? "+" : "") +
                data.baseline.expectedR.toFixed(2)}
              R
            </span>
          </span>
          <span>
            <span className="text-muted-foreground">MFE p75</span>{" "}
            <span className="font-mono-numbers font-semibold">
              {data.baseline.mfeP75?.toFixed(2) ?? "—"}R
            </span>
          </span>
          <span>
            <span className="text-muted-foreground">MAE p75</span>{" "}
            <span className="font-mono-numbers font-semibold">
              {data.baseline.maeP75 != null
                ? `${data.baseline.maeP75.toFixed(2)}R`
                : "—"}
            </span>
          </span>
          {data.baseline.recommendation.suggestedRiskPct != null && (
            <Badge variant="outline">
              Baseline ¼-Kelly:{" "}
              {data.baseline.recommendation.suggestedRiskPct.toFixed(2)}%
            </Badge>
          )}
          {propFirmMode &&
            data.propFirm &&
            data.propFirm.dailyLossDollars != null && (
              <Badge variant="outline" className="border-primary/40 text-primary">
                PF budget: ${data.propFirm.dailyLossDollars.toFixed(0)}/day
              </Badge>
            )}
        </div>
        <div className="mt-3 text-[11px] text-muted-foreground">
          {data.totalTrades} closed trades · {data.perCell.length} cells ·{" "}
          {data.perRow.length} canonical pairs ·{" "}
          {data.simSource === "active_account"
            ? "active account"
            : "simulator profile"}{" "}
          @ ${data.simBalance.toLocaleString()}
        </div>
        {/* M7 — make the timezone the walk-forward window is read in explicit.
            All Pair Lab math uses each trade's `entry_time` UTC instant. CSV-
            imported broker-local timestamps were normalized to UTC at ingest
            via the account's BrokerDstProfile. */}
        <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground/80">
          <Clock className="w-3 h-3" aria-hidden="true" />
          <span>
            Times read in <span className="font-medium text-foreground">UTC</span>.
            Broker-local CSV imports are converted via your account's DST profile
            at ingest.
          </span>
        </div>
      </Card>
    </div>
  );
}
