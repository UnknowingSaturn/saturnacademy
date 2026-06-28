import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTrades } from "@/hooks/useTrades";
import { useCustomFieldDefinitions } from "@/hooks/useCustomFields";
import { useAccountFilter } from "@/contexts/AccountFilterContext";
import { useAccount } from "@/hooks/useAccounts";
import { useSymbolAliases } from "@/hooks/useSymbolAliases";
import { useSimulatorProfile } from "@/hooks/useSimulatorProfile";
import { useSymbolGroups } from "@/hooks/useSymbolGroups";
import { buildSymbolResolver } from "@/lib/symbolAliasing";
import {
  buildBuckets,
  estimateTrailCapture,
  resolvePairLabFieldKeys,
  detectAmbiguousFieldKeys,
  type PairLabFieldKeys,
  type BucketReport,
  type PropFirmContext,
  type TrailCaptureEstimate,
} from "@/lib/pairLabMath";
import { TRAIL_CAPTURE_FRAC } from "@/lib/pairLabSimulator";
import { isUnrealized, countNaiveEntryTimes } from "../../shared/quant/stats";

export interface PairLabFilters {
  /** Matches trades whose planned OR actual profile equals this value. */
  profile?: string | null;
  propFirmMode?: boolean;
  /** Walk-forward: ISO timestamp lower bound on entry_time (inclusive). */
  dateFrom?: string | null;
  /** Walk-forward: ISO timestamp upper bound on entry_time (inclusive). */
  dateTo?: string | null;
  /** When set, collapse every member symbol into `groupOverride.name` before bucketing. */
  groupOverride?: { name: string; symbols: string[] } | null;
  /** Window length for the per-bucket drift signal (default 10). */
  recentN?: number;
  /** When true, includes ideas/paper/missed/dismissed setups in the math. Default false. */
  includeUnrealized?: boolean;
  /**
   * When true, includes trades with `account_id IS NULL` even after an
   * account is selected (legacy imports). Default false in Pair Lab so
   * orphan rows can't bleed into account-scoped expectancy. Surface as a
   * toggle on OverviewTab.
   */
  includeUnassigned?: boolean;
}


import type { Trade } from "@/types/trading";

export interface PartialFillFlag {
  /** Number of (accountId, symbol, entry_minute) groups with > 1 trade row. */
  groups: number;
  /** Total trades that fall into one of those groups. */
  trades: number;
}

export interface PairLabData {
  isLoading: boolean;
  fieldKeys: PairLabFieldKeys;
  baseline: BucketReport;
  perCell: BucketReport[];
  perRow: BucketReport[];
  symbols: string[];
  sessions: string[];
  /** Closed (non-archived) trades in scope. Matches what the grid actually counts. */
  totalTrades: number;
  /**
   * F5 fix: per-field detection. `any` is true when at least one expected
   * field could not be resolved (silent label rename + recreate breaks both
   * label and prefix matchers — surface specifically which one is missing).
   */
  missingFields: { mfe: boolean; mae: boolean; idealStopLoss: boolean; any: boolean };
  /**
   * K2 fix: set of field aliases that resolved to more than one custom-field
   * definition. Pair Lab picks the first match silently; this exposes the
   * collision so the UI can ask the user to delete or rename the duplicate.
   */
  ambiguousFields: { mfe: boolean; mae: boolean; idealStopLoss: boolean; any: boolean };
  propFirm: PropFirmContext | null;
  trades: Trade[];
  symbolResolver: (raw: string) => string;
  simBalance: number;
  simSource: "manual" | "active_account";
  /** Default % risk for the simulator slider (from user's simulator profile). */
  defaultSimRiskPct: number;
  /** Empirically-derived trail-capture ratio (or null when sample too small). */
  trailCapture: TrailCaptureEstimate | null;
  /** Effective trail capture used by replay (estimate when present, else default 0.8). */
  effectiveTrailCapture: number;
  /** Heuristic warning when the same trade may appear in multiple rows. */
  partialFillFlag: PartialFillFlag | null;
  /** Count of trades dropped because they were classified as Unrealized (ideas/paper/missed/dismissed). */
  unrealizedExcluded: number;
  /** Count of in-scope trades with NULL account_id (folded in when `includeUnassigned`). */
  orphanIncluded: number;
  /** Count of closed trades whose R was inferred from net_pnl sign (no `r_multiple_actual`). */
  rFallbackCount: number;
  /** Count of trades with naive (no-TZ) entry_time strings in current scope. */
  naiveTimestampCount: number;
}

const SESSION_ORDER = ["Tokyo", "London", "NY AM", "NY PM"];

