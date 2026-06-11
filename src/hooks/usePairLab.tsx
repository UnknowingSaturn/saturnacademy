import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTrades } from "@/hooks/useTrades";
import { useCustomFieldDefinitions } from "@/hooks/useCustomFields";
import { useAccountFilter } from "@/contexts/AccountFilterContext";
import { useAccount } from "@/hooks/useAccounts";
import { useSymbolAliases } from "@/hooks/useSymbolAliases";
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
  const accountFilter =
    selectedAccountId && selectedAccountId !== "all" ? { accountId: selectedAccountId } : undefined;
  const tradesQuery = useTrades(accountFilter);
  const defsQuery = useCustomFieldDefinitions();
  const aliasesQuery = useSymbolAliases();
  const accountQuery = useAccount(
    selectedAccountId && selectedAccountId !== "all" ? selectedAccountId : undefined,
  );
  const rulesQuery = usePropFirmRules(accountQuery.data?.prop_firm ?? null);

  return useMemo(() => {
    const trades = tradesQuery.data ?? [];
    const defs = (defsQuery.data ?? []).map((d) => ({ key: d.key, label: d.label }));
    const aliases = aliasesQuery.data ?? [];
    const fieldKeys = resolvePairLabFieldKeys(defs);
    const missingFields =
      !fieldKeys.mfe && !fieldKeys.mae && !fieldKeys.tpReached && !fieldKeys.idealStopLoss;

    const symbolResolver = buildSymbolResolver(aliases);

    // Build prop firm context from account + rules.
    let propFirm: PropFirmContext | null = null;
    const acct = accountQuery.data;
    const rules = rulesQuery.data ?? [];
    if (filters.propFirmMode && acct && acct.balance_start) {
      const balance = Number(acct.balance_start ?? 0);
      const dailyRule = rules.find((r) => r.rule_type === "daily_loss");
      const maxDdRule = rules.find((r) => r.rule_type === "max_drawdown");
      const toDollars = (r: typeof rules[number] | undefined) => {
        if (!r) return null;
        return r.is_percentage ? balance * (Number(r.value) / 100) : Number(r.value);
      };
      propFirm = {
        balance,
        dailyLossDollars: toDollars(dailyRule),
        maxDrawdownDollars: toDollars(maxDdRule),
        riskPerTradeFrac: 0.01,
        hardCapPct: 2,
        firmName: acct.prop_firm ?? null,
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
        accountQuery.isLoading,
      fieldKeys,
      baseline,
      perCell,
      perRow,
      symbols,
      sessions,
      totalTrades: trades.length,
      missingFields,
      propFirm,
    };
  }, [
    tradesQuery.data,
    tradesQuery.isLoading,
    defsQuery.data,
    defsQuery.isLoading,
    aliasesQuery.data,
    aliasesQuery.isLoading,
    accountQuery.data,
    accountQuery.isLoading,
    rulesQuery.data,
    filters.profile,
    filters.actualProfile,
    filters.propFirmMode,
  ]);
}
