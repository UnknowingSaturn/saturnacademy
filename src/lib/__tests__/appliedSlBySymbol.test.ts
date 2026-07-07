// Coverage for the three branches of computeAppliedSlBySymbol
// (src/lib/pairLabSimulator.ts:245). See .lovable/plan.md Section 5.

import { describe, it, expect } from "vitest";
import { computeAppliedSlBySymbol } from "../pairLabSimulator";

describe("computeAppliedSlBySymbol", () => {
  it("returns null when every symbol falls below the min-per-symbol floor", () => {
    // Two symbols, 1 & 2 samples each — both < minPerSymbol=3 → null.
    const out = computeAppliedSlBySymbol([
      { symbol: "EURUSD", slPips: 20, slScale: 1.0 },
      { symbol: "GBPUSD", slPips: 25, slScale: 1.1 },
      { symbol: "GBPUSD", slPips: 27, slScale: 1.2 },
    ]);
    expect(out).toBeNull();
  });

  it("returns null when input is empty", () => {
    expect(computeAppliedSlBySymbol([])).toBeNull();
  });

  it("drops sub-floor symbols but keeps symbols with n >= minPerSymbol", () => {
    const out = computeAppliedSlBySymbol([
      // EURUSD has 3 → kept.
      { symbol: "EURUSD", slPips: 10, slScale: 1.0 },
      { symbol: "EURUSD", slPips: 20, slScale: 1.5 },
      { symbol: "EURUSD", slPips: 30, slScale: 2.0 },
      // GBPUSD has 1 → dropped.
      { symbol: "GBPUSD", slPips: 100, slScale: 3.0 },
    ]);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(1);
    expect(out![0].symbol).toBe("EURUSD");
    expect(out![0].n).toBe(3);
    expect(out![0].medianNative).toBe(20);
  });

  it("collapses the tail into an 'Other' row with median-of-medians scale", () => {
    // Build 9 symbols each with 3 samples. maxSymbols=8 (default) → 1 tail row.
    const items: Array<{ symbol: string; slPips: number; slScale: number }> = [];
    const scales = [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8];
    scales.forEach((s, i) => {
      const sym = `SYM${String.fromCharCode(65 + i)}`; // SYMA..SYMI
      // Make n a distinguishing feature: SYMA has 5 samples, others 3 —
      // ensures sort-by-n keeps SYMA in the top-8 kept slice, tail = 1 row.
      const count = i === 0 ? 5 : 3;
      for (let k = 0; k < count; k += 1) {
        items.push({ symbol: sym, slPips: 10 + i, slScale: s });
      }
    });
    const out = computeAppliedSlBySymbol(items);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(9); // 8 kept + 1 "Other"
    const other = out![out!.length - 1];
    expect(other.symbol).toMatch(/^Other/);
    expect(other.n).toBe(3); // sum of tail (1 dropped symbol × 3 samples)
    expect(Number.isNaN(other.medianNative)).toBe(true);
    expect(Number.isNaN(other.iqrNative[0])).toBe(true);
    // medianScale on the "Other" row is a median of the dropped symbols'
    // median scales — 1 dropped ⇒ that one value.
    expect(Number.isFinite(other.medianScale)).toBe(true);
  });

  it("filters non-positive slPips and slScale", () => {
    const out = computeAppliedSlBySymbol([
      { symbol: "EURUSD", slPips: 10, slScale: 1.0 },
      { symbol: "EURUSD", slPips: 20, slScale: 1.0 },
      { symbol: "EURUSD", slPips: 30, slScale: 1.0 },
      // These four are all invalid — should be ignored.
      { symbol: "EURUSD", slPips: 0, slScale: 1.0 },
      { symbol: "EURUSD", slPips: -5, slScale: 1.0 },
      { symbol: "EURUSD", slPips: 10, slScale: 0 },
      { symbol: "EURUSD", slPips: 10, slScale: -1 },
    ]);
    expect(out).not.toBeNull();
    expect(out![0].n).toBe(3);
  });
});
