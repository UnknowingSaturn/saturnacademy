// ============================================================================
// Layer 5 — sweep canonicalisation, sampling and statistics.
//
// Everything in here is pure: no bars, no workers, no DOM. The worker owns the
// expensive part (running configs); this module owns the parts that decide
// WHICH configs run and WHETHER a result means anything.
//
// Three ideas do the heavy lifting:
//
//   1. Canonicalisation. Two configs that differ only in a parameter the
//      engine never reads (a sweep lookback when `requireSweep` is off) are
//      the SAME experiment. Nulling dead parameters before hashing keeps the
//      test population honest — otherwise the multiple-testing correction is
//      applied to a population padded with duplicates, which weakens it.
//
//   2. Sampling by index. The full grid can be millions of cells; we never
//      materialise it. Mixed-radix decoding turns a random integer into a
//      config, so a uniform draw over the grid costs O(axes) per sample.
//
//   3. Deflation. The best of N configs is high partly because it is best and
//      partly because N is large. The Deflated Sharpe Ratio (Bailey & López de
//      Prado) prices that in explicitly, and Benjamini-Hochberg controls the
//      false-discovery rate across the sampled population.
// ============================================================================

import type { BacktestTrade, EngineConfig } from "./engine";
import { configHash } from "./walkforward";
import { windowsForKeys } from "./configs";
import grid from "./configs/grid.json" with { type: "json" };

// ---------------------------------------------------------------------------
// Grid definition
// ---------------------------------------------------------------------------

export interface SweepDefinition {
  /** Engine field → candidate values. `windowKeys` is handled separately. */
  axes: Record<string, unknown[]>;
  /** Window-set axis: each entry is a list of killzone keys. */
  windowSets: string[][];
  /** Nothing in this layer may load bars at or after this date. */
  holdoutFromMonth: string;
  /** Config keys always added on top of the random sample. */
  namedKeys: string[];
}

const rawSweep = (grid as { sweep?: Partial<SweepDefinition> }).sweep ?? {};

export const SWEEP: SweepDefinition = {
  axes: (rawSweep.axes ?? {}) as Record<string, unknown[]>,
  windowSets: (rawSweep.windowSets ?? [["ny_am"]]) as string[][],
  holdoutFromMonth: rawSweep.holdoutFromMonth ?? "2025-01",
  namedKeys: rawSweep.namedKeys ?? ["as_taught_5m", "silver_bullet", "london_killzone"],
};

/** A config as it travels through the sweep: patch + its canonical identity. */
export interface SweepCandidate {
  hash: string;
  /** Engine patch, ready for `runBacktest`. Windows resolved. */
  patch: Partial<EngineConfig>;
  /** Canonical parameter map (dead params nulled) — what gets logged. */
  canonical: Record<string, unknown>;
  windowKeys: string[];
  /** Named config key when this is one of the always-included configs. */
  namedKey?: string;
}

// ---------------------------------------------------------------------------
// Canonicalisation
// ---------------------------------------------------------------------------

/**
 * Null out every parameter the engine cannot read given the others, so the
 * hash identifies the EXPERIMENT rather than the parameter spelling.
 *
 * `sweepUniverse` is deliberately kept alive when the target is liquidity —
 * the same universe feeds the target selection, so it is not dead there.
 */
export function canonicalizeConfig(
  patch: Partial<EngineConfig>,
  windowKeys: string[],
): Record<string, unknown> {
  const c: Record<string, unknown> = { ...patch };
  delete c.windows;
  c.windowKeys = [...windowKeys].sort();

  const sweepOn = patch.requireSweep === true;
  const liquidityTarget = patch.targetMode === "liquidity";
  if (!sweepOn) {
    c.sweepK = null;
    c.sweepPenetrationTicks = null;
    c.sweepLookbackBars = null;
    if (!liquidityTarget) c.sweepUniverse = null;
  }
  if (!liquidityTarget) {
    // nothing extra today, but the branch documents the rule
  } else {
    c.targetR = null;
  }
  if (patch.requireMss !== true) c.mssLookbackBars = null;
  if (patch.requireDisplacement !== true) {
    c.displacementMode = null;
    c.displacementAtrMultiple = null;
  }
  if (patch.stopMode !== "displacement_swing" && patch.requireDisplacement !== true) {
    c.displacementLegBars = null;
  }
  switch (patch.biasMode) {
    case "trend":
      c.biasSwingTimeframe = null;
      break;
    case "structure_15m":
      c.biasTrendDays = null;
      break;
    default:
      c.biasTrendDays = null;
      c.biasSwingTimeframe = null;
  }
  const swingsUsed =
    patch.stopMode === "swing" ||
    patch.stopMode === "displacement_swing" ||
    patch.requireMss === true ||
    patch.biasMode === "structure_15m";
  if (!swingsUsed) c.swingStrength = null;
  if (patch.sizing !== "fixed") c.size = null;

  // Sort keys so the hash is spelling-independent.
  return Object.keys(c)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = c[k];
      return acc;
    }, {});
}

