// ============================================================================
// Walk-forward + parameter sweep.
//
// Why this shape:
//   The engine is strictly causal — a trade's outcome depends only on bars at
//   or before its own exit, never on the evaluation window. So instead of
//   re-slicing the bar series per fold (which would destroy prior-session
//   liquidity levels and HTF bias warm-up), we run each candidate config ONCE
//   over the whole series and then partition its trades by entry timestamp.
//   Identical results, N runs instead of N x folds runs.
//
//   Selection happens on the train slice only; the reported curve is the
//   concatenation of the test slices of whichever config won its own train
//   slice. That is a genuine out-of-sample curve.
//
//   Because a sweep tries many configs on the same data, the winner's
//   in-sample expectancy is biased upward. `deflateExpectancy` applies the
//   standard expected-maximum-of-N-noise haircut so a 200-cell grid can't hand
//   back a fake edge.
// ============================================================================

import type { BarSeries } from "../bars";
import {
  runBacktest,
  summarize,
  type BacktestSummary,
  type BacktestTrade,
  type EngineConfig,
} from "./engine";
import type { InstrumentSpec } from "./instruments";

export interface Fold {
  index: number;
  trainFromMs: number;
  trainToMs: number;
  testFromMs: number;
  testToMs: number;
}

/**
 * Rolling folds over [fromMs, toMs]. Each fold trains on `trainMonths` of
 * history and tests on the `testMonths` that immediately follow, then the
 * whole window slides forward by `testMonths` (no test period is reused).
 */
export function buildFolds(
  fromMs: number,
  toMs: number,
  trainMonths: number,
  testMonths: number,
  anchored = false,
): Fold[] {
  const folds: Fold[] = [];
  const addMonths = (ms: number, n: number) => {
    const d = new Date(ms);
    d.setUTCMonth(d.getUTCMonth() + n);
    return d.getTime();
  };
  let trainStart = fromMs;
  let i = 0;
  for (;;) {
    const trainEnd = addMonths(trainStart, trainMonths);
    const testEnd = Math.min(addMonths(trainEnd, testMonths), toMs);
    if (trainEnd >= toMs || testEnd <= trainEnd) break;
    folds.push({
      index: i++,
      trainFromMs: anchored ? fromMs : trainStart,
      trainToMs: trainEnd - 1,
      testFromMs: trainEnd,
      testToMs: testEnd,
    });
    if (testEnd >= toMs) break;
    trainStart = anchored ? trainStart : addMonths(trainStart, testMonths);
    if (!anchored && addMonths(trainStart, trainMonths) >= toMs) break;
  }
  return folds;
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

export type GridAxis = {
  [K in keyof EngineConfig]?: Array<EngineConfig[K]>;
};

/** Cartesian product of the supplied axes, capped so the UI can't melt. */
export function expandGrid(axes: GridAxis, cap = 240): Array<Partial<EngineConfig>> {
  const keys = Object.keys(axes) as Array<keyof EngineConfig>;
  let out: Array<Partial<EngineConfig>> = [{}];
  for (const k of keys) {
    const values = axes[k];
    if (!values || values.length === 0) continue;
    const next: Array<Partial<EngineConfig>> = [];
    for (const base of out) {
      for (const v of values) {
        next.push({ ...base, [k]: v });
        if (next.length >= cap) break;
      }
      if (next.length >= cap) break;
    }
    out = next;
  }
  return out;
}

/** Stable, order-independent hash of a config for run de-duplication. */
export function configHash(obj: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      return Object.keys(o).sort().reduce<Record<string, unknown>>((acc, k) => {
        if (o[k] !== undefined) acc[k] = norm(o[k]);
        return acc;
      }, {});
    }
    return v;
  };
  const s = JSON.stringify(norm(obj));
  // FNV-1a 32-bit, twice with different offsets → 64 bits of hex.
  const fnv = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };
  return fnv(0x811c9dc5) + fnv(0x9e3779b9);
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export interface RStats {
  n: number;
  meanR: number;
  sdR: number;
  winRate: number;
  totalR: number;
  netPnl: number;
  maxDrawdownR: number;
  /** Mean R / SD of R, annualisation-free — comparable across configs. */
  tStat: number;
}

export function rStats(trades: BacktestTrade[]): RStats {
  const n = trades.length;
  if (n === 0) {
    return { n: 0, meanR: 0, sdR: 0, winRate: 0, totalR: 0, netPnl: 0, maxDrawdownR: 0, tStat: 0 };
  }
  let sum = 0, wins = 0, pnl = 0;
  for (const t of trades) { sum += t.rMultiple; pnl += t.netPnl; if (t.netPnl > 0) wins++; }
  const mean = sum / n;
  let ss = 0;
  for (const t of trades) ss += (t.rMultiple - mean) ** 2;
  const sd = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
  let peak = 0, equity = 0, dd = 0;
  for (const t of trades) {
    equity += t.rMultiple;
    if (equity > peak) peak = equity;
    const draw = peak - equity;
    if (draw > dd) dd = draw;
  }
  return {
    n,
    meanR: mean,
    sdR: sd,
    winRate: wins / n,
    totalR: sum,
    netPnl: pnl,
    maxDrawdownR: dd,
    tStat: sd > 0 ? (mean / sd) * Math.sqrt(n) : 0,
  };
}

