// Deno port of src/lib/pairLabMath.ts — pure-functional pieces only.
// Trade rows are duck-typed (any) since edge functions have raw DB rows.
//
// Field keys: we follow the same prefix-and-label resolver as the client so
// the edge function reads the same custom_fields as the UI does.
//
// UNIT CONTRACT (2026-06):
//   cf_mae and cf_ideal_stop_loss are stored in broker TICKS (TradingView
//   position-calc output). Convert with `ticksToPips()` before comparing
//   against pip-denominated SL distances. The slUnit field on each
//   BucketReport surfaces the human-readable label.
//
// Intentional divergence from src/lib/pairLabMath.ts:
//   - server version uses duck-typed `any` rows (raw DB shape)
//   - client version has PropFirmContext, perRow, edgeVsBaseline (UI-only)

import { tickSizeForSymbol, pipSizeForSymbol, pipLabelForSymbol, ticksToPips } from "./symbolMapping.ts";
import {
  TP1_STAR_MIN_HIT_RATE,
  WINNERS_MAE_SL_QUANTILE,
  WINNERS_MAE_SL_BUFFER,
  MAE_P75_WIDEN_BUFFER,
  SL_DRIFT_ALIGNED_MIN,
  SL_DRIFT_ALIGNED_MAX,
  KELLY_SCALE,
  KELLY_FLOOR_PCT,
  KELLY_CEILING_PCT,
  BOOTSTRAP_ITERATIONS,
  BH_FDR_ALPHA,
  MIN_STREAK_FLOOR,
  TRAIL_CAPTURE_FALLBACK,
} from "../../../../shared/quant/config.ts";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface PairLabFieldKeys {
  mfe: string | null;
  mae: string | null;
  idealStopLoss: string | null;
  idealStopLossPos: string | null;
  
}

interface CustomFieldDef { key: string; label: string }

// Canonical PropFirmContext shape lives in shared/quant/types so the React
// client and Supabase edge functions can never drift.
export type { PropFirmContext } from "../../../../shared/quant/types.ts";
import type { PropFirmContext } from "../../../../shared/quant/types.ts";

const LABEL_MAP: Array<{ alias: keyof PairLabFieldKeys; labels: string[]; prefixes: string[] }> = [
  { alias: "mfe",              labels: ["mfe (rr)", "mfe", "max favourable excursion", "max favorable excursion"], prefixes: ["cf_mfe"] },
  { alias: "mae",              labels: ["mae", "max adverse excursion"],                                            prefixes: ["cf_mae"] },
  { alias: "idealStopLoss",    labels: ["ideal stop-loss", "ideal stop loss", "ideal sl"],                          prefixes: ["cf_ideal_stop_loss_rnv7", "cf_ideal_stop_loss"] },
  { alias: "idealStopLossPos", labels: ["ideal stop-loss position", "ideal stop loss position"],                    prefixes: ["cf_ideal_stop_loss_position"] },
  
];

export function resolvePairLabFieldKeys(defs: CustomFieldDef[]): PairLabFieldKeys {
  const out: PairLabFieldKeys = {
    mfe: null, mae: null,
    idealStopLoss: null, idealStopLossPos: null,
  };
  for (const entry of LABEL_MAP) {
    const byLabel = defs.find((d) => entry.labels.includes((d.label || "").trim().toLowerCase()));
    if (byLabel) { out[entry.alias] = byLabel.key; continue; }
    const byPrefix = defs.find((d) => entry.prefixes.some((p) => (d.key || "").startsWith(p)));
    if (byPrefix) out[entry.alias] = byPrefix.key;
  }
  if (out.idealStopLoss && out.idealStopLoss === out.idealStopLossPos) {
    out.idealStopLoss = null;
  }
  return out;
}

// --- robust stats ---
// Unified primitives live in shared/quant/stats so the client and edge
// functions cannot drift. Re-exported here for back-compat with existing
// callers that `import { quantile, ... } from "./pairLabMath.ts"`.
import {
  quantile,
  median,
  mean,
  percentileFromSorted,
  bootstrapMeanCi,
  bootstrapPositivePValue,
  bhSignificant,
  rawQuarterKellyPct,
  quarterKellyPct,
  bootstrapKellyCi,
  normalizeSession,
  getCf,
  numericCf,
  multiSelectCf,
  isUnrealized,
  wilsonCi,
} from "../../../../shared/quant/stats.ts";
export {
  quantile,
  median,
  mean,
  bootstrapMeanCi,
  bootstrapPositivePValue,
  bhSignificant,
  rawQuarterKellyPct,
  quarterKellyPct,
  bootstrapKellyCi,
  normalizeSession,
  numericCf,
  multiSelectCf,
  isUnrealized,
  wilsonCi,
};




