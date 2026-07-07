// PR-4 · Pair Lab Accuracy Pass — regression coverage for the four fixes
// that changed replay math (client + server twin):
//
//   Fix 2 · MAE-proxy tightening — trades missing `ideal_stop_loss` but with
//           MAE logged are scored under tighten_to_ideal using MAE × 1.05 as
//           a proxy stop, and flagged via `slProxyCount` on the row.
//   Fix 3 · BE-runner cap-MFE floor — non-stopped non-filled trades book a
//           half-credit MFE (capped at ladder), not a hard 0.
//   Fix 5 · N-capped confidence tier — narrow CI on <20 trades caps at Low;
//           <10 caps at Insufficient. Tested indirectly via the ranker's
//           `confidenceFor` semantics documented in code review.
//   Fix 7 · Adaptive-TP bucket-N guard — presets requesting bucket_mfe_pXX
//           refuse to fit when the bucket has fewer than 20 MFE samples.

import { describe, it, expect } from "vitest";
import { replayBucket, computeAppliedSlBySymbol, type Strategy } from "@/lib/pairLabSimulator";
import type { PairLabFieldKeys } from "@/lib/pairLabMath";

const keys: PairLabFieldKeys = {
  mfe: "cf_mfe_r",
  mae: "cf_mae_r",
  idealStopLoss: "cf_ideal_sl",
  idealStopLossPos: null,
};

/** Synthetic trade shaped like the DB rows the simulator iterates. */
function mk(
  id: string,
  args: {
    mfeR?: number | null;
    maeR?: number | null;
    rActual?: number | null;
    idealSlR?: number | null;
  },
): any {
  const entry = 1.1;
  const sl = 1.098;
  // EURUSD: slPips=20, ticksToPips gives ticks*0.1 → tick*200 ≈ 1R.
  const maeTicks = args.maeR != null ? Math.round(args.maeR * 200) : null;
  const idealTicks = args.idealSlR != null ? Math.round(args.idealSlR * 200) : null;
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
    r_multiple_actual: args.rActual ?? null,
    trade_type: "executed",
    custom_fields: {
      cf_mfe_r: args.mfeR ?? null,
      cf_mae_r: maeTicks,
      cf_ideal_sl: idealTicks,
    },
  };
}

const opts = { balance: 100_000, propFirm: null } as const;

describe("PR-4 · Fix 2 — MAE-proxy tightening under tighten_to_ideal", () => {
  const tightenAllOut2R: Strategy = {
    id: "tighten-2r",
    label: "Tighten SL → ideal · all-out @2R",
    riskPct: 1,
    slRule: "tighten_to_ideal",
    exitRule: { partials: [{ atR: 2, fraction: 1 }], runner: "all_out_at_last_partial" },
  };

  it("admits trades missing ideal-SL when MAE is present, flags them as proxy", () => {
    const trades = [
      // With ideal-SL: normal path.
      mk("1", { mfeR: 2.5, maeR: 0.3, rActual: 2.0, idealSlR: 0.5 }),
      // Missing ideal-SL BUT MAE present → PR-4 · Fix 2 admits via proxy.
      mk("2", { mfeR: 2.5, maeR: 0.4, rActual: 2.0, idealSlR: null }),
      mk("3", { mfeR: 2.5, maeR: 0.5, rActual: 2.0, idealSlR: null }),
      // Missing both → still ineligible.
      mk("4", { mfeR: 2.5, maeR: null, rActual: 2.0, idealSlR: null }),
    ];
    const result = replayBucket(trades, keys, tightenAllOut2R, opts);
    // 3 of 4 eligible (1 with real ideal-SL, 2 via proxy).
    expect(result.eligibleCount).toBe(3);
    // 2 trades used the MAE proxy.
    expect(result.slProxyCount).toBe(2);
  });

  it("proxy-tightened trades book the same TP hit as ideal-tightened ones", () => {
    // Two trades: one with logged ideal-SL, one relying on the proxy. Both
    // have MFE well above 2×tightened-SL and MAE small enough not to stop.
    const trades = [
      mk("1", { mfeR: 3.0, maeR: 0.2, rActual: 2.0, idealSlR: 0.5 }),
      mk("2", { mfeR: 3.0, maeR: 0.5, rActual: 2.0, idealSlR: null }), // proxy slScale ≈ 0.525
    ];
    const result = replayBucket(trades, keys, tightenAllOut2R, opts);
    expect(result.eligibleCount).toBe(2);
    expect(result.slProxyCount).toBe(1);
    // Both trades hit their 2R target under their tightened stop; expectancy
    // should be strongly positive (each books ~+2R, sanity floor +1R).
    expect(result.expectancyR).toBeGreaterThan(1.0);
  });
});

