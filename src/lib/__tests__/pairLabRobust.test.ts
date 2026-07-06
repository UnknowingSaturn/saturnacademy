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
import { replayBucket, type Strategy } from "@/lib/pairLabSimulator";
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
