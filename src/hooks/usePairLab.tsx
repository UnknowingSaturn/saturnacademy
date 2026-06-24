import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTrades } from "@/hooks/useTrades";
import { useCustomFieldDefinitions } from "@/hooks/useCustomFields";
import { useAccountFilter } from "@/contexts/AccountFilterContext";
import { useAccount } from "@/hooks/useAccounts";
import { useSymbolAliases } from "@/hooks/useSymbolAliases";
import { useSimulatorProfile } from "@/hooks/useSimulatorProfile";
import { buildSymbolResolver } from "@/lib/symbolAliasing";
import {
  buildBuckets,
  estimateTrailCapture,
  resolvePairLabFieldKeys,
  type PairLabFieldKeys,
  type BucketReport,
  type PropFirmContext,
  type TrailCaptureEstimate,
} from "@/lib/pairLabMath";
import { TRAIL_CAPTURE_FRAC } from "@/lib/pairLabSimulator";
import { isUnrealized } from "../../shared/quant/stats";

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
  /** Raw row count (incl. open trades) — kept for debugging only. */
  totalTradeRowsRaw: number;
  missingFields: boolean;
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

/** Detect possible partial-fill duplication: same account+symbol within 1 minute. */
function detectPartialFills(trades: Trade[]): PartialFillFlag | null {
  const groups = new Map<string, number>();
  for (const t of trades) {
    if (t.is_open || t.is_archived) continue;
    if (!t.symbol || !t.entry_time || !t.account_id) continue;
    // Round to minute resolution.
    const minute = String(t.entry_time).slice(0, 16);
    const k = `${t.account_id}|${t.symbol}|${minute}`;
    groups.set(k, (groups.get(k) ?? 0) + 1);
  }
  let g = 0;
  let n = 0;
  groups.forEach((count) => { if (count > 1) { g += 1; n += count; } });
  return g > 0 ? { groups: g, trades: n } : null;
}

export function usePairLab(filters: PairLabFilters = {}): PairLabData {
  const { selectedAccountId } = useAccountFilter();
  const isAllAccounts = !selectedAccountId || selectedAccountId === "all";
  const accountFilter = !isAllAccounts ? { accountId: selectedAccountId } : undefined;
  const tradesQuery = useTrades(accountFilter);
  const defsQuery = useCustomFieldDefinitions();
  const aliasesQuery = useSymbolAliases();
  const profileQuery = useSimulatorProfile();

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
    const missingFields =
      !fieldKeys.mfe && !fieldKeys.mae && !fieldKeys.idealStopLoss;

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
    const closedTrades = scopedTrades.filter((t) => !t.is_open);

    const symbols = Array.from(new Set(perRow.map((r) => r.key.symbol))).sort();
    const sessions = Array.from(new Set(perCell.map((c) => c.key.session))).sort(
      (a, b) => SESSION_ORDER.indexOf(a) - SESSION_ORDER.indexOf(b),
    );

    const trailCapture = estimateTrailCapture(closedTrades, fieldKeys);
    const effectiveTrailCapture = trailCapture?.ratio ?? TRAIL_CAPTURE_FRAC;
    const partialFillFlag = detectPartialFills(closedTrades);

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
      totalTradeRowsRaw: trades.length,
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
    effectiveBalance,
    effectiveFirmId,
    filters.profile,
    filters.propFirmMode,
    filters.dateFrom,
    filters.dateTo,
    filters.recentN,
    filters.includeUnrealized,
    filters.groupOverride?.name,
    filters.groupOverride?.symbols.join(","),
  ]);
}
