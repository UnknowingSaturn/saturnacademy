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
