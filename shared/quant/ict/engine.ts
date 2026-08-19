// ============================================================================
// Layer 3 — execution engine.
//
// Turns Layer-2 detector output into trades under an explicit, auditable rule
// set. Design rules:
//   * Causal: bar i can only use detector output whose confirmation index <= i.
//   * At most `maxTradesPerWindow` trades per (session date, window).
//   * Limit entries at an FVG edge (proximal / 50% / distal), expiring after
//     `entryExpiryBars`.
//   * On an ambiguous bar (both stop and target inside the bar range) the STOP
//     fills first — the pessimistic assumption — and the trade is flagged.
//   * Hard exit at the end of the window (and optionally the RTH close).
//   * Every session that produced no trade lands in the no-trade log with the
//     first rule that rejected it, so the funnel is inspectable.
//
// Performance: detectors run once over the whole series; the per-session loops
// work on index ranges and typed arrays. No per-bar object allocation.
// ============================================================================

import type { BarSeries } from "../bars";
import { KILLZONES, RTH, type TradeWindow, journalSessionKey, sessionDate } from "../sessions";
import {
  detectFvgsTf, detectSwings, detectSwingsTf, detectSweeps, detectMss, detectDisplacement,
  buildLiquidityUniverse, sessionSpans, htfBias, structureBias, etMinutes,
  detectOrderFlowLegs, detectVShapes, detectRanges, priorSessionProfiles, midBalanceFlags, detectSmt,
  type BiasMode, type Direction, type Displacement, type FairValueGap,
  type LiquidityLevel, type Swing, type SweepUniverse, type OrderFlowLeg, type RangeContext,
} from "./detectors";
import { instrumentSpec, pointsToCash, sizeForRisk, type InstrumentSpec } from "./instruments";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type EntryMode = "proximal" | "mid" | "distal";
export type StopMode = "swing" | "gap" | "displacement_swing" | "leg_origin";
export type TargetMode = "r" | "liquidity" | "range_mean";
export type EngineBiasMode = BiasMode | "structure_15m" | "none";
export type RegimeFilter = "any" | "rotational" | "transitional";


/** Hard safety cap on trades per window, whatever the config asks for. */
export const MAX_TRADES_PER_WINDOW_CAP = 10;

export interface EngineConfig {
  /**
   * One or more trade windows. Each listed window is scanned independently
   * inside the session; daily PnL aggregates across them.
   */
  windows: TradeWindow[];
  /** Timeframe (minutes) the FVGs are detected on. 1 = raw minute gaps. */
  fvgTimeframe: number;
  biasMode: EngineBiasMode;
  biasTrendDays: number;
  /** Swing timeframe (minutes) for `biasMode: "structure_15m"`. */
  biasSwingTimeframe: number;
  requireSweep: boolean;
  /** Which levels the sweep rule (and the liquidity target) may use. */
  sweepUniverse: SweepUniverse;
  /** Only the K nearest unswept levels per side are eligible. 0 = all. */
  sweepK: number;
  /** Minimum penetration beyond the level, in ticks. */
  sweepPenetrationTicks: number;
  /** Sweep must occur within this many bars before the signal bar. */
  sweepLookbackBars: number;
  requireMss: boolean;
  mssLookbackBars: number;
  requireDisplacement: boolean;
  displacementMode: "atr" | "percentile";
  displacementAtrMultiple: number;
  /**
   * How far back from the qualifying displacement bar the leg origin is taken
   * for `stopMode: "displacement_swing"`.
   */
  displacementLegBars: number;
  minFvgPoints: number;
  entry: EntryMode;
  entryExpiryBars: number;
  stopMode: StopMode;
  stopBufferTicks: number;
  targetMode: TargetMode;
  targetR: number;
  maxTradesPerWindow: number;
  hardExitAtWindowEnd: boolean;
  hardExitAtRthEnd: boolean;
  swingStrength: number;
  /** Position size in contracts / lots, used when `sizing` is "fixed". */
  size: number;
  /**
   * "fixed"  — every trade uses `size` lots (raw signal study).
   * "risk"   — size is solved so the stop distance costs `riskPercent` of
   *            `accountBalance` (or `riskCashOverride` when set), matching how
   *            the prop-firm simulator and the journal measure risk.
   * Risk is fixed-fractional off the *starting* balance, not compounded, so a
   * walk-forward fold's result doesn't depend on where it sits in the sequence.
   */
  sizing: "fixed" | "risk";
  accountBalance: number;
  riskPercent: number;
  riskCashOverride: number | null;
  /** Charge the modelled spread (instrument spec) on top of slippage. */
  applySpread: boolean;

