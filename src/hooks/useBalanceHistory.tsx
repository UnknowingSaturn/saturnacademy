import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface BalanceSnapshot {
  account_id: string;
  balance: number;
  equity: number | null;
  recorded_at: string;
}

/**
 * Fetches per-account balance snapshots (from EA heartbeats) for the given
 * accounts within [from, to]. Also pulls the most recent snapshot strictly
 * BEFORE `from` per account so we have a baseline for "period start" math.
 */
export function useBalanceHistory(
  accountIds: string[],
  from: Date,
  to: Date,
) {
  const sortedIds = [...accountIds].sort();
  return useQuery({
    queryKey: [
      "balance-history",
      sortedIds.join(","),
      from.toISOString(),
      to.toISOString(),
    ],
    queryFn: async () => {
      if (sortedIds.length === 0) {
        return { inPeriod: [] as BalanceSnapshot[], baselines: {} as Record<string, BalanceSnapshot | null> };
      }

      const { data: inPeriod, error } = await supabase
        .from("account_balance_snapshots")
        .select("account_id, balance, equity, recorded_at")
        .in("account_id", sortedIds)
        .gte("recorded_at", from.toISOString())
        .lte("recorded_at", to.toISOString())
        .order("recorded_at", { ascending: true });

      if (error) throw error;

      // Baseline = last snapshot before `from` per account
      const baselines: Record<string, BalanceSnapshot | null> = {};
      await Promise.all(
        sortedIds.map(async (id) => {
          const { data } = await supabase
            .from("account_balance_snapshots")
            .select("account_id, balance, equity, recorded_at")
            .eq("account_id", id)
            .lt("recorded_at", from.toISOString())
            .order("recorded_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          baselines[id] = (data as BalanceSnapshot | null) ?? null;
        }),
      );

      return {
        inPeriod: (inPeriod || []) as BalanceSnapshot[],
        baselines,
      };
    },
    enabled: sortedIds.length > 0,
  });
}