/**
 * Haircut for multiple testing. The maximum of `trials` independent noise
 * draws sits about sqrt(2 ln trials) standard errors above zero, so we subtract
 * that much of the standard error from the observed mean. Result is the mean R
 * you can still claim after admitting how many combinations you tried.
 */
export function deflateExpectancy(mean: number, sd: number, n: number, trials: number): number {
  if (n < 2 || sd <= 0 || trials < 1) return mean;
  const se = sd / Math.sqrt(n);
  const haircut = Math.sqrt(2 * Math.log(Math.max(2, trials)));
  return mean - haircut * se;
}

// ---------------------------------------------------------------------------
// Walk-forward run
// ---------------------------------------------------------------------------

export interface CandidateResult {
  cfg: Partial<EngineConfig>;
  hash: string;
  trades: BacktestTrade[];
}

export interface FoldOutcome {
  fold: Fold;
  winnerHash: string;
  winnerCfg: Partial<EngineConfig>;
  train: RStats;
  test: RStats;
  /** Train expectancy after the multiple-testing haircut. */
  trainDeflatedMeanR: number;
  testTrades: BacktestTrade[];
}

export interface WalkForwardResult {
  folds: FoldOutcome[];
  /** Concatenated out-of-sample trades, chronological. */
  oosTrades: BacktestTrade[];
  oos: RStats;
  /** All trades of all candidates over the whole range — the in-sample bound. */
  inSampleBest: RStats;
  oosSummary: BacktestSummary;
  candidates: number;
  /** Selection is unreliable below this many train trades; folds are skipped. */
  minTrainTrades: number;
  skippedFolds: number;
}

export interface WalkForwardParams {
  series: BarSeries;
  symbol: string;
  baseCfg: Partial<EngineConfig>;
  grid: Array<Partial<EngineConfig>>;
  folds: Fold[];
  minTrainTrades?: number;
  specOverride?: InstrumentSpec;
  onProgress?: (done: number, total: number) => void;
}

function inRange(t: BacktestTrade, from: number, to: number): boolean {
  return t.entryTs >= from && t.entryTs <= to;
}

export function runWalkForward(p: WalkForwardParams): WalkForwardResult {
  const minTrainTrades = p.minTrainTrades ?? 20;
  const grid = p.grid.length ? p.grid : [{}];

  // 1. One causal pass per candidate over the entire series.
  const candidates: CandidateResult[] = [];
  grid.forEach((g, i) => {
    const cfg = { ...p.baseCfg, ...g };
    const res = runBacktest(p.series, p.symbol, cfg, p.specOverride);
    candidates.push({ cfg: g, hash: configHash(cfg), trades: res.trades });
    p.onProgress?.(i + 1, grid.length);
  });

  // 2. Per fold: select on train, keep the winner's test trades.
  const outcomes: FoldOutcome[] = [];
  let skipped = 0;
  for (const fold of p.folds) {
    let best: { cand: CandidateResult; stats: RStats; deflated: number } | null = null;
    for (const cand of candidates) {
      const train = cand.trades.filter((t) => inRange(t, fold.trainFromMs, fold.trainToMs));
      if (train.length < minTrainTrades) continue;
      const stats = rStats(train);
      const deflated = deflateExpectancy(stats.meanR, stats.sdR, stats.n, grid.length);
      if (!best || deflated > best.deflated) best = { cand, stats, deflated };
    }
    if (!best) { skipped++; continue; }
    const testTrades = best.cand.trades.filter((t) => inRange(t, fold.testFromMs, fold.testToMs));
    outcomes.push({
      fold,
      winnerHash: best.cand.hash,
      winnerCfg: best.cand.cfg,
      train: best.stats,
      test: rStats(testTrades),
      trainDeflatedMeanR: best.deflated,
      testTrades,
    });
  }

  const oosTrades = outcomes
    .flatMap((o) => o.testTrades)
    .sort((a, b) => a.entryTs - b.entryTs);

  // In-sample reference: the best single config over the entire range. This is
  // the number that is inflated by selection; showing it next to OOS makes the
  // overfit gap explicit.
  let bestIs: RStats = rStats([]);
  for (const cand of candidates) {
    const s = rStats(cand.trades);
    if (s.n > 0 && s.totalR > bestIs.totalR) bestIs = s;
  }

  return {
    folds: outcomes,
    oosTrades,
    oos: rStats(oosTrades),
    inSampleBest: bestIs,
    oosSummary: summarize({ trades: oosTrades, noTrades: [], sessionsScanned: 0 }),
    candidates: candidates.length,
    minTrainTrades,
    skippedFolds: skipped,
  };
}
