// Centralized query keys + select shape for trade-related queries.
//
// Before: the same monster `select(...)` string was duplicated across
// useTrades, useTrade, useArchivedTrades, and useOpenTrades. Adding a
// new joined relation required editing 4 places and silently broke any
// call site you missed. This module is the single source of truth.

import type { QueryClient } from "@tanstack/react-query";

// All relations every trade view needs. Keep in sync with transformTrade().
export const TRADE_SELECT = `
  *,
  playbook:playbooks!trades_playbook_id_fkey (*),
  actual_playbook:playbooks!trades_actual_playbook_id_fkey (id, name, color),
  trade_reviews (
    *,
    playbook:playbooks (*)
  ),
  ai_reviews (*),
  account:accounts (*),
  trade_partial_fills (*),
  trade_repair_events (*)
`;

// useOpenTrades historically used `accounts(*)` (unaliased) instead of
// `account:accounts(*)`. transformTrade tolerates both, so we unify on
// the aliased form for consistency.

export const tradeKeys = {
  all: ["trades"] as const,
  list: (filters?: unknown) => ["trades", filters] as const,
  detail: (id: string | undefined) => ["trade", id] as const,
  open: ["open-trades"] as const,
  archived: ["archived-trades"] as const,
};

/**
 * Invalidate every cache that contains trade data. Use after any mutation
 * that could change a trade row, so all four views (filtered list, single
 * trade, open trades, archived) refresh together.
 */
export function invalidateAllTradeCaches(
  qc: QueryClient,
  opts?: { tradeId?: string },
) {
  qc.invalidateQueries({ queryKey: tradeKeys.all });
  qc.invalidateQueries({ queryKey: tradeKeys.open });
  qc.invalidateQueries({ queryKey: tradeKeys.archived });
  if (opts?.tradeId) {
    qc.invalidateQueries({ queryKey: tradeKeys.detail(opts.tradeId) });
  }
}
