// PR-3 · P0 regression coverage for the Deno server strategy simulator.
//
// The AI-generated quant note is built from `replayAllPresets` in
// `supabase/functions/_shared/quant/pairLabSimulator.ts`. Before PR-3 that
// file was missing two fixes the client received months ago:
//
//   P0-A · early `return { ineligible: "unproven target" }` inside the partial
//          loop caused survivorship bias on multi-TP presets — only trades
//          that hit every rung survived, inflating win-rate and expectancy.
//   P0-B · missing Brownian-bridge ordering mixture caused "both TP and SL
//          breached" trades to always be booked as TP-first, inflating early-
//          TP expectancy by 10–30%.
//
// These tests assert the fixed behaviour on the server twin directly.

import { describe, it, expect } from "vitest";
import { replayAllPresets } from "../../../supabase/functions/_shared/quant/pairLabSimulator";
import type { PairLabFieldKeys } from "../pairLabMath";

const keys: PairLabFieldKeys = {
  mfe: "cf_mfe_r",
  mae: "cf_mae_r",
  idealStopLoss: "cf_ideal_stop_loss_ticks",
  idealStopLossPos: null,
};

/** Synthetic trade shaped like the DB rows the server iterates. */
function mk(
  id: string,
  args: {
    mfeR: number | null;
    /** Positive value in R units. Server stores tick MAE; we bypass by
     *  going through the cf field which the server also reads. */
    maeR: number | null;
    rActual: number | null;
  },
): any {
  const entry = 1.1;
  const sl = 1.098;
  // Encode |maeR| as ticks so ticksToPips(EURUSD, ticks) / slPips ≈ maeR.
  // For EURUSD: slPips = 20, ticksToPips gives ticks * 0.1 (10-tick pip).
  // So mae ticks = maeR * slPips / 0.1 = maeR * 200.
  const maeTicks = args.maeR != null ? Math.round(args.maeR * 200) : null;
  return {
    id,
    user_id: "u",
    symbol: "EURUSD",
    entry_price: entry,
    sl_initial: sl,
    entry_time: `2024-01-${((Number(id) % 27) + 1).toString().padStart(2, "0")}T09:30:00Z`,
    is_open: false,
    is_archived: false,
    net_pnl: (args.rActual ?? 0) * 100,
    r_multiple_actual: args.rActual,
    cf_mfe_r: args.mfeR,
    cf_mae_r: maeTicks,
    cf_ideal_stop_loss_ticks: null,
  };
}

describe("PR-3 · server replayAllPresets (P0-A survivorship-bias fix)", () => {
  // Build a set where MOST trades hit TP1 but not TP2. Pre-P0-A, any preset
  // with a second rung would have dropped nearly every one of these as
  // "unproven target" and the surviving pool would be a fake-perfect
  // small subset. Post-fix, those trades book their honest outcome.
  const trades: any[] = [];
  for (let i = 0; i < 50; i++) trades.push(mk(String(i), { mfeR: 1.4, maeR: 0.5, rActual: 1.1 })); // TP1-only winners
  for (let i = 50; i < 80; i++) trades.push(mk(String(i), { mfeR: 0.6, maeR: 1.05, rActual: -1 })); // clean losers

  const rows = replayAllPresets(trades, keys);
  const scaleOut = rows.find((r) => r.presetId === "scale-out")!;
  const runner = rows.find((r) => r.presetId === "runner")!;

  it("scale-out preset admits the TP1-only winners (no survivorship dropout)", () => {
    // 80 total closed trades — all should be eligible under scale-out because
    // MFE + MAE are logged. Pre-fix, the 50 TP1-only winners were dropped as
    // "unproven 2R target" and eligible pool collapsed to the losers.
    expect(scaleOut.nEligible).toBe(80);
  });

  it("runner preset (33/33/trail) admits the TP1-only winners", () => {
    expect(runner.nEligible).toBe(80);
  });

  it("scale-out expectancy is realistic (not inflated by survivorship)", () => {
    // If the fix regressed, scale-out would either drop TP1-only winners
    // (leaving mostly losers → strongly negative expectancy) or double-book
    // them (spuriously positive). Realistic range is between the two.
    expect(scaleOut.expectancyR).toBeGreaterThan(-0.5);
    expect(scaleOut.expectancyR).toBeLessThan(1.5);
  });
});

describe("PR-3 · server replayAllPresets (P0-B Brownian-bridge fix)", () => {
  // Every trade has BOTH TP1 AND the counterfactual SL breached (mfeR ≥ 1
  // AND maeR ≥ 1). Pre-P0-B the server booked all of these as TP-first
  // wins (+1R). Post-fix they get blended with the SL-first outcome.
  const trades: any[] = [];
  for (let i = 0; i < 60; i++) {
    trades.push(mk(String(i), { mfeR: 1.2, maeR: 1.2, rActual: -0.4 }));
  }

  const rows = replayAllPresets(trades, keys);
  const quickFlip = rows.find((r) => r.presetId === "quick-flip")!;

  it("quick-flip on ambiguous trades is NOT booked as pure win", () => {
    // Symmetric breach ⇒ pTpFirst ≈ 0.5 ⇒ expectancy ≈ 0.5×(+1) + 0.5×(-1) = 0.
    // Pre-fix would report expectancy = +1. Post-fix must be well below 0.5.
    expect(quickFlip.expectancyR).toBeLessThan(0.3);
    expect(quickFlip.expectancyR).toBeGreaterThan(-0.3);
  });

  it("optimistic replayMode reproduces the legacy (TP-first) result", () => {
    const optimistic = replayAllPresets(trades, keys, { replayMode: "optimistic" });
    const qf = optimistic.find((r) => r.presetId === "quick-flip")!;
    // Optimistic = TP-first = every ambiguous trade books +1R.
    expect(qf.expectancyR).toBeCloseTo(1, 6);
  });

  it("pessimistic replayMode floors ambiguous trades at SL-first (−1R)", () => {
    const pessimistic = replayAllPresets(trades, keys, { replayMode: "pessimistic" });
    const qf = pessimistic.find((r) => r.presetId === "quick-flip")!;
    expect(qf.expectancyR).toBeCloseTo(-1, 6);
  });
});
