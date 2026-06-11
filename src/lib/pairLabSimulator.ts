// ============================================================================
// Pair Lab — Strategy Simulator (counterfactual replay)
//
// Replays each historical trade under a hypothetical { risk%, SL rule, exit
// rule } and produces deterministic P&L, win-rate, DD and prop-firm verdict.
// Pure functions — no randomness, no network.
//
// Smart MFE/MAE inference (in priority order, per trade):
//   1. mfe / mae custom fields if recorded.
//   2. tp_reached multi-select: "1:2" → MFE was at least 2R.
//   3. r_multiple_actual: a +1.8R close means MFE was at least 1.8R; a -1R
//      close means MAE was at least 1R. Winners infer MFE = max(r, 1).
//   4. Bucket-median fallback as last resort.
// Each inferred trade is counted in `inferredCount` so the UI can flag low
// fidelity.
//
// Honest caveats (surfaced in UI):
//   * Assumes MFE / MAE are reachable as fills (slightly optimistic for
//     partial scale-outs).
//   * Trail-to-MFE captures 80% of MFE on the runner (slippage allowance).
//   * Trades with no signals at all fall back to bucket medians.
// ============================================================================

import type { Trade } from "@/types/trading";
import type { PairLabFieldKeys, PropFirmContext } from "@/lib/pairLabMath";

export type SlRule = "original" | "tighten_to_ideal" | "widen_to_mae_p75_x_1_15";
export type RunnerRule = "trail_to_mfe" | "be_after_first_tp" | "all_out_at_last_partial";

export interface ExitRule {
  /** Partials sorted ascending by atR. Fractions must sum to ≤1. */
  partials: Array<{ atR: number; fraction: number }>;
  runner: RunnerRule;
}

export interface Strategy {
  id: string;
  label: string;
  description?: string;
  riskPct: number;
  slRule: SlRule;
  exitRule: ExitRule;
  /** Special preset: replay using the trade's actual r_multiple, ignoring rules. */
  useActualOutcome?: boolean;
}

export interface ReplayPerTrade {
  tradeId: string;
  entryTime: string | null;
  resultR: number;
  dollars: number;
  cumulativeEquity: number;
  inferred: boolean;
}

export interface ReplayResult {
  strategy: Strategy;
  n: number;
  wins: number;
  losses: number;
  winRate: number;
  expectancyR: number;
  totalR: number;
  totalDollars: number;
  maxDrawdownDollars: number;
  maxDrawdownPct: number;
  worstLosingStreak: number;
  equityCurve: Array<{ i: number; equity: number; at: string | null }>;
  perTrade: ReplayPerTrade[];
  propFirmVerdict: "pass" | "bust_daily" | "bust_total" | "n/a";
  bustNote: string | null;
  /** How many trades used inferred MFE/MAE (no recorded field). */
  inferredCount: number;
}

// ----------------------------------------------------------------------------
// Field readers
// ----------------------------------------------------------------------------

function getCf(trade: any, key: string | null): unknown {
  if (!key) return undefined;
  const cf = trade?.custom_fields;
  if (!cf || typeof cf !== "object") return undefined;
  return cf[key];
}

function numericCf(trade: any, key: string | null): number | null {
  const v = getCf(trade, key);
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function multiSelectCf(trade: any, key: string | null): string[] {
  const v = getCf(trade, key);
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v) return [v];
  return [];
}

/** Parse strings like "1:2", "1R", "2", "TP2" → R-multiple. */
function parseTpLabel(s: string): number | null {
  if (!s) return null;
  const clean = s.trim().toUpperCase();
  // "1:2" or "1:1.5"
  const ratio = clean.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (ratio) {
    const a = Number(ratio[1]), b = Number(ratio[2]);
    if (a > 0) return b / a;
  }
  // "TP2" → assume 2R
  const tp = clean.match(/^TP\s*(\d+(?:\.\d+)?)$/);
  if (tp) return Number(tp[1]);
  // "2R" or bare number
  const num = clean.match(/^(\d+(?:\.\d+)?)R?$/);
  if (num) return Number(num[1]);
  return null;
}