  // --- Playbook rules (all default-off: existing configs are unchanged) -----
  /** Require a confirmed 1-minute order-flow leg (1-2-3) in the same direction. */
  requireOrderFlowLeg: boolean;
  orderFlowLookbackBars: number;
  /** Require a V-shape reversal on `vShapeTimeframe` candles within lookback. */
  requireVShape: boolean;
  vShapeTimeframe: number;
  vShapeAtrMultiple: number;
  vShapeLookbackBars: number;
  /**
   * "quartile" — only take longs below the 25% quartile of the prevailing HTF
   * consolidation range and shorts above the 75% quartile.
   */
  rangeZoneFilter: "off" | "quartile";
  rangeTimeframe: number;
  rangeLookbackBars: number;
  rangeMaxWidthAtr: number;
  /** Trade only when the market is in balance / out of balance. */
  regimeFilter: RegimeFilter;
  /** Skip setups while price sits in the middle of the prior value area. */
  avoidMidBalance: boolean;
  /** Floor on the stop distance, in ticks (the "minimum 4 pips" rule). */
  minStopDistanceTicks: number;
  /** Move the stop to entry once this many R of favourable excursion print. 0 = off. */
  breakevenAtR: number;
  /** Close a counter-bias trade on the first ET hourly close after entry. */
  exitCounterTrendAtHourClose: boolean;
  /** Require SMT divergence against the reference series (see `runBacktest`). */
  requireSmt: boolean;
  smtLookbackBars: number;
  /** Reference is negatively correlated (e.g. EURUSD vs DXY). */
  smtInverse: boolean;
}


export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  windows: [KILLZONES.ny_am],
  fvgTimeframe: 1,
  biasMode: "prior_close",
  biasTrendDays: 3,
  biasSwingTimeframe: 15,
  requireSweep: true,
  sweepUniverse: "session_refs",
  sweepK: 0,
  sweepPenetrationTicks: 0,
  sweepLookbackBars: 30,
  requireMss: true,
  mssLookbackBars: 15,
  requireDisplacement: false,
  displacementMode: "atr",
  displacementAtrMultiple: 1.5,
  displacementLegBars: 10,
  minFvgPoints: 0,
  entry: "proximal",
  entryExpiryBars: 20,
  stopMode: "gap",
  stopBufferTicks: 2,
  targetMode: "r",
  targetR: 2,
  maxTradesPerWindow: 1,
  hardExitAtWindowEnd: true,
  hardExitAtRthEnd: false,
  swingStrength: 2,
  size: 1,
  sizing: "risk",
  accountBalance: 50_000,
  riskPercent: 0.6,
  riskCashOverride: null,
  applySpread: true,

  requireOrderFlowLeg: false,
  orderFlowLookbackBars: 20,
  requireVShape: false,
  vShapeTimeframe: 5,
  vShapeAtrMultiple: 1.2,
  vShapeLookbackBars: 15,
  rangeZoneFilter: "off",
  rangeTimeframe: 15,
  rangeLookbackBars: 24,
  rangeMaxWidthAtr: 6,
  regimeFilter: "any",
  avoidMidBalance: false,
  minStopDistanceTicks: 0,
  breakevenAtR: 0,
  exitCounterTrendAtHourClose: false,
  requireSmt: false,
  smtLookbackBars: 30,
  smtInverse: false,
};


// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type ExitReason = "stop" | "target" | "window_end" | "session_end" | "rth_end" | "hour_close";


export interface BacktestTrade {
  symbol: string;
  sessionDate: string;
  windowKey: string;
  /** Journal-compatible session label so backtest and journal bucket alike. */
  journalSession: string;
  direction: "long" | "short";
  setupIndex: number;
  setupTs: number;
  entryIndex: number;
  entryTs: number;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number | null;
  exitIndex: number;
  exitTs: number;
  exitPrice: number;
  exitReason: ExitReason;
  barsHeld: number;
  riskPoints: number;
  grossPoints: number;
  grossPnl: number;
  commission: number;
  /** Modelled spread cost for the round turn, in cash. */
  spreadCost: number;
  /** Contracts / lots actually traded (solved by the sizer in risk mode). */
  size: number;
  /** Cash at risk between entry and stop for this size — the R denominator. */
  riskCash: number;
  netPnl: number;

  rMultiple: number;
  maePoints: number;
  mfePoints: number;
  /** Stop and target were both inside one bar; the stop was assumed first. */
  ambiguousBar: boolean;
}

export type NoTradeReason =
  | "no_bars_in_window"
  | "no_fvg"
  | "bias_conflict"
  | "no_sweep"
  | "no_mss"
  | "no_displacement"
  | "entry_not_filled"
  | "invalid_stop"
  | "no_liquidity_target"
  | "max_trades_reached";

export interface NoTradeRecord {
  symbol: string;
  sessionDate: string;
  windowKey: string;
  reason: NoTradeReason;
  /** How many FVG candidates were inspected in the window. */
  candidates: number;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  noTrades: NoTradeRecord[];
  sessionsScanned: number;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function runBacktest(
  series: BarSeries,
  symbol: string,
  cfg: Partial<EngineConfig> = {},
  specOverride?: InstrumentSpec,
): BacktestResult {
  const c: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, ...cfg };
  const spec = specOverride ?? instrumentSpec(symbol);
  const trades: BacktestTrade[] = [];
  const noTrades: NoTradeRecord[] = [];
  if (series.length < 5) return { trades, noTrades, sessionsScanned: 0 };

  const windows = c.windows.length ? c.windows : DEFAULT_ENGINE_CONFIG.windows;
  const maxPerWindow = Math.max(1, Math.min(c.maxTradesPerWindow, MAX_TRADES_PER_WINDOW_CAP));

  // --- detectors, once over the whole series -------------------------------
  const fvgs = detectFvgsTf(series, c.fvgTimeframe, c.minFvgPoints);
  const swings = detectSwings(series, c.swingStrength);
  // One universe drives both the sweep rule and the liquidity target, so a
  // target can never sit on a level the sweep rule does not know about.
  const levels = buildLiquidityUniverse(series, spec.cls, {
    universe: c.sweepUniverse,
    windows,
    swingStrength: c.swingStrength,
    swingTimeframe: c.biasSwingTimeframe,
  });
  const sweeps = c.requireSweep
    ? detectSweeps(series, levels, c.sweepPenetrationTicks * spec.tickSize, { k: c.sweepK, onceOnly: c.sweepK > 0 })
    : [];
  const mss = c.requireMss ? detectMss(series, swings) : [];
  const needDisplacement = c.requireDisplacement || c.stopMode === "displacement_swing";
  const displacement = needDisplacement
    ? detectDisplacement(series, { mode: c.displacementMode, atrMultiple: c.displacementAtrMultiple })
    : [];
  const bias = c.biasMode === "none"
    ? null
    : c.biasMode === "structure_15m"
      ? structureBias(series, detectSwingsTf(series, c.biasSwingTimeframe, c.swingStrength))
      : htfBias(series, spec.cls, c.biasMode, c.biasTrendDays);
  const etMin = etMinutes(series);
  const spans = sessionSpans(series, spec.cls);

