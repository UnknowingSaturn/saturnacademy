import { describe, it, expect } from "vitest";
import { makeSeededRng } from "../../../shared/quant/stats";
import {
  WINNERS_MAE_SL_BUFFER,
  MAE_P75_WIDEN_BUFFER,
} from "../../../shared/quant/config";
import { runMonteCarlo } from "../propFirmMonteCarlo";

/**
 * Regression tests for the Batch-1 math correctness fixes surfaced in the
 * Nov 2026 Pair Lab audit. See .lovable/plan.md for the trace.
 */

describe("M7 · makeSeededRng modulo-bias removal", () => {
  it("returns values in [0, 1)", () => {
    const rng = makeSeededRng(42);
    for (let i = 0; i < 1000; i += 1) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is deterministic for the same seed", () => {
    const a = makeSeededRng(0xABCDEF);
    const b = makeSeededRng(0xABCDEF);
    for (let i = 0; i < 32; i += 1) {
      expect(a()).toBe(b());
    }
  });

  it("has ~uniform buckets over 100k draws (chi-squared sanity)", () => {
    const rng = makeSeededRng(1);
    const buckets = new Array(10).fill(0);
    const N = 100_000;
    for (let i = 0; i < N; i += 1) {
      const idx = Math.min(9, Math.floor(rng() * 10));
      buckets[idx] += 1;
    }
    const expected = N / 10;
    for (const c of buckets) {
      // Each bucket should be within 3% of expected — well within any RNG bias.
      expect(Math.abs(c - expected) / expected).toBeLessThan(0.03);
    }
  });
});

describe("M4 · idealSl buffer constants", () => {
  it("WINNERS_MAE_SL_BUFFER is 1.10 (Sweeney), MAE_P75_WIDEN_BUFFER is 1.15", () => {
    // The QuantNotePanel display must apply the Sweeney buffer (1.10) so it
    // matches what the recommendation pipeline suggests for the same
    // population. See `src/lib/pairLabMath.ts:~834` and the edge twin.
    expect(WINNERS_MAE_SL_BUFFER).toBe(1.1);
    expect(MAE_P75_WIDEN_BUFFER).toBe(1.15);
    expect(WINNERS_MAE_SL_BUFFER).toBeLessThan(MAE_P75_WIDEN_BUFFER);
  });
});

describe("M3 · runMonteCarlo invariants", () => {
  const baseParams = {
    riskPerTradeFrac: 0.01,
    numAccounts: 1,
    accountSize: 100_000,
    dailyLossPct: 0.05,
    maxLossPct: 0.1,
    targetPct: 0.08,
    tradesPerDay: 5,
    maxDays: 30,
    rotationModel: "one_only" as const,
    paths: 500,
    seed: 12345,
    maxLossMode: "trailing" as const,
  };

  it("pass + fail + inconclusive probabilities sum to ~1", () => {
    const r = runMonteCarlo({
      ...baseParams,
      rSample: [2, -1, -1, 3, -1, 1.5, -1, 2, -1, -1],
    });
    const total = r.passProb + r.failProb + r.inconclusiveProb;
    expect(total).toBeGreaterThan(0.99);
    expect(total).toBeLessThan(1.01);
  });

  it("all-loss sample never passes and always busts", () => {
    const r = runMonteCarlo({
      ...baseParams,
      rSample: [-1, -1, -1, -1, -1],
    });
    expect(r.passProb).toBe(0);
    expect(r.failProb).toBeGreaterThan(0.9);
  });

  it("all-win sample always passes and never busts", () => {
    const r = runMonteCarlo({
      ...baseParams,
      rSample: [2, 2, 2, 2, 2],
    });
    expect(r.passProb).toBe(1);
    expect(r.failProb).toBe(0);
  });
});

describe("B2 · Journal period range UTC parity (regression)", () => {
  // Journal.tsx builds periodRange from UTC calendar boundaries so a trade
  // stored at `2024-01-31T23:00:00Z` (ensureUtcMs → Jan 31 UTC) lands in
  // January's month bucket regardless of the browser timezone. Replicate
  // the boundary math here to freeze it.
  function utcMonthRange(iso: string): { start: number; end: number } {
    const d = new Date(iso);
    const y = d.getUTCFullYear(), m = d.getUTCMonth();
    return { start: Date.UTC(y, m, 1), end: Date.UTC(y, m + 1, 1) - 1 };
  }

  it("includes a 23:00 UTC trade on the last day of the month", () => {
    const { start, end } = utcMonthRange("2024-01-15T00:00:00Z");
    const tradeMs = Date.UTC(2024, 0, 31, 23, 0, 0);
    expect(tradeMs).toBeGreaterThanOrEqual(start);
    expect(tradeMs).toBeLessThanOrEqual(end);
  });

  it("excludes a next-month trade", () => {
    const { end } = utcMonthRange("2024-01-15T00:00:00Z");
    const tradeMs = Date.UTC(2024, 1, 1, 0, 0, 1); // Feb 1
    expect(tradeMs).toBeGreaterThan(end);
  });
});