export function makeCandidate(
  patch: Partial<EngineConfig>,
  windowKeys: string[],
  namedKey?: string,
): SweepCandidate {
  const canonical = canonicalizeConfig(patch, windowKeys);
  return {
    hash: configHash(canonical),
    patch: { ...patch, windows: windowsForKeys(windowKeys) },
    canonical,
    windowKeys,
    namedKey,
  };
}

// ---------------------------------------------------------------------------
// Enumeration / sampling
// ---------------------------------------------------------------------------

interface AxisSpec {
  key: string;
  values: unknown[];
}

export function sweepAxisList(def: SweepDefinition = SWEEP): AxisSpec[] {
  const axes: AxisSpec[] = Object.entries(def.axes)
    .filter(([, v]) => Array.isArray(v) && v.length > 0)
    .map(([key, values]) => ({ key, values }));
  axes.push({ key: "__windows", values: def.windowSets });
  return axes;
}

export function gridSize(def: SweepDefinition = SWEEP): number {
  return sweepAxisList(def).reduce((n, a) => n * a.values.length, 1);
}

/** Mixed-radix decode: grid index → engine patch. */
export function configAtIndex(
  index: number,
  def: SweepDefinition = SWEEP,
): { patch: Partial<EngineConfig>; windowKeys: string[] } {
  const axes = sweepAxisList(def);
  const patch: Record<string, unknown> = {};
  let windowKeys: string[] = def.windowSets[0] ?? ["ny_am"];
  let rem = index;
  for (const a of axes) {
    const v = a.values[rem % a.values.length];
    rem = Math.floor(rem / a.values.length);
    if (a.key === "__windows") windowKeys = v as string[];
    else patch[a.key] = v;
  }
  return { patch: patch as Partial<EngineConfig>, windowKeys };
}

/** Deterministic 32-bit RNG (mulberry32) — no modulo bias in `int()`. */
export function makeRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** Uniform integer in [0, n) via rejection sampling. */
    int(n: number): number {
      if (n <= 0) return 0;
      const limit = Math.floor(4294967296 / n) * n;
      for (;;) {
        const r = Math.floor(next() * 4294967296);
        if (r < limit) return r % n;
      }
    },
  };
}

export interface SampleReport {
  gridSize: number;
  /** How many raw draws (or full enumerations) were canonicalised. */
  rawCount: number;
  /** Unique canonical configs kept. */
  canonicalCount: number;
  exhaustive: boolean;
  candidates: SweepCandidate[];
}

const EXHAUSTIVE_LIMIT = 100_000;

/**
 * Uniform random draw of `n` canonical configs, one pass, fixed seed. When the
 * whole grid is small enough we enumerate it instead, so the raw-vs-canonical
 * counts are exact rather than estimated.
 */
