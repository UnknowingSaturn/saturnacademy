// Multi-TP sibling grouping — client-side selector layered over useTrades().
//
// Background: MT5 position sizers open one broker position per TP leg. Same
// account / symbol / direction, same second, same price ± a tick. Each is
// a real broker position with its own ticket/PnL/SL/TP, but for journaling,
// win-rate, R-multiple, and prop-firm risk they are ONE idea with N legs.
//
// The ingest layer + a backfill migration tag sibling rows with a shared
// `group_key` (leader = earliest row, others = legs) without ever merging
// or mutating per-leg data. This hook rolls the legs up into a synthetic
// "leader-shaped" Trade whose aggregate fields (lots, pnl, VWAP entry, VWAP
// exit, r-multiple, is_open, exit_time) reflect the whole idea, with the
// original legs attached under `.legs`. Standalone trades pass through
// unchanged.

import { useMemo } from "react";
import type { Trade } from "@/types/trading";

export type OutcomeMix = "all_win" | "all_loss" | "all_be" | "mixed" | "open";

export interface GroupedTrade extends Trade {
  /** All broker rows in this group, ordered by entry_time. Includes the leader. */
  legs: Trade[];
  /** True if the trade is a real group (≥ 2 legs). False for standalone rows. */
  isGrouped: boolean;
  /** Number of executed legs in this group (idea/paper/missed excluded). */
  leg_count: number;
  legs_win: number;
  legs_loss: number;
  legs_be: number;
  legs_open: number;
  outcome_mix: OutcomeMix;
}

/** Classify an executed leg's outcome. Uses a tiny epsilon so exact-zero and
 *  sub-cent P&L both round to break-even. Open legs return "open". */
function classifyLeg(t: Trade): "win" | "loss" | "be" | "open" {
  if (t.is_open) return "open";
  const p = t.net_pnl;
  if (p == null || !Number.isFinite(p)) return "be";
  if (p > 0.005) return "win";
  if (p < -0.005) return "loss";
  return "be";
}

function safeSum(xs: Array<number | null | undefined>): number {
  let s = 0;
  for (const x of xs) if (x != null && Number.isFinite(x)) s += Number(x);
  return s;
}

function safeSumNullable(xs: Array<number | null | undefined>): number | null {
  let any = false;
  let s = 0;
  for (const x of xs) {
    if (x != null && Number.isFinite(x)) {
      s += Number(x);
      any = true;
    }
  }
  return any ? s : null;
}

function vwap(pairs: Array<{ lots: number; price: number | null }>): number | null {
  let num = 0;
  let den = 0;
  for (const { lots, price } of pairs) {
    if (price == null || !Number.isFinite(price)) continue;
    if (!Number.isFinite(lots) || lots <= 0) continue;
    num += lots * price;
    den += lots;
  }
  return den > 0 ? num / den : null;
}

