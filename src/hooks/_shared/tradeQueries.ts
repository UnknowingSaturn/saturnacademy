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
  trade_repair_events (*),
  trade_modifications (id, field, old_value, new_value, occurred_at),
  trade_features (*)
`;

// useOpenTrades historically used `accounts(*)` (unaliased) instead of
// `account:accounts(*)`. transformTrade tolerates both, so we unify on
// the aliased form for consistency.

export const tradeKeys = {
  all: ["trades"] as const,
  list: (filters?: unknown) => ["trades", filters] as const,
  detail: (id: string | undefined) => ["trade", id] as const,
  /** Sibling legs loaded by useTradeGroup. */
  group: ["trade-group"] as const,
  open: ["open-trades"] as const,
  archived: ["archived-trades"] as const,
};

/**
 * Invalidate every cache that contains trade data. Use after any mutation
 * that could change a trade row, so all views (filtered list, single trade,
 * group legs, open trades, archived) refresh together.
 *
 * Scoped where possible: when a tradeId is known we refresh that detail entry
 * plus the group namespace (which carries the sibling legs) instead of every
 * ["trade", *] entry in the cache.
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
  } else {
    qc.invalidateQueries({ queryKey: ["trade"] });
  }
  // The detail view renders the group leader plus every leg, so a single-leg
  // edit must still refresh the ["trade-group", *] namespace.
  qc.invalidateQueries({ queryKey: tradeKeys.group });
}

/**
 * Write a freshly saved trade_reviews row straight into every cached trade
 * that references it, instead of invalidating (which would refetch and hand
 * the autosaving panel a new object identity, re-arming its debounce).
 *
 * `reviewRow` is the raw row returned by the upsert; callers pass the
 * transform so this module stays free of UI-layer imports.
 */
export function patchTradeReviewInCaches(
  qc: QueryClient,
  tradeIds: string[],
  reviewRow: Record<string, unknown>,
  transformReview: (row: unknown) => unknown,
) {
  const ids = new Set(tradeIds);
  const review = transformReview(reviewRow);

  const patchTrade = (trade: any) => {
    if (!trade || typeof trade !== "object" || !ids.has(trade.id)) return trade;
    return { ...trade, review };
  };

  const patchValue = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      let changed = false;
      const next = value.map((item) => {
        const patched = patchTrade(item);
        if (patched !== item) changed = true;
        return patched;
      });
      return changed ? next : value;
    }
    return patchTrade(value);
  };

  for (const key of [tradeKeys.all, tradeKeys.open, tradeKeys.archived, ["trade"], tradeKeys.group]) {
    qc.setQueriesData({ queryKey: key as readonly unknown[] }, (old: unknown) =>
      old == null ? old : patchValue(old),
    );
  }
}