export function sampleConfigs(
  n: number,
  seed = 20260819,
  def: SweepDefinition = SWEEP,
): SampleReport {
  const total = gridSize(def);
  const seen = new Set<string>();
  const out: SweepCandidate[] = [];

  if (total <= EXHAUSTIVE_LIMIT) {
    for (let i = 0; i < total; i++) {
      const { patch, windowKeys } = configAtIndex(i, def);
      const cand = makeCandidate(patch, windowKeys);
      if (seen.has(cand.hash)) continue;
      seen.add(cand.hash);
      out.push(cand);
    }
    // Uniform subsample of the canonical population when it exceeds n.
    let kept = out;
    if (out.length > n) {
      const rng = makeRng(seed);
      const idx = out.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        [idx[i], idx[j]] = [idx[j], idx[i]];
      }
      kept = idx.slice(0, n).sort((a, b) => a - b).map((i) => out[i]);
    }
    return {
      gridSize: total,
      rawCount: total,
      canonicalCount: out.length,
      exhaustive: true,
      candidates: kept,
    };
  }

  const rng = makeRng(seed);
  let draws = 0;
  const maxDraws = n * 12 + 1000;
  while (out.length < n && draws < maxDraws) {
    draws++;
    const { patch, windowKeys } = configAtIndex(rng.int(total), def);
    const cand = makeCandidate(patch, windowKeys);
    if (seen.has(cand.hash)) continue;
    seen.add(cand.hash);
    out.push(cand);
  }
  return {
    gridSize: total,
    rawCount: draws,
    canonicalCount: out.length,
    exhaustive: false,
    candidates: out,
  };
}

// ---------------------------------------------------------------------------
// Sizing rule (Part 0.4)
// ---------------------------------------------------------------------------

export interface SizingDecision {
  medianSecPerConfig: number;
  workers: number;
  /** Configs the budget allows. */
  n: number;
  /** Projected wall clock in minutes for `n`. */
  projectedMinutes: number;
  /** Below the floor the run must not start. */
  belowFloor: boolean;
}

export const SWEEP_BUDGET_MIN = 90;
export const SWEEP_FLOOR_N = 10_000;
export const SWEEP_MAX_N = 25_000;

export function sizeSweep(
  medianSecPerConfig: number,
  workers: number,
  budgetMinutes = SWEEP_BUDGET_MIN,
): SizingDecision {
  const w = Math.max(1, Math.floor(workers));
  const sec = Math.max(1e-6, medianSecPerConfig);
  const n = Math.min(SWEEP_MAX_N, Math.floor((budgetMinutes * 60 * w) / sec));
  return {
    medianSecPerConfig: sec,
    workers: w,
    n,
    projectedMinutes: (n * sec) / w / 60,
    belowFloor: n < SWEEP_FLOOR_N,
  };
}

// ---------------------------------------------------------------------------
// Per-config statistics
// ---------------------------------------------------------------------------

export interface ConfigRow {
  hash: string;
  namedKey?: string;
  windowKeys: string[];
  canonical: Record<string, unknown>;
  trades: number;
  tradesPerYear: number;
  dayCoveragePct: number;
  winRate: number;
  avgR: number;
  totalR: number;
  grossPnl: number;
  netPnl: number;
  grossSharpe: number;
  netSharpe: number;
  maxDrawdownR: number;
  maxDrawdownCash: number;
  profitFactor: number;
  ambiguousPct: number;
  rollDayPct: number;
  firstTradeDate: string | null;
  lastTradeDate: string | null;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1));
}
export function skewness(xs: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const m = mean(xs);
  const s = sd(xs);
  if (!(s > 0)) return 0;
  return xs.reduce((a, b) => a + ((b - m) / s) ** 3, 0) / n;
}
export function kurtosis(xs: number[]): number {
  const n = xs.length;
  if (n < 4) return 3;
  const m = mean(xs);
  const s = sd(xs);
  if (!(s > 0)) return 3;
  return xs.reduce((a, b) => a + ((b - m) / s) ** 4, 0) / n;
}

/**
 * Sharpe of the R series, annualised by the observed trade frequency. Using
 * trade-level R (not daily equity) keeps the figure comparable across configs
 * that trade at very different rates once the sqrt(trades/year) scaling is in.
 */
export function annualisedSharpe(rs: number[], tradesPerYear: number): number {
  if (rs.length < 2) return 0;
  const s = sd(rs);
  if (!(s > 0)) return 0;
  return (mean(rs) / s) * Math.sqrt(Math.max(1, tradesPerYear));
}

function maxDrawdown(series: number[]): number {
  let eq = 0, peak = 0, dd = 0;
  for (const v of series) {
    eq += v;
    if (eq > peak) peak = eq;
    if (peak - eq > dd) dd = peak - eq;
  }
  return dd;
}