export interface BucketKey { symbol: string; session: string }
export interface Tp1Star { r: number; hitRate: number; hitRateCi: [number, number] | null; expectancyR: number }

export interface BucketReport {
  key: BucketKey;
  /** Raw broker symbols rolled up into this canonical key (parity with client). */
  rawSymbols: string[];
  n: number;
  wins: number;
  losses: number;
  winRate: number;
  /** Wilson 95% CI on win rate. null when n=0. */
  winRateCi: [number, number] | null;
  expectedR: number;          // NaN when expectedRSamples === 0
  expectedRMedian: number;    // NaN when expectedRSamples === 0
  expectedRSamples: number;
  expectedRCi: [number, number] | null;
  /** One-sided bootstrap p-value that expectedR > 0. null when n < 5. */
  expectancyPValue: number | null;
  mfeP50: number | null;
  mfeP75: number | null;
  /** Min/max of logged MFE (R). null when no samples. */
  mfeMin: number | null;
  mfeMax: number | null;
  maeP50: number | null;
  maeP75: number | null;
  maeP75Pips: number | null;
  /** Raw MAE tick quantiles (display in user-preferred units). */
  maeP50Ticks: number | null;
  maeP75Ticks: number | null;
  maeMinTicks: number | null;
  maeMaxTicks: number | null;
  idealSlMedianPips: number | null;
  slInitialMedianPips: number | null;
  slDrift: "too_wide" | "too_tight" | "aligned" | null;
  confidence: ConfidenceLevel;
  suggestedSlPips: number | null;
  slSource: "ideal_sl" | "winners_mae" | "winners_mae_fallback" | "legacy";
  slSourceN: number | null;
  slUnit: "pips" | "points";
  tpLadderR: number[];
  suggestedTpR: number | null;
  expectancyAtSuggested: number | null;
  expectancyAtSuggestedCi: [number, number] | null;
  recommendationConfidence: "validated" | "low" | "insufficient";
  walkForward: { inSampleE: number; outOfSampleE: number; degradationPct: number; oosN: number } | null;
  tp1Star: Tp1Star | null;
  suggestedRiskPct: number | null;
  riskBelowFloor: boolean;
  suggestedRiskPctCi: [number, number] | null;
  suggestedRiskPctPropFirm: number | null;
  /** mean(winR) / mean(|lossR|). null when no losses or no wins. */
  payoffRatio: number | null;
  profitFactor: number | null;
  profitFactorAllWins: boolean;
  worstLosingStreak: number;
  loggedMfeCount: number;
  loggedMaeCount: number;
  /** Count of trades with logged ideal-SL. */
  loggedIdealSlCount: number;
  /** Walk-forward drift fields — parity with client. */
  recentN: number;
  recentWinRate: number | null;
  recentExpectedR: number | null;
  drift: number | null;
  topTradeIds: string[];
  bottomTradeIds: string[];
}


function confidenceFor(n: number): ConfidenceLevel {
  // Tightened 2026-06: "high" requires n≥50 — at n=30 the 95% CI on win-rate
  // is still ±18pp, too loose to gate real-money parameter changes.
  if (n >= 50) return "high";
  if (n >= 15) return "medium";
  return "low";
}
// Unified "side of trade" classifier — mirrors src/lib/pairLabMath.ts
// tradeSide(). Uses r_multiple_actual when present (precise, BE = 0); falls
// back to net_pnl sign. M1 fix: streak math agreed with `sideOf()` inside
// computeBucket but not with this older net_pnl-only loop.
function tradeSide(t: any): 1 | -1 | 0 {
  if (t?.r_multiple_actual != null) {
    if (t.r_multiple_actual > 0) return 1;
    if (t.r_multiple_actual < 0) return -1;
    return 0;
  }
  const p = t?.net_pnl ?? 0;
  return p > 0 ? 1 : p < 0 ? -1 : 0;
}
function longestLossStreak(rows: any[]): number {
  // R1.1 parity: closed-only via `!is_open` (drop floating-P&L on live trades).
  // R1.6 parity: numeric epoch sort instead of localeCompare on ISO strings.
  const sorted = [...rows]
    .filter((t) => !t.is_open && t.entry_time)
    .sort((a, b) => Date.parse(String(a.entry_time)) - Date.parse(String(b.entry_time)));
  let run = 0, worst = 0;
  for (const t of sorted) {
    if (tradeSide(t) === -1) { run += 1; if (run > worst) worst = run; }
    else run = 0;
  }
  return worst;
}