  const fvgByIndex = groupByIndex(fvgs);
  const sweepByIndex = groupByIndex(sweeps);
  const mssByIndex = groupByIndex(mss);
  const dispByIndex = groupByIndex(displacement);
  const buffer = c.stopBufferTicks * spec.tickSize;

  for (const span of spans) {
   for (const win of windows) {
    // Bars of this session inside the trade window.
    let ws = -1;
    let we = -1;
    for (let i = span.from; i <= span.to; i++) {
      const m = etMin[i];
      if (m >= win.startMin && m < win.endMin) {
        if (ws < 0) ws = i;
        we = i;
      }
    }
    if (ws < 0) {
      noTrades.push({ symbol, sessionDate: span.dateKey, windowKey: win.key, reason: "no_bars_in_window", candidates: 0 });
      continue;
    }

    // Hard-exit boundary for trades opened in this window.
    let boundary = c.hardExitAtWindowEnd ? we : span.to;
    if (c.hardExitAtRthEnd) {
      let rthEnd = -1;
      for (let i = span.from; i <= span.to; i++) if (etMin[i] < RTH.endMin && etMin[i] >= RTH.startMin) rthEnd = i;
      if (rthEnd >= 0) boundary = Math.min(boundary, rthEnd);
    }
    const boundaryReason: ExitReason = c.hardExitAtWindowEnd ? "window_end" : c.hardExitAtRthEnd ? "rth_end" : "session_end";

    let taken = 0;
    let candidates = 0;
    let firstReject: NoTradeReason | null = null;
    let nextFreeIndex = ws;

    for (let i = ws; i <= we && taken < maxPerWindow; i++) {
      if (i < nextFreeIndex) continue;
      const gaps = fvgByIndex.get(i);
      if (!gaps) continue;
      for (const gap of gaps) {
        if (i < nextFreeIndex) break;
        candidates++;
        const long = gap.direction === "bull";

        if (bias) {
          const b = bias[i];
          if ((long && b < 0) || (!long && b > 0)) { firstReject ??= "bias_conflict"; continue; }
        }
        if (c.requireSweep && !hasEvent(sweepByIndex, i - c.sweepLookbackBars, i, (e: { side: string }) => (long ? e.side === "low" : e.side === "high"))) {
          firstReject ??= "no_sweep"; continue;
        }
        if (c.requireMss && !hasEvent(mssByIndex, i - c.mssLookbackBars, i, (e: { direction: Direction }) => e.direction === gap.direction)) {
          firstReject ??= "no_mss"; continue;
        }
        const disp = findEvent<Displacement>(dispByIndex, i - 3, i, (e) => e.direction === gap.direction);
        if (c.requireDisplacement && !disp) { firstReject ??= "no_displacement"; continue; }

        const entryLevel = c.entry === "proximal" ? gap.proximal : c.entry === "mid" ? gap.mid : gap.distal;
        const stopBase = resolveStopBase(series, c, swings, gap, disp, i, ws, long, entryLevel);
        const stopPrice = long ? stopBase - buffer : stopBase + buffer;
        const riskPoints = long ? entryLevel - stopPrice : stopPrice - entryLevel;
        if (!(riskPoints > 0)) { firstReject ??= "invalid_stop"; continue; }

        const trade = simulateTrade(series, {
          symbol, spec, cfg: c, gap, long, entryLevel, stopPrice, riskPoints,
          signalIndex: i, boundary, boundaryReason, levels, sessionDateKey: span.dateKey,
          windowKey: win.key,
        });
        if (!trade) { firstReject ??= "entry_not_filled"; continue; }

        trades.push(trade);
        taken++;
        // Sequential only: the next setup is scanned from the bar after the
        // exit, so a window can produce several trades but never overlapping
        // ones (risk per window stays bounded at 1R at a time).
        nextFreeIndex = trade.exitIndex + 1;
        break;
      }
    }

    if (taken === 0) {
      noTrades.push({
        symbol, sessionDate: span.dateKey, windowKey: win.key,
        reason: firstReject ?? (candidates === 0 ? "no_fvg" : "entry_not_filled"),
        candidates,
      });
    }
   }
  }

