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
  resolvePairLabFieldKeys,
  type PairLabFieldKeys,
  type BucketReport,
  type PropFirmContext,
} from "@/lib/pairLabMath";

export interface PairLabFilters {
  profile?: string | null;
  actualProfile?: string | null;
  propFirmMode?: boolean;
}

import type { Trade } from "@/types/trading";

export interface PairLabData {
  isLoading: boolean;
  fieldKeys: PairLabFieldKeys;
  baseline: BucketReport;
  perCell: BucketReport[];
  perRow: BucketReport[];
  symbols: string[];
  sessions: string[];
  totalTrades: number;
  missingFields: boolean;
  propFirm: PropFirmContext | null;
  /** Filtered trades (closed-only, non-archived, profile-filtered). */
  trades: Trade[];
  /** Resolver from raw broker symbol → canonical. */
  symbolResolver: (raw: string) => string;
  /** Notional balance used to convert R into $. Driven by the user's Simulator Profile, independent of accounts. */
  simBalance: number;
  /** Where the balance/prop-firm context came from. */
  simSource: "manual" | "active_account";
}

const SESSION_ORDER = ["Tokyo", "London", "NY AM", "NY PM"];

/** Fetch prop firm rules for one firm (small static dataset, cached). */
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

export function usePairLab(filters: PairLabFilters = {}): PairLabData {
  const { selectedAccountId } = useAccountFilter();
  const isAllAccounts = !selectedAccountId || selectedAccountId === "all";
  const accountFilter = !isAllAccounts ? { accountId: selectedAccountId } : undefined;
  const tradesQuery = useTrades(accountFilter);
  const defsQuery = useCustomFieldDefinitions();
  const aliasesQuery = useSymbolAliases();
  const profileQuery = useSimulatorProfile();

  // Only fetch the active account when the user explicitly opts into sourcing
  // from it. The simulator otherwise runs purely on the user-level profile so
  // deleting failed-challenge accounts never breaks historical R replay.
  const useActiveAccount = profileQuery.data?.sim_source === "active_account";
  const accountQuery = useAccount(
    useActiveAccount && !isAllAccounts ? selectedAccountId : undefined,
  );

  // Resolve the effective balance + firm id from the simulator profile,
  // optionally overlaid by the active account when the user requested it.
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
      !fieldKeys.mfe && !fieldKeys.mae && !fieldKeys.tpReached && !fieldKeys.idealStopLoss;

    const symbolResolver = buildSymbolResolver(aliases);

    // Build prop-firm context purely from the simulator profile (or overlaid
    // active account). Independent of whether any account row still exists.
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

    const { perCell, perRow, baseline } = buildBuckets(trades, fieldKeys, {
      profile: filters.profile ?? null,
      actualProfile: filters.actualProfile ?? null,
      closedOnly: true,
      symbolResolver,
      propFirm,
    });

    const symbols = Array.from(new Set(perRow.map((r) => r.key.symbol))).sort();
    const sessions = Array.from(new Set(perCell.map((c) => c.key.session))).sort(
      (a, b) => SESSION_ORDER.indexOf(a) - SESSION_ORDER.indexOf(b),
    );

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
      totalTrades: trades.length,
      missingFields,
      propFirm,
      trades,
      symbolResolver,
      simBalance: effectiveBalance,
      simSource: profile?.sim_source ?? "manual",
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
    filters.actualProfile,
    filters.propFirmMode,
  ]);
}