function maxTpReached(trade: Trade, keys: PairLabFieldKeys): number | null {
  const labels = multiSelectCf(trade as any, keys.tpReached);
  if (labels.length === 0) return null;
  const rs = labels.map(parseTpLabel).filter((v): v is number => v != null && v > 0);
  if (rs.length === 0) return null;
  return Math.max(...rs);
}

function slPipsFor(t: Trade): number | null {
  if (t.sl_initial == null || t.entry_price == null) return null;
  const distance = Math.abs(t.entry_price - t.sl_initial);
  const digits = String(t.entry_price).split(".")[1]?.length ?? 4;
  const pipMultiplier = digits >= 4 ? 10_000 : 100;
  return distance * pipMultiplier;
}

function quantile(values: number[], q: number): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (xs.length === 0) return null;
  if (xs.length === 1) return xs[0];
  const pos = (xs.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const w = pos - lo;
  return xs[lo] * (1 - w) + xs[hi] * w;
}

function median(values: number[]): number | null {
  return quantile(values, 0.5);
}

// ----------------------------------------------------------------------------
// Bucket-level inference constants
// ----------------------------------------------------------------------------

interface BucketConstants {
  maeP75: number | null;            // |MAE| p75 in original-R units (for widen rule)
  mfeMedianWinners: number | null;  // MFE median across winners (for inference)
  mfeMedianLosers: number | null;   // MFE median across losers (typically 0.3–0.6R)
  mfeMedianAll: number | null;
  maeMedianAll: number | null;
}

interface TradeMfeMae {
  mfe: number;   // in original-R units (always ≥ 0)
  mae: number;   // in original-R units, magnitude (always ≥ 0)
  inferred: boolean;
}

function inferMfeMae(
  trade: Trade,
  keys: PairLabFieldKeys,
  bucket: BucketConstants,
): TradeMfeMae {
  const recordedMfe = numericCf(trade as any, keys.mfe);
  const recordedMae = numericCf(trade as any, keys.mae);

  if (recordedMfe != null) {
    return {
      mfe: Math.max(0, recordedMfe),
      mae: recordedMae != null ? Math.abs(recordedMae) : Math.max(0, -(trade.r_multiple_actual ?? 0)),
      inferred: false,
    };
  }

  // No recorded MFE — infer.
  const rActual = trade.r_multiple_actual ?? 0;
  const tpHit = maxTpReached(trade, keys);

  let mfe: number;
  if (tpHit != null) {
    // Trader marked a TP as reached → MFE was at least that. Use max(tpHit, rActual).
    mfe = Math.max(tpHit, rActual);
  } else if (rActual > 0) {
    // Winner closed at +rActual → MFE ≥ rActual. If small profit, MFE may have been higher; we conservatively use rActual.
    mfe = Math.max(rActual, 0.5);
  } else if (rActual <= -0.95) {
    // Full stop-out → use bucket loser median (price never recovered).
    mfe = bucket.mfeMedianLosers ?? 0.3;
  } else {
    // BE or small loss → modest MFE.
    mfe = bucket.mfeMedianLosers ?? bucket.mfeMedianAll ?? 0.3;
  }

  let mae: number;
  if (recordedMae != null) {
    mae = Math.abs(recordedMae);
  } else if (rActual <= -0.95) {
    mae = 1; // full stop
  } else if (rActual < 0) {
    mae = Math.max(Math.abs(rActual), bucket.maeMedianAll ?? 0.3);
  } else {
    mae = bucket.maeMedianAll ?? 0.3;
  }

  return { mfe, mae, inferred: true };
}

// ----------------------------------------------------------------------------
// Single-trade replay
// ----------------------------------------------------------------------------

