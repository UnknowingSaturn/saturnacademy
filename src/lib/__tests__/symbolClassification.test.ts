import { describe, it, expect } from "vitest";
import {
  classifySymbol,
  tickSizeForSymbol,
  pipSizeForSymbol,
} from "../../../shared/quant/symbolMapping";

/**
 * Regression: SP500 (bare canonical) was silently classified as "unknown"
 * because the index regex only matched `SPX` / `US500` substrings. That
 * pushed tick size to the fx5 fallback (0.0001) and inflated MAE / SL-drift
 * displays by ~10,000×. Guard the common bare index aliases so this can't
 * regress. See .lovable/plan.md for the trace.
 */
describe("classifySymbol — bare index aliases", () => {
  const indexAliases = [
    "SP500", "SPX500", "US500", "SPX", "ES",
    "NAS100", "NDX100", "NDX", "NAS", "US100", "USTEC", "NQ",
    "US30", "DJ30", "DJI", "YM",
    "GER40", "DE40", "DAX", "GER30",
    "UK100", "FTSE",
    "JPN225", "JP225", "NIKKEI",
    "RTY", "US2000", "RUSSELL",
  ];
  for (const s of indexAliases) {
    it(`classifies ${s} as "index"`, () => {
      expect(classifySymbol(s)).toBe("index");
    });
  }

  it("SP500 tick size is 0.25, pip size equals tick on indices", () => {
    expect(tickSizeForSymbol("SP500")).toBe(0.25);
    expect(pipSizeForSymbol("SP500")).toBe(0.25);
  });

  it("SP500 11.6-point stop yields ~46 ticks, not 116000", () => {
    const pip = pipSizeForSymbol("SP500");
    const tick = tickSizeForSymbol("SP500");
    const slDistPips = 11.6 / pip;
    const slTicks = (slDistPips * pip) / tick;
    expect(slTicks).toBeCloseTo(46.4, 1);
  });
});

/**
 * V4 regression: short 2-char futures roots (ES / NQ / YM / RTY) previously
 * substring-matched inside exotic broker symbols and mis-classified them as
 * indices. Anchor them so only real futures roots (with a valid month/digit
 * suffix or bare) classify as index.
 */
describe("classifySymbol — short-root anchoring (V4)", () => {
  it("XNQUSD is NOT an index (fx5 fallback)", () => {
    expect(classifySymbol("XNQUSD")).not.toBe("index");
  });
  it("ESGOLD is NOT an index", () => {
    expect(classifySymbol("ESGOLD")).not.toBe("index");
  });
  it("bare ES / NQ / YM / RTY still classify as index", () => {
    expect(classifySymbol("ES")).toBe("index");
    expect(classifySymbol("NQ")).toBe("index");
    expect(classifySymbol("YM")).toBe("index");
    expect(classifySymbol("RTY")).toBe("index");
  });
  it("ES futures month-coded roots classify as index", () => {
    expect(classifySymbol("ESM24")).toBe("index");
    expect(classifySymbol("NQU25")).toBe("index");
    expect(classifySymbol("ES.f")).toBe("index");
    expect(classifySymbol("NQ_H24")).toBe("index");
  });
});