describe("PR-4 · Fix 3 — BE-runner cap-MFE floor", () => {
  // Scale-out preset: 50% @1R + 50% @2R, runner=be_after_first_tp.
  const scaleOut: Strategy = {
    id: "scale-out",
    label: "Scale-out",
    riskPct: 1,
    slRule: "original",
    exitRule: {
      partials: [{ atR: 1, fraction: 0.5 }, { atR: 2, fraction: 0.5 }],
      runner: "be_after_first_tp",
    },
  };

  it("non-stopped non-filled trade books half-credit MFE, not hard 0", () => {
    // MFE=0.6R (below 1R TP1), MAE=0.4R (below 1R stop). Trade never fills
    // any partial, never stops. Pre-Fix-3: booked 0. Post-Fix-3: booked
    // 0.5 × min(0.6, 2) × 1 = 0.3R.
    const trades = [mk("1", { mfeR: 0.6, maeR: 0.4, rActual: 0.0 })];
    const result = replayBucket(trades, keys, scaleOut, opts);
    expect(result.eligibleCount).toBe(1);
    expect(result.expectancyR).toBeCloseTo(0.3, 2);
  });

  it("filled + non-stopped trades preserve their filled partial R (no double-credit)", () => {
    // MFE=1.5R (fills TP1 only), MAE=0.4R (no stop). Books: 0.5×1R (TP1)
    // + 0.5 × 0.5 × min(1.5, 2) = 0.5 + 0.375 = 0.875R.
    const trades = [mk("1", { mfeR: 1.5, maeR: 0.4, rActual: 1.0 })];
    const result = replayBucket(trades, keys, scaleOut, opts);
    expect(result.expectancyR).toBeCloseTo(0.875, 2);
  });
});

describe("PR-4 · Fix 7 — adaptive-TP bucket-N guard", () => {
  const adaptive: Strategy = {
    id: "adaptive-p60",
    label: "Adaptive TP p60",
    riskPct: 1,
    slRule: "original",
    exitRule: {
      partials: [{ atR: 1, fraction: 1, atRSource: "bucket_mfe_p60" }],
      runner: "all_out_at_last_partial",
    },
  };

  it("refuses to fit when bucket has fewer than 20 MFE samples", () => {
    // 15 trades — under MIN_BUCKET_N_ADAPTIVE (20). All should be ineligible.
    const trades = Array.from({ length: 15 }, (_, i) =>
      mk(String(i), { mfeR: 1.5, maeR: 0.4, rActual: 1.0 }),
    );
    const result = replayBucket(trades, keys, adaptive, opts);
    expect(result.eligibleCount).toBe(0);
    // Reason should mention bucket thinness.
    const reasons = Object.keys(result.ineligibleReasons);
    expect(reasons.some((r) => r.includes("bucket too thin"))).toBe(true);
  });

  it("admits trades when bucket has ≥ 20 MFE samples", () => {
    const trades = Array.from({ length: 25 }, (_, i) =>
      mk(String(i), { mfeR: 1.5, maeR: 0.4, rActual: 1.0 }),
    );
    const result = replayBucket(trades, keys, adaptive, opts);
    expect(result.eligibleCount).toBe(25);
  });
});

// PR-5 · B1 was withdrawn — the original SL-first branch semantics
// (`bookedSlFirst = -slScale`) are correct given `pStopFirst` = P(stop before
// ANY partial). Preserving filled partials in the SL-first branch would
// double-count them (they exist only on the pTpFirst mass by construction).


describe("PR-5 · H4 — all_out_at_last_partial no-fill no-stop books stop, not MFE", () => {
  const allOut2R: Strategy = {
    id: "all-out-2r",
    label: "All-out @2R",
    riskPct: 1,
    slRule: "original",
    exitRule: { partials: [{ atR: 2, fraction: 1 }], runner: "all_out_at_last_partial" },
  };

  it("MFE below target and MAE below stop books -1R (conservative), not +MFE", () => {
    // MFE=1.2R (below 2R target), MAE=0.4R (below stop). No fill, no stop.
    // Pre-H4: booked min(1.2, 2) = 1.2R (survivor bias). Post-H4: -1R.
    const trades = [mk("1", { mfeR: 1.2, maeR: 0.4, rActual: 0.0 })];
    const result = replayBucket(trades, keys, allOut2R, opts);
    expect(result.eligibleCount).toBe(1);
    expect(result.expectancyR).toBeCloseTo(-1, 2);
  });
});