function applySlRule(
  trade: Trade,
  keys: PairLabFieldKeys,
  rule: SlRule,
  bucket: BucketConstants,
): number {
  // Returns the new SL distance expressed as a multiple of the trade's
  // ORIGINAL R. 1.0 = unchanged. <1 = tighter, >1 = wider.
  if (rule === "original") return 1;
  if (rule === "tighten_to_ideal") {
    const ideal = numericCf(trade as any, keys.idealStopLoss);
    const actual = slPipsFor(trade);
    if (ideal == null || actual == null || actual <= 0) return 1;
    return Math.max(0.2, Math.min(2, ideal / actual));
  }
  if (rule === "widen_to_mae_p75_x_1_15") {
    if (bucket.maeP75 == null) return 1;
    return Math.max(1, bucket.maeP75 * 1.15);
  }
  return 1;
}

interface OneResult {
  r: number;
  inferred: boolean;
}

function replayOneTrade(
  trade: Trade,
  keys: PairLabFieldKeys,
  strategy: Strategy,
  bucket: BucketConstants,
): OneResult {
  if (strategy.useActualOutcome) {
    return { r: trade.r_multiple_actual ?? 0, inferred: false };
  }

  const { mfe: mfeOrig, mae: maeOrig, inferred } = inferMfeMae(trade, keys, bucket);

  const slScale = applySlRule(trade, keys, strategy.slRule, bucket); // new SL / original SL
  if (slScale <= 0) return { r: 0, inferred };

  // Re-express in new-R units.
  const mfeR = mfeOrig / slScale;
  const maeR = maeOrig / slScale;

  if (maeR >= 1) return { r: -1, inferred };

  // Apply partials in ascending order.
  const partials = [...strategy.exitRule.partials].sort((a, b) => a.atR - b.atR);
  let booked = 0;
  let remainingFrac = 1;
  let anyFilled = false;
  let lastFilledAtR = 0;
  for (const p of partials) {
    if (mfeR >= p.atR && remainingFrac > 0) {
      const take = Math.min(p.fraction, remainingFrac);
      booked += p.atR * take;
      remainingFrac -= take;
      anyFilled = true;
      lastFilledAtR = p.atR;
    }
  }

  // Runner portion.
  let runner = 0;
  if (remainingFrac > 0) {
    if (!anyFilled) {
      // Nothing hit, didn't stop — assume BE close.
      runner = 0;
    } else if (strategy.exitRule.runner === "be_after_first_tp") {
      runner = 0;
    } else if (strategy.exitRule.runner === "all_out_at_last_partial") {
      runner = lastFilledAtR;
    } else {
      // trail_to_mfe — capture 80% of MFE.
      runner = mfeR * 0.8;
    }
    booked += runner * remainingFrac;
  }

  return { r: booked, inferred };
}

// ----------------------------------------------------------------------------
// Bucket-level replay
// ----------------------------------------------------------------------------

export interface ReplayOpts {
  balance: number;
  propFirm: PropFirmContext | null;
}

function buildBucketConstants(trades: Trade[], keys: PairLabFieldKeys): BucketConstants {
  const mfes = trades.map((t) => numericCf(t as any, keys.mfe)).filter((v): v is number => v != null);
  const maes = trades.map((t) => numericCf(t as any, keys.mae)).filter((v): v is number => v != null).map((v) => Math.abs(v));

  const winnerMfes: number[] = [];
  const loserMfes: number[] = [];
  for (const t of trades) {
    const m = numericCf(t as any, keys.mfe);
    if (m == null) continue;
    const r = t.r_multiple_actual ?? 0;
    if (r > 0) winnerMfes.push(m);
    else loserMfes.push(m);
  }

  return {
    maeP75: quantile(maes, 0.75),
    mfeMedianWinners: median(winnerMfes),
    mfeMedianLosers: median(loserMfes),
    mfeMedianAll: median(mfes),
    maeMedianAll: median(maes),
  };
}

