// ============================================================================
// Lightweight derivation of min/max entry_time across the same trades cache
// useTrades already owns. Lets PairLab compute slider bounds without a second
// usePairLab call (which would rebuild every BucketReport).
// ============================================================================

import { useMemo } from "react";
import { useTrades } from "@/hooks/useTrades";
import { useAccountFilter } from "@/contexts/AccountFilterContext";
import { ensureUtcMs } from "../../shared/quant/stats";

export interface TradeBounds {
  minMs: number;
  maxMs: number;
  ready: boolean;
}

export function usePairLabTradeBounds(
  opts?: { includeUnassigned?: boolean },
): TradeBounds {
  const { selectedAccountId } = useAccountFilter();
  const isAll = !selectedAccountId || selectedAccountId === "all";
  // Audit §1.4: default TRUE so slider bounds match the analytics window
  // (Pair Lab now also defaults orphans in). Explicit `false` opts out.
  const includeUnassigned = opts?.includeUnassigned !== false;
  const q = useTrades(
    isAll ? undefined : { accountId: selectedAccountId, includeUnassigned },
  );

  return useMemo(() => {
    const trades = q.data ?? [];
    let min = Infinity;
    let max = -Infinity;
    for (const t of trades) {
      if (t.is_open || t.is_archived) continue;
      if (!t.entry_time) continue;
      // S4.2: `new Date(naiveString).getTime()` is host-locale-dependent
      // (Chrome=local, Safari/Node=UTC); shifted slider bounds by the user's
      // UTC offset for CSV-imported trades. ensureUtcMs is locale-stable.
      const ms = ensureUtcMs(t.entry_time);
      if (!Number.isFinite(ms)) continue;
      if (ms < min) min = ms;
      if (ms > max) max = ms;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      const now = Date.now();
      return { minMs: now - 90 * 86_400_000, maxMs: now, ready: !q.isLoading };
    }
    return { minMs: min, maxMs: max, ready: true };
  }, [q.data, q.isLoading]);
}
