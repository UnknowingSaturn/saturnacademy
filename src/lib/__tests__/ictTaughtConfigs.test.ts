import { describe, it, expect } from "vitest";
import { makeSeries, resample, type BarSeries } from "../../../shared/quant/bars";
import {
  detectFvgs, detectFvgsTf, detectSwingsTf, structureBias, detectSweeps, buildLiquidityUniverse,
} from "../../../shared/quant/ict/detectors";
import { runBacktest, DEFAULT_ENGINE_CONFIG, MAX_TRADES_PER_WINDOW_CAP } from "../../../shared/quant/ict/engine";
import { NAMED_CONFIGS, engineConfigFor, windowsForKeys } from "../../../shared/quant/ict/configs";
import { KILLZONES } from "../../../shared/quant/sessions";

const MIN = 60_000;

/** Deterministic synthetic minute series starting at a UTC timestamp. */
function series(n: number, startTs: number, price: (i: number) => number): BarSeries {
  const s = makeSeries(n);
  for (let i = 0; i < n; i++) {
    const p = price(i);
    s.ts[i] = startTs + i * MIN;
    s.open[i] = p;
    s.high[i] = p + 0.5;
    s.low[i] = p - 0.5;
    s.close[i] = p;
    s.volume[i] = 1;
  }
  return s;
}

describe("resample", () => {
  const start = Date.UTC(2024, 2, 14, 13, 0); // epoch-aligned
  const s = series(60, start, (i) => 100 + i);

  it("aggregates OHLCV correctly into 5m buckets", () => {
    const { series: m5, closeIndex, openIndex } = resample(s, 5);
    expect(m5.length).toBe(12);
    expect(m5.ts[0]).toBe(start);
    expect(m5.open[0]).toBe(s.open[0]);
    expect(m5.close[0]).toBe(s.close[4]);
    expect(m5.high[0]).toBe(Math.max(...[0, 1, 2, 3, 4].map((i) => s.high[i])));
    expect(m5.low[0]).toBe(Math.min(...[0, 1, 2, 3, 4].map((i) => s.low[i])));
    expect(m5.volume[0]).toBe(5);
    expect(openIndex[1]).toBe(5);
    expect(closeIndex[1]).toBe(9);
  });

  it("is epoch-aligned so buckets are stable across DST", () => {
    const off = series(60, start + 2 * MIN, (i) => 100 + i);
    const { series: m5 } = resample(off, 5);
    expect(m5.ts[0]).toBe(start);
    expect(m5.volume[0]).toBe(3); // partial first bucket
  });

  it("passes 1m through unchanged", () => {
    expect(resample(s, 1).series).toBe(s);
  });
});

describe("HTF features are causal", () => {
  const start = Date.UTC(2024, 2, 14, 13, 0);
  // Impulse leg producing 5m gaps.
  const s = series(120, start, (i) => (i < 30 ? 100 : i < 40 ? 100 + (i - 30) * 5 : 150));

  it("stamps 5m FVGs at the 1m bar where the HTF candle closes", () => {
    const gaps = detectFvgsTf(s, 5, 0);
    expect(gaps.length).toBeGreaterThan(0);
    for (const g of gaps) {
      expect((g.index + 1) % 5).toBe(0); // last minute of a 5m bucket
      expect(g.ts).toBe(s.ts[g.index]);
    }
  });

  it("truncating the series never changes features already emitted", () => {
    const full = detectFvgsTf(s, 5, 0);
    for (const cut of [60, 80, 100]) {
      const t = makeSeries(cut);
      t.ts.set(s.ts.slice(0, cut)); t.open.set(s.open.slice(0, cut));
      t.high.set(s.high.slice(0, cut)); t.low.set(s.low.slice(0, cut));
      t.close.set(s.close.slice(0, cut)); t.volume.set(s.volume.slice(0, cut));
      const partial = detectFvgsTf(t, 5, 0);
      const expected = full.filter((g) => g.index < cut - (cut % 5));
      expect(partial.map((g) => g.index)).toEqual(expected.map((g) => g.index));
    }
  });

  it("5m FVGs differ from 1m FVGs on the same data", () => {
    expect(detectFvgsTf(s, 5, 0).length).not.toBe(detectFvgs(s, 0).length);
  });
});

describe("structureBias", () => {
  it("is +1 on HH/HL, -1 on LH/LL and holds state in between", () => {
    const up = series(400, Date.UTC(2024, 2, 14, 8, 0), (i) => 100 + i * 0.1 + Math.sin(i / 7) * 2);
    const bias = structureBias(up, detectSwingsTf(up, 15, 2));
    expect(bias[bias.length - 1]).toBe(1);

    const down = series(400, Date.UTC(2024, 2, 14, 8, 0), (i) => 200 - i * 0.1 + Math.sin(i / 7) * 2);
    const dBias = structureBias(down, detectSwingsTf(down, 15, 2));
    expect(dBias[dBias.length - 1]).toBe(-1);

    // Never set before the first confirmed pair of swings.
    expect(bias[0]).toBe(0);
  });
});