function computeTp1Star(
  pairs: Array<{ mfeR: number; rActual: number | null }>,
  avgLossR: number,
): Tp1Star | null {
  if (pairs.length < 10) return null; // O4 parity
  const candidates = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0];
  let best: Tp1Star | null = null;
  const fallbackMiss = -Math.abs(avgLossR);
  // Empirical miss cost: when MFE < r, use the conditional mean r_actual of
  // missing trades (BE / partial / full stop) rather than the worst-case
  // avgLossR. Falls back to −avgLossR when fewer than 5 misses with rActual.
  for (const r of candidates) {
    let hits = 0;
    const missRs: number[] = [];
    for (const p of pairs) {
      if (p.mfeR >= r) hits += 1;
      else if (p.rActual != null && Number.isFinite(p.rActual)) missRs.push(p.rActual);
    }
    const hitRate = hits / pairs.length;
    if (hitRate < TP1_STAR_MIN_HIT_RATE) continue;
    const missMean = missRs.length >= 5
      ? missRs.reduce((s, v) => s + v, 0) / missRs.length
      : fallbackMiss;
    const expectancyR = hitRate * r + (1 - hitRate) * missMean;
    if (!best || expectancyR > best.expectancyR) {
      best = { r, hitRate, hitRateCi: wilsonCi(hits, pairs.length), expectancyR };
    }
  }
  return best;
}

/**
 * S1.3 parity: resolve the SL distance in force at MAE. We don't have an MAE
 * timestamp, so the conservative proxy is the SL active at exit_time —
 * captured via `trade_modifications` (most recent SL change ≤ exit_time)
 * falling back to sl_final, then sl_initial. Returns null when distance ≤ 0
 * (e.g., trade moved to BE) so the caller drops the row from maesR.
 */
function resolveSlAtMaePrice(t: any): number | null {
  if (t.entry_price == null) return null;
  let effectiveSl: number | null = null;
  const mods = t.trade_modifications;
  if (Array.isArray(mods) && mods.length > 0 && t.exit_time) {
    const exitMs = Date.parse(String(t.exit_time));
    let bestMs = -Infinity;
    for (const m of mods) {
      if (!m || m.field !== "sl" || m.new_value == null) continue;
      const ms = Date.parse(String(m.occurred_at));
      if (Number.isFinite(ms) && ms <= exitMs && ms > bestMs) {
        bestMs = ms;
        effectiveSl = Number(m.new_value);
      }
    }
  }
  if (effectiveSl == null) effectiveSl = t.sl_final ?? t.sl_initial ?? null;
  if (effectiveSl == null) return null;
  const dist = Math.abs(t.entry_price - effectiveSl);
  return dist > 0 ? dist : null;
}

/** Convert a stored `cf_mae` / `cf_ideal_stop_loss` value (TICKS) into the per-trade R-multiple, given the trade's SL distance. */
function ticksToR(ticks: number, t: any): number | null {
  if (!t.symbol) return null;
  const pip = pipSizeForSymbol(t.symbol);
  if (!(pip > 0)) return null;
  const slDistPrice = resolveSlAtMaePrice(t);
  if (slDistPrice == null) return null;
  const slDistPips = slDistPrice / pip;
  if (!(slDistPips > 0)) return null;
  const pips = ticksToPips(t.symbol, Math.abs(ticks));
  return pips / slDistPips;
}

// ----- TP grid + walk-forward helpers (mirror src/lib/pairLabMath.ts) -----
interface MfePair { mfeR: number; rActual: number }

// Trail-capture is intentionally not threaded into scoreTp; mixing it with
// realized exits biases the TP-grid argmax low. See client scoreTp.
function scoreTp(tp: number, sample: MfePair[]): number {
  if (sample.length === 0) return 0;
  let sum = 0;
  for (const p of sample) {
    if (p.mfeR >= tp) sum += tp;
    else sum += p.rActual;
  }
  return sum / sample.length;
}

function collectMfeRPairs(rows: any[], keys: PairLabFieldKeys): MfePair[] {
  const out: MfePair[] = [];
  for (const t of rows) {
    const mfeR = numericCf(t, keys.mfe);
    if (mfeR == null) continue;
    if (t.r_multiple_actual == null || !Number.isFinite(t.r_multiple_actual)) continue;
    out.push({ mfeR, rActual: t.r_multiple_actual });
  }
  return out;
}