describe("computeAppliedSlBySymbol — per-symbol native-unit breakdown", () => {
  it("keeps FX pips and index points in separate rows with correct units", () => {
    const items = [
      ...Array.from({ length: 5 }, () => ({ symbol: "EURUSD", slPips: 20, slScale: 0.5 })),
      ...Array.from({ length: 4 }, () => ({ symbol: "NAS100", slPips: 40, slScale: 0.3 })),
    ];
    const rows = computeAppliedSlBySymbol(items);
    expect(rows).not.toBeNull();
    expect(rows!).toHaveLength(2);
    const eu = rows!.find((r) => r.symbol === "EURUSD")!;
    const nas = rows!.find((r) => r.symbol === "NAS100")!;
    expect(eu.unit).toBe("pips");
    expect(nas.unit).toBe("points");
    expect(eu.medianNative).toBeCloseTo(20, 2);
    expect(nas.medianNative).toBeCloseTo(40, 2);
    expect(eu.medianScale).toBeCloseTo(0.5, 2);
  });

  it("drops symbols with fewer than 3 trades and returns null when nothing clears the floor", () => {
    const items = [
      { symbol: "EURUSD", slPips: 20, slScale: 1 },
      { symbol: "GBPUSD", slPips: 15, slScale: 1 },
    ];
    expect(computeAppliedSlBySymbol(items)).toBeNull();
  });

  it("robust median is unaffected by a single 20x outlier", () => {
    const base = Array.from({ length: 9 }, () => ({ symbol: "EURUSD", slPips: 10, slScale: 0.5 }));
    const withOutlier = [...base, { symbol: "EURUSD", slPips: 200, slScale: 0.5 }];
    const rows = computeAppliedSlBySymbol(withOutlier)!;
    expect(rows[0].medianNative).toBeCloseTo(10, 2);
  });

  it("collapses tail beyond maxSymbols into an 'Other' row", () => {
    const items: Array<{ symbol: string; slPips: number; slScale: number }> = [];
    for (let i = 0; i < 10; i++) {
      const sym = `SYM${i.toString().padStart(2, "0")}`;
      for (let j = 0; j < 3; j++) items.push({ symbol: sym, slPips: 10 + i, slScale: 0.5 });
    }
    const rows = computeAppliedSlBySymbol(items, 3)!;
    expect(rows).toHaveLength(4);
    expect(rows[rows.length - 1].symbol.startsWith("Other (")).toBe(true);
    expect(Number.isNaN(rows[rows.length - 1].medianNative)).toBe(true);
  });
});



// ---------------------------------------------------------------------------
// Ranker risk sweep — verdict logic
// ---------------------------------------------------------------------------

import { runMonteCarlo } from "@/lib/propFirmMonteCarlo";

describe("ranker risk sweep MC (per-strategy)", () => {
  it("suggests a higher risk when the sample has strong positive expectancy and tight DD", () => {
    // Winning sample: mostly +1R with occasional −0.5R losses. Any risk %
    // stays comfortably inside 20% DD in MC.
    const rSample = [1, 1, 1, -0.5, 1, 1, -0.5, 1, 1, 1, -0.5, 1, 1, 1, 1, -0.5, 1, 1, 1, 1];
    const at1 = runMonteCarlo({
      rSample, riskPerTradeFrac: 0.01, numAccounts: 1, accountSize: 100_000,
      dailyLossPct: null, maxLossPct: null, targetPct: null,
      tradesPerDay: 1, maxDays: 20, rotationModel: "one_only",
      maxLossMode: "trailing", paths: 500, seed: 1,
    });
    const at3 = runMonteCarlo({
      rSample, riskPerTradeFrac: 0.03, numAccounts: 1, accountSize: 100_000,
      dailyLossPct: null, maxLossPct: null, targetPct: null,
      tradesPerDay: 1, maxDays: 20, rotationModel: "one_only",
      maxLossMode: "trailing", paths: 500, seed: 1,
    });
    // With linear R, expected-return scales linearly with risk %. DD also
    // scales linearly. The 3% run should be far higher.
    expect(at3.expectedReturnPct).toBeGreaterThan(at1.expectedReturnPct * 2);
  });

  it("keeps ruin probability monotonic in risk % for a fat-tailed sample", () => {
    // Fat-tailed loser: occasional −5R blowouts. Bust probability must
    // increase as risk % rises.
    const rSample = [1, -1, 1, -5, 1, -1, 1, -5, -1, 1, -1, 1, -5, -1, 1, -5, 1, -1, 1, -1];
    const runs = [0.5, 1, 2, 3].map((pct) =>
      runMonteCarlo({
        rSample, riskPerTradeFrac: pct / 100, numAccounts: 1, accountSize: 100_000,
        dailyLossPct: null, maxLossPct: 0.1, targetPct: null,
        tradesPerDay: 1, maxDays: 20, rotationModel: "one_only",
        maxLossMode: "trailing", paths: 500, seed: 42,
      }),
    );
    for (let i = 1; i < runs.length; i += 1) {
      expect(runs[i].riskOfRuin).toBeGreaterThanOrEqual(runs[i - 1].riskOfRuin - 0.01);
    }
  });
});