/** Quarterly futures roll days (third Friday of Mar/Jun/Sep/Dec, UTC). */
export function isRollDay(dateKey: string): boolean {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (![3, 6, 9, 12].includes(m)) return false;
  const first = new Date(Date.UTC(y, m - 1, 1));
  const firstFriday = 1 + ((5 - first.getUTCDay() + 7) % 7);
  return d === firstFriday + 14;
}

export function buildConfigRow(
  cand: SweepCandidate,
  trades: BacktestTrade[],
  sessionsScanned: number,
  spanMs: number,
): ConfigRow {
  const rs = trades.map((t) => t.rMultiple);
  const years = Math.max(spanMs / (365.25 * 24 * 3600 * 1000), 1 / 365.25);
  const tradesPerYear = trades.length / years;
  const tradeDays = new Set(trades.map((t) => t.sessionDate));
  const wins = trades.filter((t) => t.netPnl > 0).length;
  const gp = trades.filter((t) => t.netPnl > 0).reduce((a, t) => a + t.netPnl, 0);
  const gl = trades.filter((t) => t.netPnl <= 0).reduce((a, t) => a + Math.abs(t.netPnl), 0);
  const dates = trades.map((t) => t.sessionDate).sort();
  const grossRs = trades.map((t) =>
    t.riskCash > 0 ? t.grossPnl / t.riskCash : t.rMultiple,
  );
  return {
    hash: cand.hash,
    namedKey: cand.namedKey,
    windowKeys: cand.windowKeys,
    canonical: cand.canonical,
    trades: trades.length,
    tradesPerYear,
    dayCoveragePct: sessionsScanned ? (tradeDays.size / sessionsScanned) * 100 : 0,
    winRate: trades.length ? wins / trades.length : 0,
    avgR: mean(rs),
    totalR: rs.reduce((a, b) => a + b, 0),
    grossPnl: trades.reduce((a, t) => a + t.grossPnl, 0),
    netPnl: trades.reduce((a, t) => a + t.netPnl, 0),
    grossSharpe: annualisedSharpe(grossRs, tradesPerYear),
    netSharpe: annualisedSharpe(rs, tradesPerYear),
    maxDrawdownR: maxDrawdown(rs),
    maxDrawdownCash: maxDrawdown(trades.map((t) => t.netPnl)),
    profitFactor: gl > 0 ? gp / gl : gp > 0 ? Infinity : 0,
    ambiguousPct: trades.length
      ? (trades.filter((t) => t.ambiguousBar).length / trades.length) * 100
      : 0,
    rollDayPct: trades.length
      ? (trades.filter((t) => isRollDay(t.sessionDate)).length / trades.length) * 100
      : 0,
    firstTradeDate: dates[0] ?? null,
    lastTradeDate: dates[dates.length - 1] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Multiple-testing statistics
// ---------------------------------------------------------------------------

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 via erf approximation). */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p =
    d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

/** Inverse normal CDF (Acklam's rational approximation). */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let q: number, r: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) return -normInv(1 - p);
  q = p - 0.5;
  r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Expected maximum Sharpe of N independent noise trials — the benchmark the
 * observed Sharpe has to beat before it counts as an edge.
 */
export function expectedMaxSharpe(sharpeVariance: number, trials: number): number {
  const n = Math.max(2, trials);
  const g = 0.5772156649015329; // Euler-Mascheroni
  const s = Math.sqrt(Math.max(0, sharpeVariance));
  return s * ((1 - g) * normInv(1 - 1 / n) + g * normInv(1 - 1 / (n * Math.E)));
}

export interface DsrResult {
  observedSharpe: number;
  expectedMaxSharpe: number;
  dsr: number;
  trials: number;
  skew: number;
  kurtosis: number;
  n: number;
}

/**
 * Deflated Sharpe Ratio — Bailey & López de Prado (2014). `sharpe` and the
 * cross-config variance must be on the SAME scale (both per-trade, or both
 * annualised); we pass per-trade Sharpes in and annualise only for display.
 */