  return { trades, noTrades, sessionsScanned: spans.length };
}

interface SimArgs {
  symbol: string;
  spec: InstrumentSpec;
  cfg: EngineConfig;
  gap: FairValueGap;
  long: boolean;
  entryLevel: number;
  stopPrice: number;
  riskPoints: number;
  signalIndex: number;
  boundary: number;
  boundaryReason: ExitReason;
  levels: LiquidityLevel[];
  sessionDateKey: string;
  windowKey: string;
}

function simulateTrade(s: BarSeries, a: SimArgs): BacktestTrade | null {
  const { spec, cfg, long, entryLevel, stopPrice, riskPoints, signalIndex, boundary } = a;
  const slip = spec.slippageTicks * spec.tickSize;

  // --- limit fill ---------------------------------------------------------
  const expiry = Math.min(signalIndex + cfg.entryExpiryBars, boundary);
  let entryIndex = -1;
  for (let j = signalIndex + 1; j <= expiry; j++) {
    if (long ? s.low[j] <= entryLevel : s.high[j] >= entryLevel) { entryIndex = j; break; }
  }
  if (entryIndex < 0) return null;
  // Adverse slippage on the entry fill.
  const entryPrice = long ? entryLevel + slip : entryLevel - slip;

  // --- target -------------------------------------------------------------
  let targetPrice: number | null = null;
  if (cfg.targetMode === "r") {
    targetPrice = long ? entryLevel + riskPoints * cfg.targetR : entryLevel - riskPoints * cfg.targetR;
  } else {
    targetPrice = nearestLiquidityTarget(a.levels, entryIndex, entryLevel, long)
      ?? (long ? entryLevel + riskPoints * cfg.targetR : entryLevel - riskPoints * cfg.targetR);
  }

  // --- walk forward -------------------------------------------------------
  let exitIndex = boundary;
  let exitPrice = s.close[boundary];
  let exitReason: ExitReason = a.boundaryReason;
  let ambiguous = false;
  let mae = 0;
  let mfe = 0;

  for (let j = entryIndex; j <= boundary; j++) {
    // On the entry bar the intrabar path before the fill is unknown, so only
    // the adverse side counts: the stop can hit, the target cannot. Favourable
    // excursion is likewise only tracked from the following bar.
    const entryBar = j === entryIndex;
    const adverse = long ? entryPrice - s.low[j] : s.high[j] - entryPrice;
    const favourable = long ? s.high[j] - entryPrice : entryPrice - s.low[j];
    if (adverse > mae) mae = adverse;
    if (!entryBar && favourable > mfe) mfe = favourable;

    const stopHit = long ? s.low[j] <= stopPrice : s.high[j] >= stopPrice;
    const targetHit = !entryBar && targetPrice != null && (long ? s.high[j] >= targetPrice : s.low[j] <= targetPrice);

    if (stopHit && targetHit) ambiguous = true;

    if (stopHit) {
      // Pessimistic: stop first on an ambiguous bar, filled with slippage.
      exitIndex = j;
      exitPrice = long ? stopPrice - slip : stopPrice + slip;
      exitReason = "stop";
      break;
    }
    if (targetHit) {
      exitIndex = j;
      exitPrice = targetPrice as number; // resting limit — no adverse slippage
      exitReason = "target";
      break;
    }
  }

  // --- money ---------------------------------------------------------------
  // Size is solved from the *intended* risk (entry→stop), so R is comparable
  // across instruments and lines up with the prop-firm simulator. A stop that
  // is too wide for even one size step yields size 0 and the trade is dropped
  // rather than silently taken at an unfundable size.
  const intendedRisk = cfg.sizing === "risk"
    ? (cfg.riskCashOverride ?? (cfg.accountBalance * cfg.riskPercent) / 100)
    : 0;
  const size = cfg.sizing === "risk"
    ? sizeForRisk(intendedRisk, riskPoints, spec)
    : cfg.size;
  if (!(size > 0)) return null;

  const grossPoints = long ? exitPrice - entryPrice : entryPrice - exitPrice;
  const grossPnl = pointsToCash(grossPoints, spec, size);
  const commission = spec.commissionPerSide * 2 * size;
  // Bars are one-sided (bid/mid), so the spread is a modelled round-turn cash
  // cost rather than a price adjustment — charging it in price would also
  // distort stop/target hit detection.
  const spreadCost = cfg.applySpread
    ? pointsToCash(spec.spreadTicks * spec.tickSize, spec, size)
    : 0;
  const netPnl = grossPnl - commission - spreadCost;
  const riskCash = pointsToCash(riskPoints, spec, size);


  return {
    symbol: a.symbol,
    sessionDate: a.sessionDateKey,
    windowKey: a.windowKey,
    journalSession: journalSessionKey(a.windowKey),
    direction: long ? "long" : "short",
    setupIndex: signalIndex,
    setupTs: s.ts[signalIndex],
    entryIndex,
    entryTs: s.ts[entryIndex],
    entryPrice,
    stopPrice,
    targetPrice,
    exitIndex,
    exitTs: s.ts[exitIndex],
    exitPrice,
    exitReason,
    barsHeld: exitIndex - entryIndex,
    riskPoints,
    grossPoints,
    grossPnl,
    commission,
    spreadCost,
    size,
    riskCash,
    netPnl,

    rMultiple: riskCash > 0 ? netPnl / riskCash : 0,
    maePoints: Math.max(0, mae),
    mfePoints: Math.max(0, mfe),
    ambiguousBar: ambiguous,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupByIndex<T extends { index: number }>(items: T[]): Map<number, T[]> {
  const m = new Map<number, T[]>();
  for (const it of items) {
    const bucket = m.get(it.index);
    if (bucket) bucket.push(it); else m.set(it.index, [it]);
  }
  return m;
}

function findEvent<T>(byIndex: Map<number, T[]>, from: number, to: number, pred: (e: T) => boolean): T | null {
  let found: T | null = null;
  for (let i = Math.max(0, from); i <= to; i++) {
    const bucket = byIndex.get(i);
    if (!bucket) continue;
    for (const e of bucket) if (pred(e)) found = e; // most recent wins
  }
  return found;
}

/**
 * Protective price the stop is placed beyond, before the tick buffer.
 * - "gap": the far edge of the FVG.
 * - "swing": the last confirmed swing on the protective side.
 * - "displacement_swing": the origin of the displacement leg that created the
 *   gap — the extreme printed between `displacementLegBars` before the
 *   qualifying displacement bar and the signal bar. Falls back to the gap edge
 *   when no displacement qualified.
 */
function resolveStopBase(
  s: BarSeries,
  c: EngineConfig,
  swings: Swing[],
  gap: FairValueGap,
  disp: Displacement | null,
  signalIndex: number,
  windowStart: number,
  long: boolean,
  entryLevel: number,
): number {
  if (c.stopMode === "swing") return swingStop(swings, signalIndex, long, entryLevel) ?? gap.distal;
  if (c.stopMode === "displacement_swing") {
    if (!disp) return gap.distal;
    const from = Math.max(0, Math.min(disp.index - Math.max(0, c.displacementLegBars), signalIndex));
    let extreme = long ? Infinity : -Infinity;
    for (let j = Math.max(from, Math.min(windowStart, disp.index)); j <= signalIndex; j++) {
      if (long) { if (s.low[j] < extreme) extreme = s.low[j]; }
      else if (s.high[j] > extreme) extreme = s.high[j];
    }
    if (!Number.isFinite(extreme)) return gap.distal;
    return long ? Math.min(extreme, gap.distal) : Math.max(extreme, gap.distal);
  }
  return gap.distal;
}

function hasEvent<T>(byIndex: Map<number, T[]>, from: number, to: number, pred: (e: T) => boolean): boolean {
  for (let i = Math.max(0, from); i <= to; i++) {
    const bucket = byIndex.get(i);
    if (!bucket) continue;
    for (const e of bucket) if (pred(e)) return true;
  }
  return false;
}

/** Most recent swing confirmed at or before `atIndex`, on the protective side. */
function swingStop(swings: Swing[], atIndex: number, long: boolean, entry: number): number | null {
  let best: number | null = null;
  for (const sw of swings) {
    if (sw.confirmedIndex > atIndex) break;
    if (long && sw.kind === "low" && sw.price < entry) best = sw.price;
    if (!long && sw.kind === "high" && sw.price > entry) best = sw.price;
  }
  return best;
}

/** Nearest usable liquidity level beyond entry in the trade direction. */
function nearestLiquidityTarget(levels: LiquidityLevel[], atIndex: number, entry: number, long: boolean): number | null {
  let best: number | null = null;
  for (const l of levels) {
    if (l.validFromIndex > atIndex) continue;
    if (long && l.kind.endsWith("high") && l.price > entry) {
      if (best === null || l.price < best) best = l.price;
    }
    if (!long && l.kind.endsWith("low") && l.price < entry) {
      if (best === null || l.price > best) best = l.price;
    }
  }
  return best;
}

/** Session date of a bar — re-exported so callers don't import two modules. */
export function barSessionDate(ms: number, spec: InstrumentSpec): string {
  return sessionDate(ms, spec.cls);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface BacktestSummary {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  expectancyR: number;
  avgWinR: number;
  avgLossR: number;
  profitFactor: number;
  maxDrawdown: number;
  ambiguousBars: number;
  exitBreakdown: Record<ExitReason, number>;
  noTradeBreakdown: Record<string, number>;
}

export function summarize(res: BacktestResult): BacktestSummary {
  const exitBreakdown = { stop: 0, target: 0, window_end: 0, session_end: 0, rth_end: 0 } as Record<ExitReason, number>;
  const noTradeBreakdown: Record<string, number> = {};
  for (const n of res.noTrades) noTradeBreakdown[n.reason] = (noTradeBreakdown[n.reason] ?? 0) + 1;

  let wins = 0, losses = 0, net = 0, sumR = 0, winR = 0, lossR = 0, gp = 0, gl = 0, ambiguous = 0;
  let equity = 0, peak = 0, maxDd = 0;
  for (const t of res.trades) {
    exitBreakdown[t.exitReason]++;
    if (t.ambiguousBar) ambiguous++;
    net += t.netPnl;
    sumR += t.rMultiple;
    if (t.netPnl > 0) { wins++; winR += t.rMultiple; gp += t.netPnl; }
    else { losses++; lossR += t.rMultiple; gl += Math.abs(t.netPnl); }
    equity += t.netPnl;
    if (equity > peak) peak = equity;
    if (peak - equity > maxDd) maxDd = peak - equity;
  }
  const n = res.trades.length;
  return {
    trades: n,
    wins,
    losses,
    winRate: n ? wins / n : 0,
    netPnl: net,
    expectancyR: n ? sumR / n : 0,
    avgWinR: wins ? winR / wins : 0,
    avgLossR: losses ? lossR / losses : 0,
    profitFactor: gl > 0 ? gp / gl : gp > 0 ? Infinity : 0,
    maxDrawdown: maxDd,
    ambiguousBars: ambiguous,
    exitBreakdown,
    noTradeBreakdown,
  };
}
