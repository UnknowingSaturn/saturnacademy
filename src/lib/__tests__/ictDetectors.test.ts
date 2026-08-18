import { describe, expect, it } from "vitest";
import { makeSeries, type BarSeries } from "../../../shared/quant/bars";
import {
  atrPoints,
  detectDisplacement,
  detectFvgs,
  detectMss,
  detectSweeps,
  detectSwings,
  fvgFillIndex,
  htfBias,
  priorSessionLevels,
  sessionSpans,
} from "../../../shared/quant/ict/detectors";

/** Deterministic pseudo-random walk on a 1-minute grid starting at a UTC ms. */
function walk(n: number, startMs: number, seed = 7, base = 100): BarSeries {
  const s = makeSeries(n);
  let state = seed >>> 0;
  const rnd = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  let px = base;
  for (let i = 0; i < n; i++) {
    const open = px;
    const drift = (rnd() - 0.5) * 0.6;
    const close = open + drift;
    const wick = rnd() * 0.25;
    s.ts[i] = startMs + i * 60_000;
    s.open[i] = open;
    s.close[i] = close;
    s.high[i] = Math.max(open, close) + wick;
    s.low[i] = Math.min(open, close) - wick;
    s.volume[i] = 100 + Math.floor(rnd() * 50);
    px = close;
  }
  return s;
}

function truncate(s: BarSeries, n: number): BarSeries {
  const t = makeSeries(n);
  t.ts.set(s.ts.subarray(0, n));
  t.open.set(s.open.subarray(0, n));
  t.high.set(s.high.subarray(0, n));
  t.low.set(s.low.subarray(0, n));
  t.close.set(s.close.subarray(0, n));
  t.volume.set(s.volume.subarray(0, n));
  return t;
}

function seriesFrom(rows: Array<[number, number, number, number]>, startMs = Date.UTC(2024, 4, 15, 13, 0)): BarSeries {
  const s = makeSeries(rows.length);
  rows.forEach(([o, h, l, c], i) => {
    s.ts[i] = startMs + i * 60_000;
    s.open[i] = o; s.high[i] = h; s.low[i] = l; s.close[i] = c; s.volume[i] = 1;
  });
  return s;
}

describe("FVG detection", () => {
  it("finds a bullish gap on the confirming bar with correct edges", () => {
    //                open  high  low  close
    const s = seriesFrom([
      [100, 101, 99.5, 100.8],
      [101, 104, 100.8, 103.8],
      [104, 105, 102, 104.5], // low 102 > high 101 of bar 0 → bull FVG 101..102
      [104, 104.6, 103, 103.2],
    ]);
    const gaps = detectFvgs(s);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ index: 2, direction: "bull", proximal: 102, distal: 101 });
    expect(gaps[0].size).toBeCloseTo(1, 10);
    expect(gaps[0].mid).toBeCloseTo(101.5, 10);
  });

  it("finds a bearish gap and its 50% fill index", () => {
    const s = seriesFrom([
      [104, 105, 103.8, 104],
      [103.5, 103.6, 100.5, 100.8],
      [100.6, 102, 100, 100.4], // high 102 < low 103.8 → bear FVG 102..103.8
      [100.4, 101, 100.2, 100.9],
      [101, 103.2, 100.9, 103], // trades to 103.2 → past the 102.9 midpoint
    ]);
    const gaps = detectFvgs(s);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].direction).toBe("bear");
    expect(fvgFillIndex(s, gaps[0], 0)).toBe(4); // touch of the near edge
    expect(fvgFillIndex(s, gaps[0], 0.5)).toBe(4); // 50% = 102.9, high hits 103.2
    expect(fvgFillIndex(s, gaps[0], 1)).toBe(-1); // never reaches 103.8
  });

  it("respects the minimum size filter", () => {
    const s = seriesFrom([
      [100, 101, 99.5, 100.8],
      [101, 104, 100.8, 103.8],
      [104, 105, 101.2, 104.5], // 0.2pt gap
    ]);
    expect(detectFvgs(s, 0.5)).toHaveLength(0);
    expect(detectFvgs(s, 0.1)).toHaveLength(1);
  });
});

describe("swings", () => {
  it("confirms a pivot only after `strength` bars", () => {
    const s = seriesFrom([
      [100, 100.5, 99.5, 100],
      [100, 101, 99.8, 100.9],
      [101, 103, 100.9, 102.8], // pivot high at index 2
      [102.8, 102.9, 101, 101.2],
      [101.2, 101.5, 100, 100.3],
    ]);
    const swings = detectSwings(s, 2);
    const high = swings.find((x) => x.kind === "high");
    expect(high).toMatchObject({ index: 2, confirmedIndex: 4, price: 103 });
  });
});