function estimateTrailCaptureRows(rows: any[], keys: PairLabFieldKeys, minSample = 10): number {
  const ratios: number[] = [];
  for (const t of rows) {
    if (t.is_open || t.is_archived) continue;
    const mfe = numericCf(t, keys.mfe);
    const r = t.r_multiple_actual;
    if (mfe == null || r == null) continue;
    if (!(mfe > 0) || !(r > 0)) continue;
    if (mfe - r < 0.1) continue;
    const ratio = r / mfe;
    if (ratio > 0 && ratio < 1.05) ratios.push(ratio);
  }
  if (ratios.length < minSample) return 0.7;
  const m = median(ratios);
  if (m == null || !(m > 0)) return 0.7;
  return Math.max(0.1, Math.min(0.95, m));
}

function pickBestTp(
  pairs: MfePair[],
): { tpR: number; expectancy: number; ladder: number[]; ci: [number, number] | null } | null {
  if (pairs.length < 10) return null;
  // S1.5 parity: dynamic ceiling. Hard-cap 4R hid genuine outsize-MFE edges
  // (news, crypto runners). Extend the grid to the 95th-percentile MFE
  // (clamped to [4R, 10R]) so we can surface 5R+ TPs when justified.
  const sortedMfe = pairs.map((p) => p.mfeR).sort((a, b) => a - b);
  const p95 = sortedMfe[Math.min(sortedMfe.length - 1, Math.floor(sortedMfe.length * 0.95))] ?? 4;
  const ceiling = Math.min(10, Math.max(4, Math.ceil(p95 * 4) / 4));
  const grid: number[] = [];
  for (let r = 0.5; r <= ceiling + 1e-6; r += 0.25) grid.push(Math.round(r * 4) / 4);
  const scored = grid.map((tp) => ({ tp, e: scoreTp(tp, pairs) }));
  let best: { tp: number; e: number } | null = null;
  for (const c of scored) if (!best || c.e > best.e) best = c;
  if (!best || !(best.e > 0)) return null;
  let seed = pairs.length * 1000003;
  for (const p of pairs) seed = (seed * 31 + Math.floor((p.mfeR * 1000 + p.rActual * 1000))) | 0;
  if (seed === 0) seed = 0x9e3779b9;
  const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) % 1_000_000) / 1_000_000; };
  const iters = BOOTSTRAP_ITERATIONS;
  const samples: number[] = new Array(iters);
  const buf: MfePair[] = new Array(pairs.length);
  for (let i = 0; i < iters; i++) {
    for (let j = 0; j < pairs.length; j++) buf[j] = pairs[Math.floor(rand() * pairs.length)];
    samples[i] = scoreTp(best.tp, buf);
  }
  samples.sort((a, b) => a - b);
  const ci: [number, number] = [percentileFromSorted(samples, 0.025), percentileFromSorted(samples, 0.975)];
  const ladder = Array.from(
    new Set([...scored].filter((c) => c.e > 0).sort((a, b) => b.e - a.e).slice(0, 3).map((c) => c.tp)),
  ).sort((a, b) => a - b);
  return { tpR: best.tp, expectancy: best.e, ladder, ci };
}

function runWalkForward(rows: any[], keys: PairLabFieldKeys):
  | { inSampleE: number; outOfSampleE: number; degradationPct: number; oosN: number }
  | null {
  // R1.1 + O1 parity — closed-only via `!is_open`, exclude unrealized.
  const closed = rows.filter(
    (t) => !t.is_open && t.entry_time && !isUnrealized(t),
  );
  if (closed.length < 30) return null;
  // R1.6 parity: numeric epoch sort.
  const sorted = [...closed].sort((a, b) => Date.parse(String(a.entry_time)) - Date.parse(String(b.entry_time)));
  const cutoff = Math.floor(sorted.length * 0.7);
  const isRows = sorted.slice(0, cutoff);
  const oosRows = sorted.slice(cutoff);
  // Q4 parity: standardise on 10.
  if (oosRows.length < 10) return null;
  const isPairs = collectMfeRPairs(isRows, keys);
  const oosPairs = collectMfeRPairs(oosRows, keys);
  if (isPairs.length < 10 || oosPairs.length < 5) return null;
  const pick = pickBestTp(isPairs);
  if (!pick) return null;
  const outOfSampleE = scoreTp(pick.tpR, oosPairs);
  const degradationPct = pick.expectancy > 0 ? (1 - outOfSampleE / pick.expectancy) * 100 : 0;
  return { inSampleE: pick.expectancy, outOfSampleE, degradationPct, oosN: oosPairs.length };
}