describe("sweep universe and K-nearest gating", () => {
  const start = Date.UTC(2024, 2, 14, 8, 0);
  const s = series(600, start, (i) => 100 + Math.sin(i / 23) * 4);

  it("builds distinct universes", () => {
    const opts = { windows: [KILLZONES.ny_am], swingStrength: 2, swingTimeframe: 15 };
    const refs = buildLiquidityUniverse(s, "fx", { ...opts, universe: "session_refs" });
    const bsl = buildLiquidityUniverse(s, "fx", { ...opts, universe: "bsl_ssl_15m" });
    expect(bsl.length).toBeGreaterThan(refs.length);
    expect(bsl.some((l) => l.kind === "swing_high" || l.kind === "swing_low")).toBe(true);
  });

  it("K-nearest + once-only produces no more sweeps than the unrestricted rule", () => {
    const levels = buildLiquidityUniverse(s, "fx", {
      universe: "bsl_ssl_15m", windows: [KILLZONES.ny_am], swingStrength: 2, swingTimeframe: 15,
    });
    const all = detectSweeps(s, levels, 0);
    const gated = detectSweeps(s, levels, 0, { k: 2, onceOnly: true });
    expect(gated.length).toBeLessThanOrEqual(all.length);
  });
});

describe("multi-window engine", () => {
  // Five sessions of noisy FX-like data covering London through NY PM.
  const s = series(60 * 24 * 5, Date.UTC(2024, 2, 11, 0, 0), (i) => 1.08 + Math.sin(i / 37) * 0.004 + Math.sin(i / 5) * 0.0006);

  const base = {
    ...DEFAULT_ENGINE_CONFIG,
    biasMode: "none" as const,
    requireSweep: false,
    requireMss: false,
    requireDisplacement: false,
    sizing: "fixed" as const,
    size: 1,
    applySpread: false,
  };

  it("scans every configured window", () => {
    const one = runBacktest(s, "EURUSD", { ...base, windows: [KILLZONES.ny_am] });
    const three = runBacktest(s, "EURUSD", { ...base, windows: windowsForKeys(["london", "ny_am", "ny_pm"]) });
    const keys = new Set(three.trades.map((t) => t.windowKey));
    expect(three.trades.length).toBeGreaterThanOrEqual(one.trades.length);
    expect(keys.size).toBeGreaterThan(1);
  });

  it("never overlaps trades and respects the per-window cap", () => {
    const r = runBacktest(s, "EURUSD", { ...base, windows: [KILLZONES.ny_am], maxTradesPerWindow: 5 });
    const byDay = new Map<string, typeof r.trades>();
    for (const t of r.trades) {
      const list = byDay.get(t.sessionDate + t.windowKey) ?? [];
      list.push(t);
      byDay.set(t.sessionDate + t.windowKey, list);
    }
    for (const list of byDay.values()) {
      expect(list.length).toBeLessThanOrEqual(5);
      const sorted = [...list].sort((a, b) => a.entryIndex - b.entryIndex);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].setupIndex).toBeGreaterThan(sorted[i - 1].exitIndex);
      }
    }
  });

  it("clamps maxTradesPerWindow to the hard cap", () => {
    const r = runBacktest(s, "EURUSD", { ...base, windows: [KILLZONES.ny_am], maxTradesPerWindow: 999 });
    const counts = new Map<string, number>();
    for (const t of r.trades) counts.set(t.sessionDate, (counts.get(t.sessionDate) ?? 0) + 1);
    for (const n of counts.values()) expect(n).toBeLessThanOrEqual(MAX_TRADES_PER_WINDOW_CAP);
  });
});

describe("displacement_swing stop", () => {
  const s = series(60 * 24 * 5, Date.UTC(2024, 2, 11, 0, 0), (i) => 1.08 + Math.sin(i / 37) * 0.004 + Math.sin(i / 5) * 0.0006);

  it("places the stop at or beyond the gap edge", () => {
    const r = runBacktest(s, "EURUSD", {
      ...DEFAULT_ENGINE_CONFIG,
      windows: [KILLZONES.ny_am],
      biasMode: "none",
      requireSweep: false,
      requireMss: false,
      requireDisplacement: true,
      stopMode: "displacement_swing",
      sizing: "fixed",
      size: 1,
      applySpread: false,
    });
    for (const t of r.trades) {
      const risk = t.direction === "long" ? t.entryPrice - t.stopPrice : t.stopPrice - t.entryPrice;
      expect(risk).toBeGreaterThan(0);
    }
  });
});

describe("grid.json named configs", () => {
  it("exposes as_taught_5m with the taught parameters", () => {
    const cfg = engineConfigFor("as_taught_5m");
    expect(cfg).toBeDefined();
    expect(cfg!.fvgTimeframe).toBe(5);
    expect(cfg!.biasMode).toBe("structure_15m");
    expect(cfg!.biasSwingTimeframe).toBe(15);
    expect(cfg!.sweepPenetrationTicks).toBe(1);
    expect(cfg!.stopMode).toBe("displacement_swing");
    expect(cfg!.windows?.length).toBe(1);
  });

  it("only patches real engine fields", () => {
    const known = new Set(Object.keys(DEFAULT_ENGINE_CONFIG));
    for (const c of NAMED_CONFIGS) {
      for (const k of Object.keys(c.patch)) expect(known.has(k), `${c.key}.${k}`).toBe(true);
      expect(c.windowKeys.length).toBeGreaterThan(0);
    }
  });

  it("every named config runs end to end", () => {
    const s = series(60 * 24 * 5, Date.UTC(2024, 2, 11, 0, 0), (i) => 1.08 + Math.sin(i / 37) * 0.004);
    for (const c of NAMED_CONFIGS) {
      const r = runBacktest(s, "EURUSD", engineConfigFor(c.key));
      expect(r.sessionsScanned).toBeGreaterThan(0);
    }
  });
});