describe("liquidity levels and sweeps", () => {
  it("stamps prior-session levels as valid only from the next session", () => {
    // Two index-CFD sessions: 15 May and 16 May, RTH bars only.
    const rows: Array<[number, number, number, number]> = [];
    for (let i = 0; i < 60; i++) rows.push([100, 100 + i * 0.05, 99, 100]);
    const day1 = seriesFrom(rows, Date.UTC(2024, 4, 15, 14, 0)); // 10:00 ET
    const day2 = seriesFrom(rows, Date.UTC(2024, 4, 16, 14, 0));
    const s = makeSeries(day1.length + day2.length);
    for (let i = 0; i < s.length; i++) {
      const src = i < day1.length ? day1 : day2;
      const j = i < day1.length ? i : i - day1.length;
      s.ts[i] = src.ts[j]; s.open[i] = src.open[j]; s.high[i] = src.high[j];
      s.low[i] = src.low[j]; s.close[i] = src.close[j]; s.volume[i] = 1;
    }
    const spans = sessionSpans(s, "index");
    expect(spans.map((x) => x.dateKey)).toEqual(["2024-05-15", "2024-05-16"]);

    const levels = priorSessionLevels(s, "index");
    const hi = levels.find((l) => l.kind === "prior_session_high");
    expect(hi?.sourceDate).toBe("2024-05-15");
    expect(hi?.validFromIndex).toBe(day1.length);
    // Every level is only usable from the following session.
    for (const l of levels) expect(l.validFromIndex).toBeGreaterThan(0);
    // RTH levels exist because these bars sit inside 09:30-16:00 ET.
    expect(levels.some((l) => l.kind === "prior_rth_high")).toBe(true);
  });

  it("flags a wick through a level that closes back inside", () => {
    const level = [{ kind: "prior_session_high" as const, price: 105, sourceDate: "2024-05-15", validFromIndex: 0 }];
    const s = seriesFrom([
      [104, 104.5, 103.5, 104],
      [104, 106, 103.9, 104.2], // sweep: high 106 > 105, close 104.2 < 105
      [104.2, 107, 104, 106.5], // break, not a sweep — closes above
    ]);
    const sweeps = detectSweeps(s, level);
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0]).toMatchObject({ index: 1, side: "high", level: 105 });
    expect(sweeps[0].penetration).toBeCloseTo(1, 10);
  });
});

describe("displacement", () => {
  it("ATR is causal and NaN before the period fills", () => {
    const s = walk(200, Date.UTC(2024, 4, 15, 13, 0));
    const atr = atrPoints(s, 14);
    for (let i = 0; i < 14; i++) expect(Number.isNaN(atr[i])).toBe(true);
    expect(atr[14]).toBeGreaterThan(0);
    // Truncating after bar 100 must not change any earlier ATR value.
    const atrShort = atrPoints(truncate(s, 101), 14);
    for (let i = 0; i <= 100; i++) {
      expect(Number.isNaN(atr[i]) ? NaN : atr[i]).toEqual(Number.isNaN(atrShort[i]) ? NaN : atrShort[i]);
    }
  });

  it("percentile mode judges a bar against earlier bodies only", () => {
    const s = walk(400, Date.UTC(2024, 4, 15, 13, 0));
    const full = detectDisplacement(s, { mode: "percentile", lookback: 120, percentile: 0.95 });
    const cut = detectDisplacement(truncate(s, 300), { mode: "percentile", lookback: 120, percentile: 0.95 });
    expect(cut).toEqual(full.filter((d) => d.index < 300));
  });
});

describe("no look-ahead", () => {
  const s = walk(600, Date.UTC(2024, 4, 15, 9, 0));
  const cutoff = 420;
  const short = truncate(s, cutoff);

  it("FVGs before the cutoff are identical on the truncated series", () => {
    expect(detectFvgs(short)).toEqual(detectFvgs(s).filter((g) => g.index < cutoff));
  });

  it("confirmed swings before the cutoff are identical", () => {
    const full = detectSwings(s, 3).filter((x) => x.confirmedIndex < cutoff);
    const cut = detectSwings(short, 3).filter((x) => x.confirmedIndex < cutoff);
    expect(cut).toEqual(full);
  });

  it("MSS events before the cutoff are identical", () => {
    const full = detectMss(s, detectSwings(s, 3)).filter((m) => m.index < cutoff - 3);
    const cut = detectMss(short, detectSwings(short, 3)).filter((m) => m.index < cutoff - 3);
    expect(cut).toEqual(full);
  });

  it("ATR displacement before the cutoff is identical", () => {
    const full = detectDisplacement(s, { mode: "atr", atrMultiple: 1.2 }).filter((d) => d.index < cutoff);
    expect(detectDisplacement(short, { mode: "atr", atrMultiple: 1.2 })).toEqual(full);
  });
});

describe("HTF bias", () => {
  const s = walk(60 * 24 * 4, Date.UTC(2024, 4, 13, 0, 0), 11);

  it("leaves the first session neutral in causal modes", () => {
    const spans = sessionSpans(s, "index");
    const bias = htfBias(s, "index", "prior_close");
    for (let i = spans[0].from; i <= spans[0].to; i++) expect(bias[i]).toBe(0);
  });

  it("prior_close bias for a session never changes when later bars are added", () => {
    const spans = sessionSpans(s, "index");
    const cutoff = spans[Math.min(2, spans.length - 1)].to + 1;
    const full = htfBias(s, "index", "prior_close");
    const cut = htfBias(truncate(s, cutoff), "index", "prior_close");
    for (let i = 0; i < cutoff; i++) expect(cut[i]).toBe(full[i]);
  });

  it("perfect mode is explicitly look-ahead and differs from causal bias", () => {
    const perfect = htfBias(s, "index", "perfect");
    const causal = htfBias(s, "index", "prior_close");
    let diffs = 0;
    for (let i = 0; i < s.length; i++) if (perfect[i] !== causal[i]) diffs++;
    expect(diffs).toBeGreaterThan(0);
  });
});
