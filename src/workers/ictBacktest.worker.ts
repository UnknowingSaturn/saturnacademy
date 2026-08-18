// ============================================================================
// ICT backtest worker (Layer 4 runtime).
//
// The parent downloads raw month chunks from the private `bars` bucket and
// hands the ArrayBuffers over (transferred, zero copy). The worker decodes,
// concatenates, slices to the requested window and runs the Layer-3 engine so
// a multi-year 1-minute backtest never blocks the main thread.
//
// Two modes:
//   "single"       — one config over the whole range (in-sample).
//   "walkforward"  — sweep a grid, select per fold on train, report the
//                    concatenated out-of-sample curve.
//
// Latest `id` wins; the parent discards stale replies.
// ============================================================================

import {
  decodeBarChunk,
  concatSeries,
  sliceSeries,
  type BarSeries,
} from "../../shared/quant/bars";
import {
  runBacktest,
  summarize,
  type BacktestTrade,
  type BacktestSummary,
  type EngineConfig,
  type NoTradeRecord,
} from "../../shared/quant/ict/engine";
import {
  buildFolds,
  expandGrid,
  runWalkForward,
  rStats,
  type GridAxis,
  type RStats,
  type WalkForwardResult,
} from "../../shared/quant/ict/walkforward";
import { instrumentSpec, withSpecOverrides, type InstrumentSpec } from "../../shared/quant/ict/instruments";

export interface WalkForwardOptions {
  trainMonths: number;
  testMonths: number;
  anchored: boolean;
  minTrainTrades: number;
  grid: GridAxis;
  gridCap?: number;
}

export interface IctBacktestRequest {
  id: number;
  symbol: string;
  /** Raw `.bin` chunks in month order. Transferred, not copied. */
  chunks: ArrayBuffer[];
  /** Inclusive window in epoch ms; null = no bound. */
  fromMs: number | null;
  toMs: number | null;
  cfg: Partial<EngineConfig>;
  mode?: "single" | "walkforward";
  walkForward?: WalkForwardOptions;
  /** Journal/user-derived cost overrides merged onto the catalogue spec. */
  specOverride?: Partial<InstrumentSpec> | null;
}

export interface EquityPoint {
  ts: number;
  equity: number;
  r: number;
}

export interface FoldReport {
  index: number;
  trainFromMs: number;
  trainToMs: number;
  testFromMs: number;
  testToMs: number;
  winnerCfg: Partial<EngineConfig>;
  train: RStats;
  test: RStats;
  trainDeflatedMeanR: number;
}

export interface WalkForwardReport {
  folds: FoldReport[];
  oos: RStats;
  inSampleBest: RStats;
  candidates: number;
  skippedFolds: number;
  minTrainTrades: number;
  /** OOS equity curve, so overfit shows up visually next to the IS curve. */
  oosEquity: EquityPoint[];
}

export interface IctBacktestResponse {
  id: number;
  ok: boolean;
  error?: string;
  mode?: "single" | "walkforward";
  summary?: BacktestSummary;
  /** Capped for transport; `summary.trades` holds the true count. */
  trades?: BacktestTrade[];
  truncated?: boolean;
  noTrades?: NoTradeRecord[];
  equity?: EquityPoint[];
  stats?: RStats;
  walkForward?: WalkForwardReport;
  barsScanned?: number;
  firstTs?: number | null;
  lastTs?: number | null;
  sessionsScanned?: number;
}

const MAX_TRADES_OUT = 2000;
const MAX_NO_TRADES_OUT = 2000;

function equityCurve(trades: BacktestTrade[]): EquityPoint[] {
  const out: EquityPoint[] = [];
  let cash = 0;
  let r = 0;
  for (const t of trades) {
    cash += t.netPnl;
    r += t.rMultiple;
    out.push({ ts: t.exitTs, equity: cash, r });
  }
  return out;
}

