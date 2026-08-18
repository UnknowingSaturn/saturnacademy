import { describe, expect, it } from "vitest";
import { makeSeries, type BarSeries } from "../../../shared/quant/bars";
import { KILLZONES } from "../../../shared/quant/sessions";
import {
  DEFAULT_ENGINE_CONFIG,
  runBacktest,
  summarize,
  type EngineConfig,
} from "../../../shared/quant/ict/engine";
import { instrumentSpec, pointsToCash, type InstrumentSpec } from "../../../shared/quant/ict/instruments";

type Row = [open: number, high: number, low: number, close: number];

/** 2024-03-13 14:00 UTC = 10:00 ET (EDT) — the first minute of the NY AM killzone. */
const NY_AM_START = Date.UTC(2024, 2, 13, 14, 0, 0);

/** Frictionless spec so P&L math is readable: 1 point = $1, no costs. */
const CLEAN: InstrumentSpec = {
  symbol: "TEST", cls: "index", tickSize: 0.25, tickValue: 0.25,
  commissionPerSide: 0, slippageTicks: 0,
};

function fromRows(rows: Row[], startMs = NY_AM_START): BarSeries {
  const s = makeSeries(rows.length);
  rows.forEach(([o, h, l, c], i) => {
    s.ts[i] = startMs + i * 60_000;
    s.open[i] = o; s.high[i] = h; s.low[i] = l; s.close[i] = c; s.volume[i] = 100;
  });
  return s;
}

function flat(n: number, px: number): Row[] {
  return Array.from({ length: n }, () => [px, px + 0.5, px - 0.5, px] as Row);
}

/**
 * Bull FVG at index 12 (high[10] = 101 < low[12] = 101.5):
 *   proximal 101.5, distal 101, gap 0.5 pts.
 * With a 2-tick (0.5 pt) buffer: stop 100.5, risk 1.0 pt, 2R target 103.5.
 */
function bullSetup(lastBar: Row): BarSeries {
  const rows: Row[] = [
    ...flat(10, 100),
    [100, 101, 99.8, 101],      // 10
    [101, 103, 100.4, 103],     // 11 impulse (low overlaps bar 9 -> no earlier gap)
    [103, 104, 101.5, 103.5],   // 12 FVG confirm
    [103.5, 103.5, 101.4, 102], // 13 pullback -> limit fill at 101.5

    lastBar,                    // 14 resolution bar
    ...flat(20, 103),
  ];
  return fromRows(rows);
}

const BASE: Partial<EngineConfig> = {
  window: KILLZONES.ny_am,
  biasMode: "none",
  requireSweep: false,
  requireMss: false,
  requireDisplacement: false,
  entry: "proximal",
  stopMode: "gap",
  stopBufferTicks: 2,
  targetMode: "r",
  targetR: 2,
};

