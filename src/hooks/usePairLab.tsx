import { useMemo } from "react";
import { useTrades } from "@/hooks/useTrades";
import { useCustomFieldDefinitions } from "@/hooks/useCustomFields";
import { useAccountFilter } from "@/contexts/AccountFilterContext";
import {
  buildBuckets,
  resolvePairLabFieldKeys,
  type PairLabFieldKeys,
  type BucketReport,
} from "@/lib/pairLabMath";

export interface PairLabFilters {
  profile?: string | null;
  actualProfile?: string | null;
}

export interface PairLabData {
  isLoading: boolean;
  fieldKeys: PairLabFieldKeys;
  baseline: BucketReport;
  perCell: BucketReport[];
  perRow: BucketReport[];
  symbols: string[];
  sessions: string[];
  /** Trade count after account filter, before symbol/session bucket split. */
  totalTrades: number;
  /** True when the user hasn't created any of the MFE/MAE/etc. custom fields. */
  missingFields: boolean;
}

const SESSION_ORDER = ["Tokyo", "London", "NY AM", "NY PM"];

export function usePairLab(filters: PairLabFilters = {}): PairLabData {
  const { selectedAccountId } = useAccountFilter();
  const accountFilter =
    selectedAccountId && selectedAccountId !== "all" ? { accountId: selectedAccountId } : undefined;
  const tradesQuery = useTrades(accountFilter);
  const defsQuery = useCustomFieldDefinitions();

  return useMemo(() => {
    const trades = tradesQuery.data ?? [];
    const defs = (defsQuery.data ?? []).map((d) => ({ key: d.key, label: d.label }));
    const fieldKeys = resolvePairLabFieldKeys(defs);
    const missingFields =
      !fieldKeys.mfe && !fieldKeys.mae && !fieldKeys.tpReached && !fieldKeys.idealStopLoss;

    const { perCell, perRow, baseline } = buildBuckets(trades, fieldKeys, {
      profile: filters.profile ?? null,
      actualProfile: filters.actualProfile ?? null,
      closedOnly: true,
    });

    const symbols = Array.from(new Set(perRow.map((r) => r.key.symbol))).sort();
    const sessions = Array.from(new Set(perCell.map((c) => c.key.session))).sort(
      (a, b) => SESSION_ORDER.indexOf(a) - SESSION_ORDER.indexOf(b),
    );

    return {
      isLoading: tradesQuery.isLoading || defsQuery.isLoading,
      fieldKeys,
      baseline,
      perCell,
      perRow,
      symbols,
      sessions,
      totalTrades: trades.length,
      missingFields,
    };
  }, [tradesQuery.data, tradesQuery.isLoading, defsQuery.data, defsQuery.isLoading, filters.profile, filters.actualProfile]);
}