/** Aggregate a set of legs (sorted by entry_time ascending) into one row. */
function aggregate(legs: Trade[]): GroupedTrade {
  // Prefer the row explicitly marked as leader; fall back to earliest entry.
  const leader = legs.find((l) => l.group_role === "leader") ?? legs[0];
  const anyOpen = legs.some((l) => l.is_open);

  const totalLotsOpen = safeSum(legs.map((l) => (l.is_open ? l.total_lots : 0)));
  const originalLotsSum = safeSum(legs.map((l) => l.original_lots ?? l.total_lots ?? 0));

  const entryVwap =
    vwap(legs.map((l) => ({ lots: l.original_lots ?? l.total_lots ?? 0, price: l.entry_price }))) ??
    leader.entry_price;

  // Exit VWAP only meaningful when all legs closed; otherwise leave null.
  const closedLegs = legs.filter((l) => !l.is_open && l.exit_price != null);
  const exitVwap =
    !anyOpen && closedLegs.length > 0
      ? vwap(closedLegs.map((l) => ({ lots: l.original_lots ?? l.total_lots ?? 0, price: l.exit_price! })))
      : null;

  // Latest exit_time across closed legs (only when the whole group is closed).
  let latestExit: string | null = null;
  if (!anyOpen) {
    for (const l of closedLegs) {
      if (!l.exit_time) continue;
      if (!latestExit || new Date(l.exit_time).getTime() > new Date(latestExit).getTime()) {
        latestExit = l.exit_time;
      }
    }
  }

  const grossPnl = anyOpen ? null : safeSumNullable(legs.map((l) => l.gross_pnl));
  const netPnl = anyOpen ? null : safeSumNullable(legs.map((l) => l.net_pnl));
  const commission = safeSum(legs.map((l) => l.commission ?? 0));
  const swap = safeSum(legs.map((l) => l.swap ?? 0));

  // R-multiple: weighted by per-leg original_lots to reflect that each leg
  // carried its own share of risk. Skip legs with null R.
  let rNum = 0;
  let rDen = 0;
  for (const l of legs) {
    if (l.r_multiple_actual == null) continue;
    const w = l.original_lots ?? l.total_lots ?? 0;
    if (!(w > 0)) continue;
    rNum += l.r_multiple_actual * w;
    rDen += w;
  }
  const rMultiple = !anyOpen && rDen > 0 ? rNum / rDen : anyOpen ? null : leader.r_multiple_actual;

  // Duration: from earliest entry to latest exit (closed groups only).
  let duration: number | null = null;
  if (!anyOpen && latestExit) {
    const start = new Date(leader.entry_time).getTime();
    const end = new Date(latestExit).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      duration = Math.floor((end - start) / 1000);
    }
  }

  return {
    ...leader,
    // Aggregate fields — override leader's per-leg values.
    total_lots: anyOpen ? totalLotsOpen : 0,
    original_lots: originalLotsSum || leader.original_lots,
    entry_price: entryVwap ?? leader.entry_price,
    exit_price: exitVwap,
    exit_time: latestExit,
    is_open: anyOpen,
    gross_pnl: grossPnl,
    net_pnl: netPnl,
    commission,
    swap,
    r_multiple_actual: rMultiple,
    duration_seconds: duration,
    legs: [...legs].sort(
      (a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime(),
    ),
    isGrouped: legs.length > 1,
  };
}

/**
 * Group broker sibling positions by `group_key`. Rows without a group_key
 * (standalone trades) pass through as single-leg groups.
 *
 * Ordering: preserves the incoming order by using each group's leader
 * entry_time as its sort key (falls back to the row's own entry_time for
 * standalones). Caller may still re-sort afterwards.
 */
export function useGroupedTrades(trades: Trade[] | undefined): GroupedTrade[] {
  return useMemo(() => groupTrades(trades ?? []), [trades]);
}

/** Pure implementation, exported for tests. */
export function groupTrades(trades: Trade[]): GroupedTrade[] {
  const byKey = new Map<string, Trade[]>();
  const singletons: Trade[] = [];
  for (const t of trades) {
    if (t.group_key) {
      const arr = byKey.get(t.group_key);
      if (arr) arr.push(t);
      else byKey.set(t.group_key, [t]);
    } else {
      singletons.push(t);
    }
  }

  const groups: GroupedTrade[] = [];
  for (const legs of byKey.values()) {
    // Singleton groups (only one row with a given key — should be rare, but
    // handle it) collapse to a passthrough.
    if (legs.length === 1) {
      groups.push({ ...legs[0], legs: [legs[0]], isGrouped: false });
    } else {
      groups.push(aggregate(legs));
    }
  }
  for (const t of singletons) {
    groups.push({ ...t, legs: [t], isGrouped: false });
  }

  // Preserve DESC-by-entry-time (matches useTrades default sort).
  groups.sort((a, b) => new Date(b.entry_time).getTime() - new Date(a.entry_time).getTime());
  return groups;
}