self.onmessage = (e: MessageEvent<IctBacktestRequest>) => {
  const req = e.data;
  try {
    const parts: BarSeries[] = [];
    for (const buf of req.chunks) {
      parts.push(decodeBarChunk(new Uint8Array(buf)));
    }
    let series = concatSeries(parts);
    if (req.fromMs != null || req.toMs != null) {
      series = sliceSeries(
        series,
        req.fromMs ?? -Infinity,
        req.toMs ?? Infinity,
      );
    }

    if (series.length === 0) {
      const empty: IctBacktestResponse = {
        id: req.id,
        ok: true,
        mode: req.mode ?? "single",
        summary: summarize({ trades: [], noTrades: [], sessionsScanned: 0 }),
        trades: [],
        noTrades: [],
        equity: [],
        stats: rStats([]),
        barsScanned: 0,
        firstTs: null,
        lastTs: null,
        sessionsScanned: 0,
      };
      (self as unknown as Worker).postMessage(empty);
      return;
    }

    const spec = withSpecOverrides(instrumentSpec(req.symbol), req.specOverride);

    if (req.mode === "walkforward" && req.walkForward) {
      const wf = req.walkForward;
      const folds = buildFolds(
        req.fromMs ?? series.ts[0],
        req.toMs ?? series.ts[series.length - 1],
        wf.trainMonths,
        wf.testMonths,
        wf.anchored,
      );
      if (folds.length === 0) {
        throw new Error(
          `Range is too short for ${wf.trainMonths}m train + ${wf.testMonths}m test folds — widen the month range or shorten the folds.`,
        );
      }
      const grid = expandGrid(wf.grid, wf.gridCap ?? 240);
      const result: WalkForwardResult = runWalkForward({
        series,
        symbol: req.symbol,
        baseCfg: req.cfg,
        grid,
        folds,
        minTrainTrades: wf.minTrainTrades,
        specOverride: spec,
      });

      const res: IctBacktestResponse = {
        id: req.id,
        ok: true,
        mode: "walkforward",
        summary: result.oosSummary,
        trades: result.oosTrades.slice(0, MAX_TRADES_OUT),
        truncated: result.oosTrades.length > MAX_TRADES_OUT,
        noTrades: [],
        equity: equityCurve(result.oosTrades),
        stats: result.oos,
        walkForward: {
          folds: result.folds.map((f) => ({
            index: f.fold.index,
            trainFromMs: f.fold.trainFromMs,
            trainToMs: f.fold.trainToMs,
            testFromMs: f.fold.testFromMs,
            testToMs: f.fold.testToMs,
            winnerCfg: f.winnerCfg,
            train: f.train,
            test: f.test,
            trainDeflatedMeanR: f.trainDeflatedMeanR,
          })),
          oos: result.oos,
          inSampleBest: result.inSampleBest,
          candidates: result.candidates,
          skippedFolds: result.skippedFolds,
          minTrainTrades: result.minTrainTrades,
          oosEquity: equityCurve(result.oosTrades),
        },
        barsScanned: series.length,
        firstTs: series.ts[0],
        lastTs: series.ts[series.length - 1],
        sessionsScanned: 0,
      };
      (self as unknown as Worker).postMessage(res);
      return;
    }

    const result = runBacktest(series, req.symbol, req.cfg, spec);
    const summary = summarize(result);

    const res: IctBacktestResponse = {
      id: req.id,
      ok: true,
      mode: "single",
      summary,
      trades: result.trades.slice(0, MAX_TRADES_OUT),
      truncated: result.trades.length > MAX_TRADES_OUT,
      noTrades: result.noTrades.slice(0, MAX_NO_TRADES_OUT),
      equity: equityCurve(result.trades),
      stats: rStats(result.trades),
      barsScanned: series.length,
      firstTs: series.ts[0],
      lastTs: series.ts[series.length - 1],
      sessionsScanned: result.sessionsScanned,
    };
    (self as unknown as Worker).postMessage(res);
  } catch (err) {
    const res: IctBacktestResponse = {
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(res);
  }
};
