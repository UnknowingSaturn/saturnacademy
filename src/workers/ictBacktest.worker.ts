// ============================================================================
// ICT backtest worker (Layer 4 runtime).
//
// The parent downloads raw month chunks from the private `bars` bucket and
// hands the ArrayBuffers over (transferred, zero copy). The worker decodes,
// concatenates, slices to the requested window and runs the Layer-3 engine so
// a multi-year 1-minute backtest never blocks the main thread.
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

export interface IctBacktestRequest {
  id: number;
  symbol: string;
  /** Raw `.bin` chunks in month order. Transferred, not copied. */
  chunks: ArrayBuffer[];
  /** Inclusive window in epoch ms; null = no bound. */
  fromMs: number | null;
  toMs: number | null;
  cfg: Partial<EngineConfig>;
}

export interface EquityPoint {
  ts: number;
  equity: number;
  r: number;
}

export interface IctBacktestResponse {
  id: number;
  ok: boolean;
  error?: string;
  summary?: BacktestSummary;
  /** Capped for transport; `summary.trades` holds the true count. */
  trades?: BacktestTrade[];
  truncated?: boolean;
  noTrades?: NoTradeRecord[];
  equity?: EquityPoint[];
  barsScanned?: number;
  firstTs?: number | null;
  lastTs?: number | null;
  sessionsScanned?: number;
}

const MAX_TRADES_OUT = 2000;
const MAX_NO_TRADES_OUT = 2000;

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
        summary: summarize({ trades: [], noTrades: [], sessionsScanned: 0 }),
        trades: [],
        noTrades: [],
        equity: [],
        barsScanned: 0,
        firstTs: null,
        lastTs: null,
        sessionsScanned: 0,
      };
      (self as unknown as Worker).postMessage(empty);
      return;
    }

    const result = runBacktest(series, req.symbol, req.cfg);
    const summary = summarize(result);

    // Equity curve in trade order (engine emits chronologically).
    const equity: EquityPoint[] = [];
    let cash = 0;
    let r = 0;
    for (const t of result.trades) {
      cash += t.netPnl;
      r += t.rMultiple;
      equity.push({ ts: t.exitTs, equity: cash, r });
    }

    const res: IctBacktestResponse = {
      id: req.id,
      ok: true,
      summary,
      trades: result.trades.slice(0, MAX_TRADES_OUT),
      truncated: result.trades.length > MAX_TRADES_OUT,
      noTrades: result.noTrades.slice(0, MAX_NO_TRADES_OUT),
      equity,
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
