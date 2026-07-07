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