export function computeBucket(
  key: BucketKey,
  rows: any[],
  keys: PairLabFieldKeys,
  propFirm?: PropFirmContext | null,
  rawSymbols: string[] = [],
  recentN = 10,
): BucketReport {
  // R1.1 parity: closed-only gate via `!is_open`.
  const closed = rows.filter((t) => !t.is_open);
  const sideOf = (t: any): 1 | -1 | 0 => {
    if (t.r_multiple_actual != null) {
      if (t.r_multiple_actual > 0) return 1;
      if (t.r_multiple_actual < 0) return -1;
      return 0;
    }
    const p = t.net_pnl ?? 0;
    return p > 0 ? 1 : p < 0 ? -1 : 0;
  };
  const wins = closed.filter((t) => sideOf(t) === 1);
  const losses = closed.filter((t) => sideOf(t) === -1);

  // R1.3 parity: drop NaN/Infinity from R samples.
  const rActuals = closed.map((t) => t.r_multiple_actual).filter((v): v is number => v != null && Number.isFinite(v));
  const winR = wins.map((t) => t.r_multiple_actual).filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
  const lossR = losses.map((t) => t.r_multiple_actual)
    .filter((v): v is number => v != null && Number.isFinite(v) && v < 0)
    .map((v) => Math.abs(v));

  // Paired (mfeR, rActual) for the empirical-miss tp1Star computation.
  // F2 fix: skip unrealized rows (ideas/paper/missed + zero-PnL-no-mod). They
  // pass the `net_pnl != null` gate above but contribute fake `{mfeR, r:0}`
  // pairs that suppress hit-rate and pull expectancy toward zero. Client
  // (src/lib/pairLabMath.ts) already filters; edge was the divergence.
  const tp1StarPairs: Array<{ mfeR: number; rActual: number | null }> = [];
  for (const t of rows) {
    if (isUnrealized(t)) continue;
    const m = numericCf(t, keys.mfe);
    if (m == null) continue;
    tp1StarPairs.push({ mfeR: m, rActual: t.r_multiple_actual ?? null });
  }

  // MAE is stored in TICKS. Convert to pips for the SL math, R for distribution.
  const maesR: number[] = [];
  const maesPips: number[] = [];
  const maesTicks: number[] = [];
  for (const t of rows) {
    const maeTicks = numericCf(t, keys.mae);
    if (maeTicks == null) continue;
    maesTicks.push(Math.abs(maeTicks));
    if (!t.symbol) continue;
    maesPips.push(Math.abs(ticksToPips(t.symbol, Math.abs(maeTicks))));
    const r = ticksToR(maeTicks, t);
    if (r != null) maesR.push(r);
  }

  // Ideal SL is stored in TICKS — convert to pips for the SL recommendation.
  const idealSls: number[] = [];
  for (const t of rows) {
    const idealTicks = numericCf(t, keys.idealStopLoss);
    if (idealTicks == null || !t.symbol) continue;
    idealSls.push(Math.abs(ticksToPips(t.symbol, idealTicks)));
  }

  const slInitials: number[] = [];
  for (const t of rows) {
    if (t.sl_initial == null || t.entry_price == null || !t.symbol) continue;
    const pip = pipSizeForSymbol(t.symbol);
    if (!(pip > 0)) continue;
    slInitials.push(Math.abs(t.entry_price - t.sl_initial) / pip);
  }

  const n = closed.length;
  const winRate = n > 0 ? wins.length / n : 0;
  const expectedR = rActuals.length > 0 ? mean(rActuals) : NaN;
  const idealMed = median(idealSls);
  const slInitMed = median(slInitials);
  let slDrift: BucketReport["slDrift"] = null;
  if (idealMed != null && slInitMed != null && slInitMed > 0) {
    const ratio = idealMed / slInitMed;
    if (ratio < SL_DRIFT_ALIGNED_MIN) slDrift = "too_wide";
    else if (ratio > SL_DRIFT_ALIGNED_MAX) slDrift = "too_tight";
    else slDrift = "aligned";
  }

  const maeP75Pips = quantile(maesPips, 0.75);

  // ----- SL source cascade: ideal SL > MAE-of-winners > MAE p75 widen. -----
  const winnersMaePips: number[] = [];
  for (const t of rows) {
    if (t.r_multiple_actual == null || !(t.r_multiple_actual > 0)) continue;
    const maeTicks = numericCf(t, keys.mae);
    if (maeTicks == null || !t.symbol) continue;
    winnersMaePips.push(Math.abs(ticksToPips(t.symbol, Math.abs(maeTicks))));
  }
  let suggestedSlPips: number | null = null;
  let slSource: "ideal_sl" | "winners_mae" | "winners_mae_fallback" | "legacy" = "legacy";
  let slSourceN: number | null = null;
  const IDEAL_SL_MIN_N = 5;
  if (idealMed != null && idealMed > 0 && idealSls.length >= IDEAL_SL_MIN_N) {
    suggestedSlPips = idealMed;
    slSource = "ideal_sl";
    slSourceN = idealSls.length;
  } else {
    const slWinners = winnersMaePips.length >= 10 ? quantile(winnersMaePips, WINNERS_MAE_SL_QUANTILE) : null;
    if (slWinners != null && slWinners > 0) {
      suggestedSlPips = slWinners * WINNERS_MAE_SL_BUFFER;
      slSource = "winners_mae";
      slSourceN = winnersMaePips.length;
    } else if (maeP75Pips != null) {
      suggestedSlPips = maeP75Pips * MAE_P75_WIDEN_BUFFER;
      slSource = "winners_mae_fallback";
      slSourceN = winnersMaePips.length;
    } else if (idealMed != null && idealMed > 0) {
      suggestedSlPips = idealMed;
      slSource = "ideal_sl";
      slSourceN = idealSls.length;
    }
  }
  const slMethod: "ok" | "legacy" = slSource === "legacy" ? "legacy" : "ok";

  // ----- TP: MFE-based expectancy grid (no survivorship bias). -----
  const mfeRPairs = collectMfeRPairs(rows, keys);
  // J1 fix: `mfes` was referenced in the return block but never declared on
  // the edge side, throwing a ReferenceError on every server-side report.
  // Mirror the client (`src/lib/pairLabMath.ts`) collection.
  const mfes = rows
    .map((t: any) => numericCf(t, keys.mfe))
    .filter((v): v is number => v != null);
  const trailCapture = estimateTrailCaptureRows(rows, keys);
  const pick = pickBestTp(mfeRPairs, trailCapture);
  let suggestedTpR: number | null = null;
  let expectancyAtSuggested: number | null = null;
  let expectancyAtSuggestedCi: [number, number] | null = null;
  let tpLadderR: number[];
  let tpMethod: "mfe_grid" | "legacy" = "legacy";
  if (pick) {
    suggestedTpR = pick.tpR;
    expectancyAtSuggested = pick.expectancy;
    expectancyAtSuggestedCi = pick.ci;
    tpLadderR = pick.ladder;
    tpMethod = "mfe_grid";
  } else {
    const ladder: number[] = [];
    for (const v of [quantile(winR, 0.3), quantile(winR, 0.5), quantile(winR, 0.75)]) {
      if (v == null || v <= 0) continue;
      ladder.push(v);
    }
    tpLadderR = Array.from(new Set(ladder.map((v) => Math.round(v * 4) / 4))).slice(0, 3);
  }

  let recommendationConfidence: "validated" | "low" | "insufficient";
  if (slMethod === "legacy" || tpMethod === "legacy") recommendationConfidence = "insufficient";
  else if (expectancyAtSuggestedCi && expectancyAtSuggestedCi[0] > 0) recommendationConfidence = "validated";
  else recommendationConfidence = "low";

  const walkForward = runWalkForward(rows, keys);

  const avgWinR = winR.length > 0 ? winR.reduce((a, v) => a + v, 0) / winR.length : 0;
  const avgLossR = lossR.length > 0 ? lossR.reduce((a, v) => a + v, 0) / lossR.length : 1;
  // Mirror client: raw quarter-Kelly clipped only at 1.5% ceiling, with a
  // `riskBelowFloor` signal when raw < 0.25%. The previous server clamp at 0.25%
  // silently inflated tiny edges to a 0.25% recommendation.
  const rawKelly = n >= 10 ? rawQuarterKellyPct(winRate, avgWinR, avgLossR) : null;
  const suggestedRiskPct = rawKelly != null ? Math.min(KELLY_CEILING_PCT, rawKelly) : null;
  const riskBelowFloor = rawKelly != null && rawKelly < KELLY_FLOOR_PCT;
  // Bootstrap CI on the raw Kelly fraction — surfaces when the recommended
  // risk-% is statistically meaningful vs noise.
  const suggestedRiskPctCi = n >= 10 ? bootstrapKellyCi(winR, lossR) : null;
  const tp1Star = computeTp1Star(tp1StarPairs, avgLossR || 1);

  // Profit factor — null + flag so callers can distinguish "no losses" from
  // "no data" (JSON.stringify(Infinity) collapses to null).
  const sumWin = winR.reduce((s, v) => s + v, 0);
  const sumLoss = lossR.reduce((s, v) => s + v, 0);
  const profitFactorAllWins = sumLoss <= 0 && sumWin > 0;
  const profitFactor = sumLoss > 0 ? sumWin / sumLoss : null;

  // Prop-firm cap — mirrors src/lib/pairLabMath.ts exactly:
  //   ddCappedPct = (dailyLossDollars / balance) * 100 / max(3, worstLosingStreak)
  //   clamped to [0.1, propFirm.hardCapPct].
  // N10 fix: compute longestLossStreak once and reuse for both prop-firm cap
  // and the report's worstLosingStreak field.
  const worstStreak = longestLossStreak(rows);
  let suggestedRiskPctPropFirm: number | null = null;
  if (propFirm && propFirm.balance > 0 && propFirm.dailyLossDollars != null && propFirm.dailyLossDollars > 0) {
    const streak = Math.max(MIN_STREAK_FLOOR, worstStreak || 0);
    const dailyBudgetPct = (propFirm.dailyLossDollars / propFirm.balance) * 100;
    const ddCappedPct = dailyBudgetPct / streak;
    const hardCap = propFirm.hardCapPct > 0 ? propFirm.hardCapPct : 2;
    suggestedRiskPctPropFirm = +Math.max(0.1, Math.min(hardCap, ddCappedPct)).toFixed(2);
  }


  const sorted = [...closed].sort((a, b) => (b.r_multiple_actual ?? 0) - (a.r_multiple_actual ?? 0));
  const topTradeIds = sorted.slice(0, 3).map((t) => t.id);
  const bottomTradeIds = sorted.slice(-3).reverse().map((t) => t.id);

  const slUnit = key.symbol && key.symbol !== "All" ? pipLabelForSymbol(key.symbol) : "pips";

  // R2 parity additions — payoff ratio, expectancy p-value, walk-forward drift.
  const payoffRatio = (wins.length > 0 && losses.length > 0 && lossR.length > 0)
    ? (sumWin / winR.length) / (sumLoss / lossR.length)
    : null;

  const eventR: number[] = [...closed]
    .filter((t) => t.entry_time)
    .sort((a, b) => Date.parse(String(a.entry_time)) - Date.parse(String(b.entry_time)))
    .map((t) => {
      const hasR = t.r_multiple_actual != null && Number.isFinite(t.r_multiple_actual);
      return hasR
        ? (t.r_multiple_actual as number)
        : ((t.net_pnl ?? 0) > 0 ? 1 : (t.net_pnl ?? 0) < 0 ? -1 : 0);
    });
  const tail = eventR.slice(-recentN);
  const recentEnough = tail.length >= 5;
  const recentWinRate = recentEnough
    ? tail.filter((r) => r > 0).length / tail.length
    : null;
  const recentExpectedR = recentEnough
    ? tail.reduce((s, r) => s + r, 0) / tail.length
    : null;
  const drift = recentWinRate != null ? (recentWinRate - winRate) * 100 : null;

  return {
    key,
    rawSymbols,
    n,
    wins: wins.length,
    losses: losses.length,
    winRate,
    winRateCi: n > 0 ? wilsonCi(wins.length, n) : null,
    expectedR,
    expectedRMedian: median(rActuals) ?? NaN,
    expectedRSamples: rActuals.length,
    expectedRCi: bootstrapMeanCi(rActuals),
    expectancyPValue: bootstrapPositivePValue(rActuals),
    mfeP50: median(mfes),
    mfeP75: quantile(mfes, 0.75),
    mfeMin: mfes.length > 0 ? mfes.reduce((a, b) => (a < b ? a : b)) : null,
    mfeMax: mfes.length > 0 ? mfes.reduce((a, b) => (a > b ? a : b)) : null,
    maeP50: median(maesR),
    maeP75: quantile(maesR, 0.75),
    maeP75Pips,
    maeP50Ticks: median(maesTicks),
    maeP75Ticks: quantile(maesTicks, 0.75),
    maeMinTicks: maesTicks.length > 0 ? maesTicks.reduce((a, b) => (a < b ? a : b)) : null,
    maeMaxTicks: maesTicks.length > 0 ? maesTicks.reduce((a, b) => (a > b ? a : b)) : null,
    idealSlMedianPips: idealMed,
    slInitialMedianPips: slInitMed,
    slDrift,
    confidence: confidenceFor(n),
    suggestedSlPips,
    slSource,
    slSourceN,
    slUnit,
    tpLadderR,
    suggestedTpR,
    expectancyAtSuggested,
    expectancyAtSuggestedCi,
    recommendationConfidence,
    walkForward,
    tp1Star,
    suggestedRiskPct,
    riskBelowFloor,
    suggestedRiskPctCi,
    suggestedRiskPctPropFirm,
    payoffRatio,
    profitFactor,
    profitFactorAllWins,
    worstLosingStreak: worstStreak,
    loggedMfeCount: closed.filter((t) => numericCf(t, keys.mfe) != null).length,
    loggedMaeCount: closed.filter((t) => {
      const v = numericCf(t, keys.mae);
      return v != null && t.sl_initial != null && t.entry_price != null;
    }).length,
    loggedIdealSlCount: idealSls.length,
    recentN,
    recentWinRate,
    recentExpectedR,
    drift,
    topTradeIds,
    bottomTradeIds,
  };
}