export function deflatedSharpeRatio(
  perTradeSharpe: number,
  rs: number[],
  crossConfigSharpeVariance: number,
  trials: number,
): DsrResult {
  const n = rs.length;
  const g3 = skewness(rs);
  const g4 = kurtosis(rs);
  const sr0 = expectedMaxSharpe(crossConfigSharpeVariance, trials);
  if (n < 4) {
    return { observedSharpe: perTradeSharpe, expectedMaxSharpe: sr0, dsr: 0, trials, skew: g3, kurtosis: g4, n };
  }
  const denom = Math.sqrt(
    Math.max(1e-12, 1 - g3 * perTradeSharpe + ((g4 - 1) / 4) * perTradeSharpe * perTradeSharpe),
  );
  const z = ((perTradeSharpe - sr0) * Math.sqrt(n - 1)) / denom;
  return { observedSharpe: perTradeSharpe, expectedMaxSharpe: sr0, dsr: normCdf(z), trials, skew: g3, kurtosis: g4, n };
}

/** One-sided p-value that mean R > 0, from the t-statistic (normal approx). */
export function pValueMeanPositive(rs: number[]): number {
  if (rs.length < 3) return 1;
  const s = sd(rs);
  if (!(s > 0)) return 1;
  const t = (mean(rs) / s) * Math.sqrt(rs.length);
  return 1 - normCdf(t);
}

export interface FdrResult {
  /** Hashes that survive at the given FDR level. */
  survivors: string[];
  threshold: number;
  q: number;
  tested: number;
}

/** Benjamini-Hochberg step-up over the sampled population. */
export function benjaminiHochberg(
  pvalues: Array<{ hash: string; p: number }>,
  q = 0.1,
): FdrResult {
  const m = pvalues.length;
  if (m === 0) return { survivors: [], threshold: 0, q, tested: 0 };
  const sorted = [...pvalues].sort((a, b) => a.p - b.p);
  let k = -1;
  for (let i = 0; i < m; i++) {
    if (sorted[i].p <= ((i + 1) / m) * q) k = i;
  }
  if (k < 0) return { survivors: [], threshold: 0, q, tested: m };
  return {
    survivors: sorted.slice(0, k + 1).map((x) => x.hash),
    threshold: sorted[k].p,
    q,
    tested: m,
  };
}

// ---------------------------------------------------------------------------
// Slices
// ---------------------------------------------------------------------------

export interface YearRow { year: string; trades: number; avgR: number; totalR: number; winRate: number }

export function perYear(trades: BacktestTrade[]): YearRow[] {
  const by = new Map<string, BacktestTrade[]>();
  for (const t of trades) {
    const y = t.sessionDate.slice(0, 4);
    (by.get(y) ?? by.set(y, []).get(y)!).push(t);
  }
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, ts]) => ({
      year,
      trades: ts.length,
      avgR: mean(ts.map((t) => t.rMultiple)),
      totalR: ts.reduce((a, t) => a + t.rMultiple, 0),
      winRate: ts.filter((t) => t.netPnl > 0).length / ts.length,
    }));
}

export interface EraRow { era: string; trades: number; avgR: number; winRate: number; netSharpe: number }

export function eraSplit(trades: BacktestTrade[], cutoffYear = 2022): EraRow[] {
  const early = trades.filter((t) => Number(t.sessionDate.slice(0, 4)) < cutoffYear);
  const late = trades.filter((t) => Number(t.sessionDate.slice(0, 4)) >= cutoffYear);
  const row = (era: string, ts: BacktestTrade[]): EraRow => {
    const rs = ts.map((t) => t.rMultiple);
    const s = sd(rs);
    return {
      era,
      trades: ts.length,
      avgR: mean(rs),
      winRate: ts.length ? ts.filter((t) => t.netPnl > 0).length / ts.length : 0,
      netSharpe: s > 0 ? mean(rs) / s : 0,
    };
  };
  return [row(`pre-${cutoffYear}`, early), row(`${cutoffYear}+`, late)];
}

export interface SlippageCell { stopTicks: number; timeTicks: number; avgR: number; netPnl: number; netSharpe: number }

/**
 * Analytic slippage sensitivity — no re-simulation. Extra adverse ticks only
 * change the EXIT price, so the cash delta is (ticks x tickValue x size) and
 * the R delta divides by the same risk cash the trade was sized on. Stops and
 * time-based exits are charged separately because they slip differently.
 */