export function replayBucket(
  trades: Trade[],
  keys: PairLabFieldKeys,
  strategy: Strategy,
  opts: ReplayOpts,
): ReplayResult {
  const closed = trades
    .filter((t) => !t.is_open && !t.is_archived && t.net_pnl != null)
    .sort((a, b) => String(a.entry_time ?? "").localeCompare(String(b.entry_time ?? "")));

  const bucket = buildBucketConstants(closed, keys);

  const dollarRisk = (opts.balance * strategy.riskPct) / 100;
  const perTrade: ReplayPerTrade[] = [];

  let equity = 0;
  let peak = 0;
  let maxDD = 0;
  let streak = 0;
  let worstStreak = 0;
  let wins = 0;
  let losses = 0;
  let totalR = 0;
  let inferredCount = 0;

  const dailyDollars = new Map<string, number>();

  for (const t of closed) {
    const { r, inferred } = replayOneTrade(t, keys, strategy, bucket);
    if (inferred && !strategy.useActualOutcome) inferredCount += 1;
    const dollars = r * dollarRisk;
    equity += dollars;
    totalR += r;
    if (r > 0) { wins += 1; streak = 0; }
    else if (r < 0) { losses += 1; streak += 1; if (streak > worstStreak) worstStreak = streak; }
    else { streak = 0; }
    if (equity > peak) peak = equity;
    const dd = equity - peak;
    if (dd < maxDD) maxDD = dd;

    const day = (t.entry_time ?? "").slice(0, 10) || "unknown";
    dailyDollars.set(day, (dailyDollars.get(day) ?? 0) + dollars);

    perTrade.push({
      tradeId: t.id,
      entryTime: t.entry_time ?? null,
      resultR: r,
      dollars,
      cumulativeEquity: equity,
      inferred,
    });
  }

  const n = closed.length;
  const winRate = n > 0 ? wins / n : 0;
  const expectancyR = n > 0 ? totalR / n : 0;

  // Prop-firm verdict.
  let verdict: ReplayResult["propFirmVerdict"] = "n/a";
  let bustNote: string | null = null;
  if (opts.propFirm && opts.propFirm.dailyLossDollars != null) {
    const dailyCap = opts.propFirm.dailyLossDollars;
    for (const [day, sum] of dailyDollars) {
      if (sum < -dailyCap) {
        verdict = "bust_daily";
        bustNote = `Day ${day} lost $${Math.abs(sum).toFixed(0)} (cap $${dailyCap.toFixed(0)}).`;
        break;
      }
    }
  }
  if (verdict === "n/a" && opts.propFirm && opts.propFirm.maxDrawdownDollars != null) {
    if (Math.abs(maxDD) > opts.propFirm.maxDrawdownDollars) {
      verdict = "bust_total";
      bustNote = `Peak-to-trough DD $${Math.abs(maxDD).toFixed(0)} exceeds total cap $${opts.propFirm.maxDrawdownDollars.toFixed(0)}.`;
    } else {
      verdict = "pass";
    }
  } else if (verdict === "n/a" && opts.propFirm) {
    verdict = "pass";
  }

  const equityCurve = [
    { i: 0, equity: 0, at: null as string | null },
    ...perTrade.map((p, i) => ({ i: i + 1, equity: p.cumulativeEquity, at: p.entryTime })),
  ];

  return {
    strategy,
    n,
    wins,
    losses,
    winRate,
    expectancyR,
    totalR,
    totalDollars: equity,
    maxDrawdownDollars: maxDD,
    maxDrawdownPct: opts.balance > 0 ? (maxDD / opts.balance) * 100 : 0,
    worstLosingStreak: worstStreak,
    equityCurve,
    perTrade,
    propFirmVerdict: verdict,
    bustNote,
    inferredCount,
  };
}