// J2 fix: mirror the client `BuildBucketsOpts` shape so any server-side report
// honours profile / walk-forward / unrealized exactly like the UI. The legacy
// positional `(trades, keys, propFirm, symbolResolver)` calling convention is
// still accepted at the type-level by detecting if the 3rd arg is an opts
// object — but new callers should pass opts.
export interface EdgeBuildBucketsOpts {
  propFirm?: PropFirmContext | null;
  symbolResolver?: (raw: string) => string;
  profile?: string | null;
  /** ISO bounds on entry_time (inclusive). */
  dateFrom?: string | null;
  dateTo?: string | null;
  /** Walk-forward drift window. Default 10. */
  recentN?: number;
  /** Include ideas/paper/missed/dismissed/zero-PnL setup rows. Default false. */
  includeUnrealized?: boolean;
}

export function buildBuckets(
  trades: any[],
  keys: PairLabFieldKeys,
  optsOrPropFirm?: EdgeBuildBucketsOpts | PropFirmContext | null,
  symbolResolverLegacy?: (raw: string) => string,
): {
  perCell: BucketReport[];
  baseline: BucketReport;
  unrealizedExcluded: number;
} {
  // Back-compat: callers historically passed `(trades, keys, propFirm, resolver)`.
  // Detect the opts shape by the absence of PropFirmContext-only fields.
  const isOpts =
    optsOrPropFirm != null &&
    typeof optsOrPropFirm === "object" &&
    !("balance" in (optsOrPropFirm as PropFirmContext));
  const opts: EdgeBuildBucketsOpts = isOpts
    ? (optsOrPropFirm as EdgeBuildBucketsOpts)
    : { propFirm: (optsOrPropFirm as PropFirmContext | null) ?? null, symbolResolver: symbolResolverLegacy };

  const propFirm = opts.propFirm ?? null;
  const resolveSym = opts.symbolResolver ?? ((s: string) => s);
  const includeUnrealized = opts.includeUnrealized === true;
  const dateFrom = opts.dateFrom ?? null;
  const dateTo = opts.dateTo ?? null;

  let unrealizedExcluded = 0;
  const closed: any[] = [];
  for (const t of trades) {
    // R1.1 parity: closed-only via `!is_open` (drop MT5 floating-P&L on live trades).
    if (t.is_open || t.is_archived) continue;
    if (t.net_pnl == null) continue;
    if (opts.profile && t.profile !== opts.profile && t.actual_profile !== opts.profile) continue;
    if (dateFrom || dateTo) {
      const ts = t.entry_time ? String(t.entry_time) : null;
      if (!ts) continue;
      if (dateFrom && ts < dateFrom) continue;
      if (dateTo && ts > dateTo) continue;
    }
    if (!includeUnrealized && isUnrealized(t)) { unrealizedExcluded += 1; continue; }
    closed.push(t);
  }
  const baseline = computeBucket({ symbol: "All", session: "All sessions" }, closed, keys, propFirm, []);
  const cellMap = new Map<string, any[]>();
  const rawSymbolsByKey = new Map<string, Set<string>>();
  for (const t of closed) {
    if (!t.symbol) continue;
    const canonical = resolveSym(t.symbol);
    const sess = normalizeSession(t.session);
    const k = `${canonical}__${sess}`;
    if (!cellMap.has(k)) cellMap.set(k, []);
    cellMap.get(k)!.push(t);
    if (!rawSymbolsByKey.has(k)) rawSymbolsByKey.set(k, new Set());
    rawSymbolsByKey.get(k)!.add(String(t.symbol));
  }
  const perCell: BucketReport[] = [];
  cellMap.forEach((rows, k) => {
    const [symbol, session] = k.split("__");
    const raws = Array.from(rawSymbolsByKey.get(k) ?? []).sort();
    perCell.push(computeBucket({ symbol, session }, rows, keys, propFirm, raws));
  });
  perCell.sort((a, b) => (b.n - a.n) || a.key.symbol.localeCompare(b.key.symbol));
  return { perCell, baseline, unrealizedExcluded };
}