describe("ICT execution engine", () => {
  it("fills the limit entry and books a clean 2R winner", () => {
    const s = bullSetup([102, 103.6, 101.9, 103.5]);
    const { trades, noTrades } = runBacktest(s, "TEST", BASE, CLEAN);

    expect(trades).toHaveLength(1);
    expect(noTrades).toHaveLength(0);
    const t = trades[0];
    expect(t.direction).toBe("long");
    expect(t.entryIndex).toBe(13);
    expect(t.entryPrice).toBeCloseTo(101.5, 10);
    expect(t.stopPrice).toBeCloseTo(100.5, 10);
    expect(t.targetPrice).toBeCloseTo(103.5, 10);
    expect(t.exitReason).toBe("target");
    expect(t.riskPoints).toBeCloseTo(1, 10);
    expect(t.rMultiple).toBeCloseTo(2, 6);
    expect(t.ambiguousBar).toBe(false);
    expect(t.journalSession).toBe("new_york_am");
  });

  it("gives the stop priority on an ambiguous bar and flags it", () => {
    const s = bullSetup([102, 103.6, 100.4, 103.5]); // hits target AND stop
    const { trades } = runBacktest(s, "TEST", BASE, CLEAN);

    expect(trades).toHaveLength(1);
    expect(trades[0].exitReason).toBe("stop");
    expect(trades[0].ambiguousBar).toBe(true);
    expect(trades[0].rMultiple).toBeCloseTo(-1, 6);
  });

  it("applies slippage adversely on entry and stop, never on the target limit", () => {
    const spec: InstrumentSpec = { ...CLEAN, slippageTicks: 1 }; // 0.25 pt
    const stopped = runBacktest(bullSetup([102, 102.2, 100.4, 100.6]), "TEST", BASE, spec).trades[0];
    expect(stopped.entryPrice).toBeCloseTo(101.75, 10);
    expect(stopped.exitPrice).toBeCloseTo(100.25, 10);

    const won = runBacktest(bullSetup([102, 103.6, 101.9, 103.5]), "TEST", BASE, spec).trades[0];
    expect(won.exitPrice).toBeCloseTo(103.5, 10);
    // Entry paid 0.25 more, target unchanged -> worse than a clean 2R.
    expect(won.rMultiple).toBeLessThan(2);
  });

  it("charges round-turn commission and converts points to cash by tick value", () => {
    const spec: InstrumentSpec = { ...CLEAN, tickValue: 5, commissionPerSide: 2 }; // NQ-like
    const t = runBacktest(bullSetup([102, 103.6, 101.9, 103.5]), "TEST", { ...BASE, size: 2 }, spec).trades[0];
    expect(t.grossPnl).toBeCloseTo(pointsToCash(2, spec, 2), 10); // 2 pts = 8 ticks * $5 * 2
    expect(t.commission).toBeCloseTo(8, 10);
    expect(t.netPnl).toBeCloseTo(t.grossPnl - 8, 10);
  });

  it("hard-exits at the end of the window when nothing resolves", () => {
    const rows: Row[] = [
      ...flat(10, 100),
      [100, 101, 99.8, 101],
      [101, 103, 100.4, 103],
      [103, 104, 101.5, 103.5],
      [103.5, 103.5, 101.4, 102],
      ...flat(46, 102), // drifts nowhere until the killzone closes
    ];
    const { trades } = runBacktest(fromRows(rows), "TEST", BASE, CLEAN);
    expect(trades).toHaveLength(1);
    expect(trades[0].exitReason).toBe("window_end");
    expect(trades[0].exitIndex).toBe(59); // last bar before 11:00 ET
  });

  it("takes at most one trade per window and logs the funnel reason otherwise", () => {
    const s = bullSetup([102, 103.6, 101.9, 103.5]);
    const one = runBacktest(s, "TEST", BASE, CLEAN);
    expect(one.trades).toHaveLength(1);

    const flatDay = fromRows(flat(60, 100));
    const none = runBacktest(flatDay, "TEST", BASE, CLEAN);
    expect(none.trades).toHaveLength(0);
    expect(none.noTrades[0].reason).toBe("no_fvg");

    const gated = runBacktest(s, "TEST", { ...BASE, requireMss: true, mssLookbackBars: 1 }, CLEAN);
    expect(gated.trades).toHaveLength(0);
    expect(gated.noTrades[0].reason).toBe("no_mss");
  });

  it("expires unfilled limits instead of chasing", () => {
    const rows: Row[] = [
      ...flat(10, 100),
      [100, 101, 99.8, 101],
      [101, 103, 100.4, 103],
      [103, 104, 101.5, 103.5],
      // Drifts above the gap and never trades back into it; the lows overlap
      // bar 11's high so no fresh FVG is created either.
      ...Array.from({ length: 46 }, () => [104, 104.5, 103, 104] as Row),
    ];
    const res = runBacktest(fromRows(rows), "TEST", BASE, CLEAN);
    expect(res.trades).toHaveLength(0);
    expect(res.noTrades[0].reason).toBe("entry_not_filled");
  });

  it("is causal: truncating the series after the exit changes nothing", () => {
    const s = bullSetup([102, 103.6, 101.9, 103.5]);
    const full = runBacktest(s, "TEST", BASE, CLEAN).trades[0];

    const cut = makeSeries(20);
    (["ts", "open", "high", "low", "close", "volume"] as const).forEach((k) => cut[k].set(s[k].subarray(0, 20)));
    const truncated = runBacktest(cut, "TEST", BASE, CLEAN).trades[0];

    expect(truncated).toEqual(full);
  });

  it("summarises win rate, expectancy and the no-trade breakdown", () => {
    const win = runBacktest(bullSetup([102, 103.6, 101.9, 103.5]), "TEST", BASE, CLEAN);
    const loss = runBacktest(bullSetup([102, 102.2, 100.4, 100.6]), "TEST", BASE, CLEAN);
    const merged = {
      trades: [...win.trades, ...loss.trades],
      noTrades: [{ symbol: "TEST", sessionDate: "2024-03-14", windowKey: "ny_am", reason: "no_fvg" as const, candidates: 0 }],
      sessionsScanned: 3,
    };
    const sum = summarize(merged);
    expect(sum.trades).toBe(2);
    expect(sum.winRate).toBeCloseTo(0.5, 10);
    expect(sum.expectancyR).toBeCloseTo(0.5, 6);
    expect(sum.exitBreakdown.target).toBe(1);
    expect(sum.exitBreakdown.stop).toBe(1);
    expect(sum.noTradeBreakdown.no_fvg).toBe(1);
  });

  it("keeps instrument specs in points/ticks, never percentages", () => {
    expect(instrumentSpec("NQ").tickSize).toBe(0.25);
    expect(instrumentSpec("EURUSD").tickSize).toBe(0.00001);
    expect(instrumentSpec("SPXUSD").cls).toBe("index");
    expect(DEFAULT_ENGINE_CONFIG.maxTradesPerWindow).toBe(1);
  });
});
