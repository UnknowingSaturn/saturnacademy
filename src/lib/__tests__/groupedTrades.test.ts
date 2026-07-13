// Unit tests for the multi-TP sibling grouping selector.
// Covers: aggregation VWAP/PnL, standalone passthrough, mixed open/closed
// groups, and preservation of leg ordering.

import { describe, it, expect } from "vitest";
import { groupTrades } from "@/hooks/useGroupedTrades";
import type { Trade } from "@/types/trading";

function makeTrade(overrides: Partial<Trade>): Trade {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    user_id: "u",
    account_id: "a",
    terminal_id: null,
    ticket: 0,
    symbol: "EURUSD",
    direction: "buy",
    total_lots: 0,
    original_lots: 1,
    entry_price: 1,
    entry_time: "2026-07-13T11:18:07Z",
    exit_price: null,
    exit_time: null,
    sl_initial: null,
    tp_initial: null,
    sl_final: null,
    tp_final: null,
    gross_pnl: null,
    commission: 0,
    swap: 0,
    net_pnl: null,
    r_multiple_planned: null,
    r_multiple_actual: null,
    session: null,
    duration_seconds: null,
    partial_closes: [],
    is_open: false,
    created_at: "",
    updated_at: "",
    balance_at_entry: null,
    equity_at_entry: null,
    playbook_id: null,
    alignment: null,
    entry_timeframes: null,
    profile: null,
    place: null,
    actual_playbook_id: null,
    actual_profile: null,
    actual_regime: null,
    trade_number: null,
    trade_type: "executed",
    risk_percent: null,
    ...overrides,
  } as Trade;
}

describe("groupTrades", () => {
  it("passes standalone trades through unchanged", () => {
    const t = makeTrade({ id: "solo", net_pnl: 42, is_open: false, exit_price: 1.1 });
    const [g] = groupTrades([t]);
    expect(g.isGrouped).toBe(false);
    expect(g.id).toBe("solo");
    expect(g.net_pnl).toBe(42);
    expect(g.legs).toHaveLength(1);
  });

  it("aggregates a closed 3-leg group with VWAP entry/exit and summed PnL", () => {
    const key = "grp1";
    const legs = [
      makeTrade({
        id: "L", group_key: key, group_role: "leader",
        entry_price: 1.3389, original_lots: 4.35, exit_price: 1.34, is_open: false,
        gross_pnl: 100, net_pnl: 95, r_multiple_actual: 1,
        entry_time: "2026-07-13T11:18:07Z", exit_time: "2026-07-13T12:00:00Z",
      }),
      makeTrade({
        id: "l2", group_key: key, group_role: "leg",
        entry_price: 1.3390, original_lots: 4.35, exit_price: 1.35, is_open: false,
        gross_pnl: 150, net_pnl: 145, r_multiple_actual: 2,
        entry_time: "2026-07-13T11:18:07Z", exit_time: "2026-07-13T12:30:00Z",
      }),
      makeTrade({
        id: "l3", group_key: key, group_role: "leg",
        entry_price: 1.3389, original_lots: 4.34, exit_price: 1.36, is_open: false,
        gross_pnl: 200, net_pnl: 195, r_multiple_actual: 3,
        entry_time: "2026-07-13T11:18:07Z", exit_time: "2026-07-13T13:00:00Z",
      }),
    ];
    const [g] = groupTrades(legs);
    expect(g.isGrouped).toBe(true);
    expect(g.id).toBe("L"); // leader wins
    expect(g.legs).toHaveLength(3);
    expect(g.net_pnl).toBeCloseTo(95 + 145 + 195, 6);
    expect(g.gross_pnl).toBeCloseTo(100 + 150 + 200, 6);
    // Entry VWAP: weights 4.35, 4.35, 4.34 → basically the avg of prices.
    expect(g.entry_price).toBeCloseTo(
      (4.35 * 1.3389 + 4.35 * 1.339 + 4.34 * 1.3389) / (4.35 + 4.35 + 4.34),
      6,
    );
    expect(g.exit_price).toBeCloseTo(
      (4.35 * 1.34 + 4.35 * 1.35 + 4.34 * 1.36) / (4.35 + 4.35 + 4.34),
      6,
    );
    // R = SUM of leg Rs (cumulative). 1 + 2 + 3 = 6.
    expect(g.r_multiple_actual).toBeCloseTo(6, 6);
    expect(g.is_open).toBe(false);
    expect(g.exit_time).toBe("2026-07-13T13:00:00Z"); // latest close
  });

  it("keeps is_open=true and null PnL when any leg is still open", () => {
    const key = "grp2";
    const legs = [
      makeTrade({ id: "a", group_key: key, group_role: "leader", is_open: false, net_pnl: 50, exit_price: 1.1 }),
      makeTrade({ id: "b", group_key: key, group_role: "leg", is_open: true, total_lots: 1 }),
    ];
    const [g] = groupTrades(legs);
    expect(g.is_open).toBe(true);
    expect(g.net_pnl).toBeNull();
    expect(g.exit_price).toBeNull();
    expect(g.total_lots).toBe(1); // sum of open legs' remaining lots
  });

  it("sorts result descending by entry_time", () => {
    const trades = [
      makeTrade({ id: "old", entry_time: "2026-01-01T00:00:00Z" }),
      makeTrade({ id: "new", entry_time: "2026-07-01T00:00:00Z" }),
    ];
    const g = groupTrades(trades);
    expect(g.map((x) => x.id)).toEqual(["new", "old"]);
  });

  it("tallies mixed outcome group (TP win + SL loss) at leg granularity", () => {
    const key = "mix";
    const legs = [
      makeTrade({ id: "w", group_key: key, group_role: "leader",
        is_open: false, net_pnl: 100, exit_price: 1.1, original_lots: 1 }),
      makeTrade({ id: "l", group_key: key, group_role: "leg",
        is_open: false, net_pnl: -40, exit_price: 0.99, original_lots: 1 }),
    ];
    const [g] = groupTrades(legs);
    expect(g.legs_win).toBe(1);
    expect(g.legs_loss).toBe(1);
    expect(g.legs_be).toBe(0);
    expect(g.outcome_mix).toBe("mixed");
    expect(g.net_pnl).toBeCloseTo(60);
  });

  it("standalone trade populates leg tallies for the totals bar", () => {
    const t = makeTrade({ id: "solo", is_open: false, net_pnl: 25, exit_price: 1.1 });
    const [g] = groupTrades([t]);
    expect(g.leg_count).toBe(1);
    expect(g.legs_win).toBe(1);
    expect(g.outcome_mix).toBe("all_win");
  });
});