function usePropFirmRules(firmId: string | null | undefined) {
  return useQuery({
    queryKey: ["prop_firm_rules", firmId],
    queryFn: async () => {
      if (!firmId) return [] as Array<{ rule_type: string; value: number; is_percentage: boolean | null }>;
      const { data, error } = await supabase
        .from("prop_firm_rules")
        .select("rule_type, value, is_percentage")
        .eq("firm", firmId);
      if (error) throw error;
      return (data ?? []) as Array<{ rule_type: string; value: number; is_percentage: boolean | null }>;
    },
    enabled: !!firmId,
  });
}

/**
 * J3 fix: use the real `trade_partial_fills` data attached to each Trade
 * (via `t.partial_fills`) instead of a same-minute heuristic that produced
 * false positives for scalpers and missed real partial exits.
 */
function detectPartialFills(trades: Trade[]): PartialFillFlag | null {
  let n = 0;
  for (const t of trades) {
    if (t.is_open || t.is_archived) continue;
    if ((t.partial_fills?.length ?? 0) > 0) n += 1;
  }
  // `groups` is kept on the type for downstream UI; with the per-trade signal
  // each flagged trade IS its own group, so groups == n.
  return n > 0 ? { groups: n, trades: n } : null;
}

export function usePairLab(filters: PairLabFilters = {}): PairLabData {
  const { selectedAccountId } = useAccountFilter();
  const isAllAccounts = !selectedAccountId || selectedAccountId === "all";
  const includeUnassigned = filters.includeUnassigned === true;
  const accountFilter = !isAllAccounts
    ? { accountId: selectedAccountId, includeUnassigned }
    : undefined;
  const tradesQuery = useTrades(accountFilter);

  const defsQuery = useCustomFieldDefinitions();
  const aliasesQuery = useSymbolAliases();
  const profileQuery = useSimulatorProfile();
  // J4 fix: tick-size overrides are installed by useSymbolGroups as a side
  // effect. Subscribe here so the memo below re-runs once the data arrives —
  // otherwise the first bucket-math pass executes against an empty override
  // map and never re-computes (no other dep changes when overrides flip).
  const groupsQuery = useSymbolGroups();

  const useActiveAccount = profileQuery.data?.sim_source === "active_account";
  const accountQuery = useAccount(
    useActiveAccount && !isAllAccounts ? selectedAccountId : undefined,
  );

  const effectiveBalance = useMemo(() => {
    const profile = profileQuery.data;
    if (!profile) return 0;
    if (useActiveAccount && accountQuery.data?.balance_start != null) {
      return Number(accountQuery.data.balance_start);
    }
    return Number(profile.sim_balance ?? 0);
  }, [profileQuery.data, useActiveAccount, accountQuery.data]);

  const effectiveFirmId = useMemo(() => {
    const profile = profileQuery.data;
    if (useActiveAccount) return accountQuery.data?.prop_firm ?? null;
    return profile?.sim_prop_firm ?? null;
  }, [profileQuery.data, useActiveAccount, accountQuery.data]);

  const rulesQuery = usePropFirmRules(effectiveFirmId);

  return useMemo(() => {
    const trades = tradesQuery.data ?? [];
    const defs = (defsQuery.data ?? []).map((d) => ({ key: d.key, label: d.label }));
    const aliases = aliasesQuery.data ?? [];
    const fieldKeys = resolvePairLabFieldKeys(defs);
    const missingFields = {
      mfe: !fieldKeys.mfe,
      mae: !fieldKeys.mae,
      idealStopLoss: !fieldKeys.idealStopLoss,
      any: !fieldKeys.mfe || !fieldKeys.mae || !fieldKeys.idealStopLoss,
    };

    const baseResolver = buildSymbolResolver(aliases);
    const groupOverride = filters.groupOverride ?? null;
    const symbolResolver: (raw: string) => string = groupOverride
      ? ((raw: string) => {
          const canonical = baseResolver(raw);
          return groupOverride.symbols.includes(canonical) ? groupOverride.name : canonical;
        })
      : baseResolver;

    let propFirm: PropFirmContext | null = null;
    const profile = profileQuery.data;
    const rules = rulesQuery.data ?? [];
    if (filters.propFirmMode && profile && effectiveBalance > 0 && effectiveFirmId) {
      const dailyRule = rules.find((r) => r.rule_type === "daily_loss");
      const maxDdRule = rules.find((r) => r.rule_type === "max_drawdown");
      const toDollars = (r: typeof rules[number] | undefined) => {
        if (!r) return null;
        return r.is_percentage ? effectiveBalance * (Number(r.value) / 100) : Number(r.value);
      };
      propFirm = {
        balance: effectiveBalance,
        dailyLossDollars: toDollars(dailyRule),
        maxDrawdownDollars: toDollars(maxDdRule),
        riskPerTradeFrac: (profile.sim_risk_per_trade_pct ?? 1) / 100,
        hardCapPct: profile.sim_hard_cap_pct ?? 2,
        firmName: effectiveFirmId,
      };
    }

    const includeUnrealized = filters.includeUnrealized === true;
    const { perCell, perRow, baseline, unrealizedExcluded } = buildBuckets(trades, fieldKeys, {
      profile: filters.profile ?? null,
      closedOnly: true,
      symbolResolver,
      propFirm,
      dateFrom: filters.dateFrom ?? null,
      dateTo: filters.dateTo ?? null,
      recentN: filters.recentN ?? 10,
      includeUnrealized,
    });

    // C6 fix: pre-filter `trades` returned to consumers (StrategyLab,
    // StrategyRanker, drilldowns) so they see the same universe `buildBuckets`
    // operated on. Without this, downstream surfaces silently re-include the
    // wrong profile or unrealized rows and the numbers diverge from the grid.
    const dateFrom = filters.dateFrom ?? null;
    const dateTo = filters.dateTo ?? null;
    const matchesScope = (t: typeof trades[number]) => {
      if (t.is_archived) return false;
      // G9 fix: exclude open positions from analytical surfaces.
      // Historical R-multiple, MAE/MFE and SL replay are undefined for
      // live trades; including them silently mixed unrealized rows into
      // the grid and chart. `buildBuckets` already filters via `closedOnly`,
      // but downstream consumers (StrategyLab, drilldowns) re-derived from
      // `trades` and saw the leak.
      if (t.is_open) return false;
      if (filters.profile && t.profile !== filters.profile && t.actual_profile !== filters.profile) return false;
      if (dateFrom || dateTo) {
        const ts = t.entry_time ? String(t.entry_time) : null;
        if (!ts) return false;
        if (dateFrom && ts < dateFrom) return false;
        if (dateTo && ts > dateTo) return false;
      }
      if (!includeUnrealized && isUnrealized(t)) return false;
      return true;
    };
    const scopedTrades = trades.filter(matchesScope);
    const closedTrades = scopedTrades;

    const symbols = Array.from(new Set(perRow.map((r) => r.key.symbol))).sort();
    const sessions = Array.from(new Set(perCell.map((c) => c.key.session))).sort(
      (a, b) => SESSION_ORDER.indexOf(a) - SESSION_ORDER.indexOf(b),
    );

    const trailCapture = estimateTrailCapture(closedTrades, fieldKeys);
    const effectiveTrailCapture = trailCapture?.ratio ?? TRAIL_CAPTURE_FRAC;
    const partialFillFlag = detectPartialFills(closedTrades);

    // Header chips: orphan rows actually in scope, and R-fallback (sign-inferred)
    // count drawn from the baseline cell which mirrors what the grid renders.
    const orphanIncluded = includeUnassigned
      ? scopedTrades.filter((t) => t.account_id == null).length
      : 0;
    const rFallbackCount = baseline.eventsRFallbackCount ?? 0;
    // Phase H/12 + K5: detect TZ-less entry_time strings across the whole
    // user trade set (incl. open positions and out-of-window rows) so the
    // header chip surfaces every offender, not just what survived the scope
    // filter.
    const naiveTimestampCount = countNaiveEntryTimes(trades);

    return {
      isLoading:
        tradesQuery.isLoading ||
        defsQuery.isLoading ||
        aliasesQuery.isLoading ||
        profileQuery.isLoading,
      fieldKeys,
      baseline,
      perCell,
      perRow,
      symbols,
      sessions,
      totalTrades: closedTrades.length,
      missingFields,
      propFirm,
      trades: scopedTrades,
      symbolResolver,
      simBalance: effectiveBalance,
      simSource: profile?.sim_source ?? "manual",
      defaultSimRiskPct: Number(profile?.sim_risk_per_trade_pct ?? 1),
      trailCapture,
      effectiveTrailCapture,
      partialFillFlag,
      unrealizedExcluded,
      orphanIncluded,
      rFallbackCount,
      naiveTimestampCount,
    };
  }, [
    tradesQuery.data,
    tradesQuery.isLoading,
    defsQuery.data,
    defsQuery.isLoading,
    aliasesQuery.data,
    aliasesQuery.isLoading,
    profileQuery.data,
    profileQuery.isLoading,
    rulesQuery.data,
    // J4 — re-run when overrides install/change so MAE / Ideal-SL scaling
    // matches the canonical tick map. The hook itself doesn't read groupsQuery
    // directly; the effect inside useSymbolGroups writes the overrides into
    // the shared symbolMapping module that pairLabMath consults.
    groupsQuery.groups,
    effectiveBalance,
    effectiveFirmId,
    filters.profile,
    filters.propFirmMode,
    filters.dateFrom,
    filters.dateTo,
    filters.recentN,
    filters.includeUnrealized,
    includeUnassigned,
    filters.groupOverride?.name,
    filters.groupOverride?.symbols.join(","),
  ]);
}