export function slippageSensitivity(
  trades: BacktestTrade[],
  tickValue: number,
  stopTicksGrid = [0, 1, 2, 3],
  timeTicksGrid = [0, 1, 2],
): SlippageCell[] {
  const out: SlippageCell[] = [];
  for (const st of stopTicksGrid) {
    for (const tt of timeTicksGrid) {
      const rs: number[] = [];
      let cash = 0;
      for (const t of trades) {
        const isStop = t.exitReason === "stop";
        const isTimed = t.exitReason !== "stop" && t.exitReason !== "target";
        const ticks = isStop ? st : isTimed ? tt : 0;
        const delta = ticks * tickValue * t.size;
        const net = t.netPnl - delta;
        cash += net;
        rs.push(t.riskCash > 0 ? net / t.riskCash : t.rMultiple);
      }
      const s = sd(rs);
      out.push({ stopTicks: st, timeTicks: tt, avgR: mean(rs), netPnl: cash, netSharpe: s > 0 ? mean(rs) / s : 0 });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Discretion premium (Part 5)
// ---------------------------------------------------------------------------

export interface DiscretionPremium {
  allSetups: { trades: number; avgR: number; netPnl: number; netSharpe: number };
  perfectSkip: { trades: number; avgR: number; netPnl: number; netSharpe: number };
  /** Fraction of losers that must be skipped in advance to break even net. */
  skipForBreakeven: number | null;
  /** Fraction of losers that must be skipped in advance for 1.0 net Sharpe. */
  skipForSharpe1: number | null;
}

function packet(trades: BacktestTrade[]) {
  const rs = trades.map((t) => t.rMultiple);
  const s = sd(rs);
  return {
    trades: trades.length,
    avgR: mean(rs),
    netPnl: trades.reduce((a, t) => a + t.netPnl, 0),
    netSharpe: s > 0 ? mean(rs) / s : 0,
  };
}

/**
 * How much skill the config assumes. Skipping is modelled as removing a random
 * fraction of losers (averaged over draws) — NOT the best losers, because a
 * trader choosing in advance cannot pick which losers they avoid.
 */
export function discretionPremium(trades: BacktestTrade[], seed = 7, iterations = 200): DiscretionPremium {
  const losers = trades.filter((t) => t.netPnl <= 0);
  const winners = trades.filter((t) => t.netPnl > 0);
  const all = packet(trades);
  const perfect = packet(winners);
  if (!losers.length || !trades.length) {
    return { allSetups: all, perfectSkip: perfect, skipForBreakeven: all.netPnl >= 0 ? 0 : null, skipForSharpe1: all.netSharpe >= 1 ? 0 : null };
  }

  const rng = makeRng(seed);
  const evaluate = (fraction: number) => {
    let pnl = 0, sharpe = 0;
    for (let it = 0; it < iterations; it++) {
      const keep = losers.filter(() => rng.next() >= fraction);
      const set = [...winners, ...keep];
      const p = packet(set);
      pnl += p.netPnl;
      sharpe += p.netSharpe;
    }
    return { netPnl: pnl / iterations, netSharpe: sharpe / iterations };
  };

  let breakeven: number | null = null;
  let sharpe1: number | null = null;
  for (let f = 0; f <= 100; f += 5) {
    const frac = f / 100;
    const r = evaluate(frac);
    if (breakeven === null && r.netPnl >= 0) breakeven = frac;
    if (sharpe1 === null && r.netSharpe >= 1) sharpe1 = frac;
    if (breakeven !== null && sharpe1 !== null) break;
  }
  return { allSetups: all, perfectSkip: perfect, skipForBreakeven: breakeven, skipForSharpe1: sharpe1 };
}

// ---------------------------------------------------------------------------
// Holdout guard
// ---------------------------------------------------------------------------

/** Throws when a requested range reaches into the holdout era. */
export function assertNoHoldout(toMonth: string, def: SweepDefinition = SWEEP): void {
  if (toMonth >= def.holdoutFromMonth) {
    throw new Error(
      `Holdout guard: this layer may not load bars from ${def.holdoutFromMonth} onward (requested through ${toMonth}).`,
    );
  }
}
