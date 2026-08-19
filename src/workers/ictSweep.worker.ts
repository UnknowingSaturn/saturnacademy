// ============================================================================
// Sweep worker (Layer 5 runtime).
//
// One worker = one decoded copy of the bar series + one engine. The pool
// manager on the main thread initialises each worker once with the month
// chunks, then streams batches of canonical configs at it. The series is
// treated as READ-ONLY for the whole life of the worker, which is what makes
// the batching safe: no config can perturb another's inputs.
//
// Message protocol (all replies echo `id`):
//   init     → ready         (decode + slice, once)
//   batch    → rows          (N configs, one ConfigRow each)
//   trades   → tradeLog      (full trade log for one reference config)
//   nulls    → nullResult    (random-entry + shuffled-direction distributions)
//   hours    → hoursResult   (other-hours distribution: one stat per hour)
// ============================================================================

import { decodeBarChunk, concatSeries, sliceSeries, type BarSeries } from "../../shared/quant/bars";
import { runBacktest, type BacktestTrade, type EngineConfig } from "../../shared/quant/ict/engine";
import { instrumentSpec, withSpecOverrides, type InstrumentSpec } from "../../shared/quant/ict/instruments";
import { buildConfigRow, type ConfigRow, type SweepCandidate } from "../../shared/quant/ict/sweep";
import { randomEntryNull, shuffledDirectionNull, sessionHourWindows } from "../../shared/quant/ict/nulls";
import type { TradeWindow } from "../../shared/quant/sessions";

export type SweepRequest =
  | {
      type: "init";
      id: number;
      symbol: string;
      chunks: ArrayBuffer[];
      fromMs: number | null;
      toMs: number | null;
      specOverride?: Partial<InstrumentSpec> | null;
    }
  | { type: "batch"; id: number; candidates: SweepCandidate[] }
  | { type: "trades"; id: number; candidate: SweepCandidate; cap?: number }
  | { type: "nulls"; id: number; candidate: SweepCandidate; iterations: number }
  | { type: "hours"; id: number; candidate: SweepCandidate };

export interface HourStat {
  windowKey: string;
  label: string;
  trades: number;
  avgR: number;
}

export type SweepResponse =
  | { type: "ready"; id: number; ok: true; bars: number; firstTs: number; lastTs: number; sessionsScanned: number }
  | { type: "rows"; id: number; ok: true; rows: ConfigRow[] }
  | { type: "tradeLog"; id: number; ok: true; hash: string; trades: BacktestTrade[]; sessionsScanned: number }
  | { type: "nullResult"; id: number; ok: true; hash: string; randomEntry: number[]; shuffledDirection: number[]; realAvgR: number }
  | { type: "hoursResult"; id: number; ok: true; hash: string; hours: HourStat[]; realAvgR: number }
  | { type: "error"; id: number; ok: false; error: string };

let series: BarSeries | null = null;
let spec: InstrumentSpec | null = null;
let symbolRef = "";
let spanMs = 0;

function post(msg: SweepResponse) {
  (self as unknown as Worker).postMessage(msg);
}

function requireSeries(): { s: BarSeries; sp: InstrumentSpec } {
  if (!series || !spec) throw new Error("Sweep worker used before init");
  return { s: series, sp: spec };
}

function runCandidate(cand: SweepCandidate) {
  const { s, sp } = requireSeries();
  return runBacktest(s, symbolRef, cand.patch as Partial<EngineConfig>, sp);
}

function avgR(trades: BacktestTrade[]): number {
  return trades.length ? trades.reduce((a, t) => a + t.rMultiple, 0) / trades.length : 0;
}

self.onmessage = (e: MessageEvent<SweepRequest>) => {
  const req = e.data;
  try {
    switch (req.type) {
      case "init": {
        const parts: BarSeries[] = [];
        for (const buf of req.chunks) parts.push(decodeBarChunk(new Uint8Array(buf)));
        let s = concatSeries(parts);
        if (req.fromMs != null || req.toMs != null) {
          s = sliceSeries(s, req.fromMs ?? -Infinity, req.toMs ?? Infinity);
        }
        if (s.length === 0) throw new Error("No bars in the requested range");
        series = s;
        symbolRef = req.symbol;
        spec = withSpecOverrides(instrumentSpec(req.symbol), req.specOverride);
        spanMs = s.ts[s.length - 1] - s.ts[0];
        post({
          type: "ready",
          id: req.id,
          ok: true,
          bars: s.length,
          firstTs: s.ts[0],
          lastTs: s.ts[s.length - 1],
          sessionsScanned: 0,
        });
        return;
      }

      case "batch": {
        const rows: ConfigRow[] = [];
        for (const cand of req.candidates) {
          const res = runCandidate(cand);
          rows.push(buildConfigRow(cand, res.trades, res.sessionsScanned, spanMs));
        }
        post({ type: "rows", id: req.id, ok: true, rows });
        return;
      }

      case "trades": {
        const res = runCandidate(req.candidate);
        post({
          type: "tradeLog",
          id: req.id,
          ok: true,
          hash: req.candidate.hash,
          trades: res.trades.slice(0, req.cap ?? 5000),
          sessionsScanned: res.sessionsScanned,
        });
        return;
      }

      case "nulls": {
        const { s, sp } = requireSeries();
        const res = runCandidate(req.candidate);
        const windows = (req.candidate.patch.windows ?? []) as TradeWindow[];
        post({
          type: "nullResult",
          id: req.id,
          ok: true,
          hash: req.candidate.hash,
          randomEntry: randomEntryNull(s, res.trades, windows, sp, req.iterations),
          shuffledDirection: shuffledDirectionNull(s, res.trades, sp, req.iterations),
          realAvgR: avgR(res.trades),
        });
        return;
      }

      case "hours": {
        // Other hours, same logic: the config restricted to ONE 60-minute
        // window at a time. Multi-window configs therefore appear here in
        // their one-window form, which is the comparison the null intends.
        const real = runCandidate(req.candidate);
        const hours: HourStat[] = [];
        for (const w of sessionHourWindows()) {
          const res = runBacktest(
            requireSeries().s,
            symbolRef,
            { ...req.candidate.patch, windows: [w] } as Partial<EngineConfig>,
            requireSeries().sp,
          );
          hours.push({ windowKey: w.key, label: w.label, trades: res.trades.length, avgR: avgR(res.trades) });
        }
        post({ type: "hoursResult", id: req.id, ok: true, hash: req.candidate.hash, hours, realAvgR: avgR(real.trades) });
        return;
      }
    }
  } catch (err) {
    post({ type: "error", id: (req as { id: number }).id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
