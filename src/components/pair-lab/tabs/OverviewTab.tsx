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
import { useDistanceUnit } from "@/hooks/useDistanceUnit";
import type { SymbolGroup } from "@/hooks/useSymbolGroups";
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
  /** U9: true in "All accounts" mode — the toggle is a no-op then. */
  includeUnassignedDisabled?: boolean;
  scope: string;
  setScope: (v: string) => void;
  /** Symbol groups list — passed from PairLab.tsx to avoid a second
   *  useSymbolGroups subscription (which would trigger a duplicate query
   *  + re-derive on every group mutation). */
  groups: SymbolGroup[];
  /** Resolved active group when `scope` starts with "grp:". Resolved once in
   *  PairLab.tsx and passed down so OverviewTab + usePairLab agree. */
  activeGroup: SymbolGroup | null;
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
  includeUnassignedDisabled = false,
  scope,
  setScope,
  groups,
  activeGroup,
}: Props) {

  const { wf, setWf, minMs, maxMs } = usePairLabWalkForward();
  const { unit: distanceUnit, setUnit: setDistanceUnit } = useDistanceUnit();

  // S2.13: memoize the closed-trade slice so slider drags don't re-filter
  // the entire `data.trades` array (and re-classifySymbol every row) on
  // every render. `tickSizeOffenders` already memoizes on `closed`.
  const closed = useMemo(
    () => data.trades.filter((t) => !t.is_open && !t.is_archived && t.net_pnl != null),
    [data.trades],
  );
  const withSl = useMemo(
    () => closed.filter((t) => t.sl_initial != null && t.entry_price != null).length,
    [closed],
  );
  const slCoverage = closed.length > 0 ? withSl / closed.length : 1;
  const slWarn = closed.length >= 10 && slCoverage < 0.7;

  // Profile vocabulary — drive the picker from what's actually tagged on the
  // user's trades so custom profiles (e.g. "breakout", "scalp") show up. The
  // four canonical names stay as a fallback for empty accounts so first-time
  // users still see the documented options. Always include "(All)" via the
  // sentinel "any" value handled by the math layer.
  const profileOptions = useMemo(() => {
    const FALLBACK = ["continuation", "range", "reversal", "hindsight"];
    const found = Array.from(
      new Set(
        data.trades
          .map((t) => (t as any).profile ?? (t as any).actual_profile)
          .filter((v): v is string => typeof v === "string" && v.length > 0),
      ),
    ).sort((a, b) => a.localeCompare(b));
    return found.length > 0 ? found : FALLBACK;
  }, [data.trades]);

  // G10 — flag crypto OR index symbols that ship MAE data without a tick-size
  // override. Defaults: crypto=0.01 (wrong for BTC/ETH quoted in whole $),
  // index=1.0 (wrong for NAS100/US30 quoted in 0.1). Either mis-scales MAE.
  const tickSizeOffenders = useMemo(() => {
    const overrides = getTickSizeOverrides();
    const offenders = new Set<string>();
    for (const t of closed) {
      if (!t.symbol) continue;
      const cls = classifySymbol(t.symbol);
      if (cls !== "crypto" && cls !== "index") continue;
      if (overrides[normalizeSymbol(t.symbol)] != null) continue;
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
            <div className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-1.5">
              {/* U-B6: cursor-help lives on the Label/Tooltip trigger only —
                  the outer wrapper no longer intercepts pointer / focus,
                  so the <Switch> is fully keyboard + click reachable. */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Label
                    htmlFor="orphan-mode"
                    className="text-xs cursor-help"
                  >
                    Include orphan trades
                  </Label>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  When off, only trades attached to the selected account are
                  bucketed. When on, trades whose <code>account_id</code> is NULL
                  (legacy CSV imports, advisory closes) are also included.
                  Defaults ON in Pair Lab to match the Journal.
                </TooltipContent>
              </Tooltip>
              <Switch
                id="orphan-mode"
                checked={includeUnassigned}
                onCheckedChange={setIncludeUnassigned}
                aria-label="Include trades with no account assigned"
              />
            </div>
          </TooltipProvider>

          <Select value={profile} onValueChange={setProfile}>
            <SelectTrigger className="w-[170px]">
              <SelectValue placeholder="Profile" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">(All) profiles</SelectItem>
              {profileOptions.map((p) => (
                <SelectItem key={p} value={p}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </SelectItem>
              ))}
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

      {data.missingFields.any && (() => {
        // F5 fix: list the specific missing field(s). Old banner only fired
        // when ALL three were missing — silent label-rename + recreate (new
        // key bypasses both label & prefix matchers) went undetected.
        const missing: Array<{ key: string; label: string }> = [];
        if (data.missingFields.mfe) missing.push({ key: "mfe", label: "MFE (RR)" });
        if (data.missingFields.mae) missing.push({ key: "mae", label: "MAE" });
        if (data.missingFields.idealStopLoss) missing.push({ key: "isl", label: "Ideal Stop-Loss" });
        const allMissing = missing.length === 3;
        return (
          <Card className="p-4 flex items-start gap-3 border-amber-500/30 bg-amber-500/5">
            <Info className="w-4 h-4 text-amber-500 mt-0.5" />
            <div className="text-sm">
              <div className="font-medium mb-1">
                {allMissing ? "No excursion fields detected." : "Missing excursion field(s)."}
              </div>
              <div className="text-muted-foreground">
                Add or rename custom field(s) named{" "}
                {missing.map((m, i) => (
                  <span key={m.key}>
                    <span className="font-mono text-foreground">{m.label}</span>
                    {i < missing.length - 2 ? ", " : i === missing.length - 2 ? ", and " : ""}
                  </span>
                ))}{" "}
                in Journal settings. Pair Lab matches on the exact label
                (case-insensitive) or a <span className="font-mono">cf_mfe</span> /{" "}
                <span className="font-mono">cf_mae</span> /{" "}
                <span className="font-mono">cf_ideal_stop_loss</span> key prefix.
              </div>
            </div>
          </Card>
        );
      })()}

      {data.partialFillFlag && (
        <TooltipProvider delayDuration={150}>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Info className="w-3.5 h-3.5 text-amber-500" />
            <span>
              {data.partialFillFlag.trades} trade
              {data.partialFillFlag.trades === 1 ? "" : "s"} may be
              partial-fill duplicates.
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

      {/* G10 — crypto or index without tick-size override produces mis-scaled MAE. */}
      {tickSizeOffenders.length > 0 && (
        <Card className="p-4 flex items-start gap-3 border-amber-500/30 bg-amber-500/5">
          <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          <div className="text-sm">
            <div className="font-medium mb-1">
              Symbols with logged MAE but no tick-size override.
            </div>
            <div className="text-muted-foreground text-xs leading-relaxed">
              {tickSizeOffenders.join(", ")} —{" "}
              defaults are crypto=0.01 and index=1.0. If your broker quotes
              crypto in whole dollars or indices in 0.1, MAE and Ideal-SL will
              be 10–100× mis-scaled and SL recommendations will be unusable.
              Set a per-symbol tick-size under{" "}
              <span className="font-medium text-foreground">Setup → Symbol groups</span>{" "}
              (e.g. BTCUSD = 1.0, NAS100 = 0.1).
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
              {Number.isFinite(data.baseline.expectedR)
                ? (data.baseline.expectedR >= 0 ? "+" : "") + data.baseline.expectedR.toFixed(2) + "R"
                : "—"}
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
          {/* G7 — R-fallback badge. When a trade has no `r_multiple_actual`,
              its outcome is inferred as ±1 from net P&L sign so winRate and
              the cumulative line stay populated. Surface the count so users
              know which buckets lean on inference. */}
          {data.rFallbackCount > 0 && data.totalTrades > 0 && (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className="border-amber-500/40 text-amber-600 dark:text-amber-400 cursor-help"
                  >
                    {data.rFallbackCount}/{data.totalTrades} R inferred
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  These trades had no <code>r_multiple_actual</code> recorded;
                  Pair Lab inferred ±1R from the net-P&L sign so they still
                  contribute to win-rate and the cumulative chart. Expected-R
                  rounds toward whole numbers when inference dominates a cell.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {/* G8 — orphan notice. `Include orphan trades` (account_id IS NULL)
              defaults ON to match the Journal. Surface the count so users see
              when cross-account rows are folded into the in-scope window. */}
          {includeUnassigned && data.orphanIncluded > 0 && (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className="border-muted-foreground/40 text-muted-foreground cursor-help"
                  >
                    +{data.orphanIncluded} orphan
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  Trades with no <code>account_id</code> (legacy CSV imports,
                  advisory closes) are included in this scope — matches the
                  Journal default. Toggle "Include orphan trades" off to
                  restrict to the selected account only.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {/* H/12 — naive-timestamp chip. Counts trades whose `entry_time`
              has no timezone designator. `brokerLocalToUtc` will still parse
              them deterministically via the account's DST profile, but the
              presence of TZ-less rows is a data-quality signal worth
              surfacing so users can re-ingest or fix the broker export. */}
          {data.naiveTimestampCount > 0 && (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className="border-muted-foreground/40 text-muted-foreground cursor-help"
                  >
                    {data.naiveTimestampCount} naive ts
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  Counted across <strong>all your trades</strong> (not just the
                  current in-scope window). These rows have <code>entry_time</code>{" "}
                  without a timezone (no <code>Z</code> or <code>±HH:MM</code>).
                  Pair Lab parses them deterministically via the account's
                  broker-DST profile, but TZ-qualified imports are safer. Set
                  the account's broker DST profile in Settings → Account, or
                  re-ingest with ISO 8601 + offset.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {/* K2 — duplicate custom-field detector. `resolvePairLabFieldKeys`
              silently picks the first match when the user has more than one
              field aliased to MFE/MAE/Ideal-SL (e.g. after a rename + recreate).
              Surface the collision so the wrong one can be archived. */}
          {data.ambiguousFields.any && (() => {
            const dup: string[] = [];
            if (data.ambiguousFields.mfe) dup.push("MFE");
            if (data.ambiguousFields.mae) dup.push("MAE");
            if (data.ambiguousFields.idealStopLoss) dup.push("Ideal SL");
            return (
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className="border-amber-500/40 text-amber-600 cursor-help"
                    >
                      duplicate field: {dup.join(", ")}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    More than one custom field maps to{" "}
                    {dup.join(" / ")}. Pair Lab uses the first match and ignores the
                    rest, which can silently bias bucket math. Archive the
                    duplicate in Settings → Custom Fields.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            );
          })()}
        </div>
        {/* Distance display unit — pure presentation toggle. Storage stays in
            broker ticks; "native" shows pips (FX/metals/crypto/oil) or points
            (indices) matching TradingView's measure tool; "ticks" surfaces
            the raw broker unit so values can be pasted into an MT5 EA. */}
        <div className="mt-3 flex items-center gap-2 text-[11px]">
          {/* Audit §3.4: tooltip trigger sits on the label, not the button
              group — buttons remain fully focusable + hit-testable. */}
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-muted-foreground cursor-help underline decoration-dotted">
                  Distance:
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                MAE and Ideal-SL are stored in broker <strong>ticks</strong>
                (MT5's <code>Point()</code>). Display converts to{" "}
                <strong>pips</strong> on FX/metals/crypto/oil (1 pip = 10
                ticks) and <strong>points</strong> on indices (1 point = 1
                tick). Switch to ticks when you want raw values for an EA
                input.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <div
            className="inline-flex rounded-md border border-border overflow-hidden"
            role="group"
            aria-label="Distance display unit"
          >
            <button
              type="button"
              onClick={() => setDistanceUnit("native")}
              className={
                "px-2 py-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 " +
                (distanceUnit === "native"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted")
              }
              aria-pressed={distanceUnit === "native"}
            >
              pips / points
            </button>
            <button
              type="button"
              onClick={() => setDistanceUnit("ticks")}
              className={
                "px-2 py-0.5 transition-colors border-l border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 " +
                (distanceUnit === "ticks"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted")
              }
              aria-pressed={distanceUnit === "ticks"}
            >
              ticks
            </button>
          </div>
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
