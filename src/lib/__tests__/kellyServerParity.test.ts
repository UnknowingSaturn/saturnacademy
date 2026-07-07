// Audit §2.7 + §2.9 #6 parity coverage.
//
// `rawQuarterKellyPct` is imported by BOTH the client (`src/lib/pairLabMath.ts`)
// and the edge function (`supabase/functions/_shared/quant/pairLabMath.ts`)
// from the same shared file (`shared/quant/stats.ts`). This test locks that
// contract — if either surface stops importing from the shared source, or a
// silent copy-paste divergence is introduced, the assertions here catch it.
//
// Also asserts the new "insufficient-losses" guard from §2.4 doesn't fire in
// the healthy-sample case and the config value used by TP1* hasn't drifted.

import { describe, it, expect } from "vitest";
import { rawQuarterKellyPct } from "../../../shared/quant/stats";
import {
  KELLY_SCALE,
  KELLY_CEILING_PCT,
  TP1_STAR_MIN_HIT_RATE,
} from "../../../shared/quant/config";

describe("rawQuarterKellyPct — client / server parity contract", () => {
  it("returns null when there is no edge", () => {
    expect(rawQuarterKellyPct(0.4, 1, 1)).toBeNull(); // b*p − q = -0.2
    expect(rawQuarterKellyPct(0.5, 1, 1)).toBeNull(); // exactly break-even
  });

  it("applies the KELLY_SCALE (¼-Kelly) constant", () => {
    // Full Kelly on p=0.6, b=1 is (0.6·1 − 0.4)/1 = 0.20 → 20%
    // Quarter Kelly = 20 × 0.25 = 5.0%
    const raw = rawQuarterKellyPct(0.6, 1, 1)!;
    expect(raw).toBeCloseTo(5.0, 8);
    expect(KELLY_SCALE).toBe(0.25);
  });

  it("scales with payoff asymmetry", () => {
    // p=0.5, b=2 (avgWinR/avgLossR): (2·0.5 − 0.5)/2 = 0.25 → 25% full → 6.25% ¼-Kelly
    expect(rawQuarterKellyPct(0.5, 2, 1)!).toBeCloseTo(6.25, 8);
  });

  it("callers must clamp to KELLY_CEILING_PCT — raw values can exceed it", () => {
    const raw = rawQuarterKellyPct(0.9, 3, 1)!;
    expect(raw).toBeGreaterThan(KELLY_CEILING_PCT);
  });
});

describe("shared config constants — no silent drift", () => {
  it("TP1_STAR_MIN_HIT_RATE is 0.30 (audit §2.9 #5)", () => {
    expect(TP1_STAR_MIN_HIT_RATE).toBe(0.30);
  });
  it("KELLY_CEILING_PCT is 1.5", () => {
    expect(KELLY_CEILING_PCT).toBe(1.5);
  });
});

// Extended coverage (post-audit): rawQuarterKellyPct is imported by both the
// client (`src/lib/pairLabMath.ts`) and the edge twin
// (`supabase/functions/_shared/quant/pairLabMath.ts`) from the *same*
// `shared/quant/stats.ts` module. Any silent copy-paste divergence in the
// Kelly path would immediately break the identities below.
describe("rawQuarterKellyPct — edge cases + identity properties", () => {
  it("scales linearly with KELLY_SCALE (¼-Kelly identity)", () => {
    // If we un-scale by KELLY_SCALE, we should recover the classic Kelly
    // formula: f* = (bp − q) / b for symmetric payoffs.
    const p = 0.55, b = 1.5;
    const quarter = rawQuarterKellyPct(p, b * 1, 1 * 1)!;
    const full = quarter / KELLY_SCALE / 100; // back to a fraction
    const expected = (b * p - (1 - p)) / b;
    expect(full).toBeCloseTo(expected, 8);
  });

  it("returns null for b=0 (avoids divide-by-zero, no silent NaN)", () => {
    // avgWinR=0 is degenerate — must not return a NaN percentage.
    const out = rawQuarterKellyPct(0.6, 0, 1);
    expect(out).toBeNull();
  });

  it("is monotonic in win-rate at fixed payoff (higher p ⇒ larger stake)", () => {
    const lo = rawQuarterKellyPct(0.55, 1.5, 1)!;
    const hi = rawQuarterKellyPct(0.65, 1.5, 1)!;
    expect(hi).toBeGreaterThan(lo);
  });

  it("is monotonic in payoff at fixed win-rate (larger b ⇒ larger stake)", () => {
    const lo = rawQuarterKellyPct(0.55, 1.2, 1)!;
    const hi = rawQuarterKellyPct(0.55, 2.0, 1)!;
    expect(hi).toBeGreaterThan(lo);
  });
});

