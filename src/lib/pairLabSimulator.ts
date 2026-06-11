// ============================================================================
// Pair Lab — Strategy Simulator (counterfactual replay)
//
// Replays each historical trade under a hypothetical { risk%, SL rule, exit
// rule } and produces deterministic P&L, win-rate, DD and prop-firm verdict.
// Pure functions — no randomness, no network.
//
// Honest caveats (surfaced in UI):
//   * Assumes MFE / MAE are reachable as fills (standard journal-replay
//     assumption; slightly optimistic for partial scale-outs).
//   * If a trade neither hits SL nor any partial TP we assume BE close.
//   * Trail-to-MFE captures 80% of MFE on the runner (slippage allowance).
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
}

// ----------------------------------------------------------------------------
// Field readers (kept tiny to avoid pulling pairLabMath into client bundle)
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

function slPipsFor(t: Trade): number | null {
  if (t.sl_initial == null || t.entry_price == null) return null;
  const distance = Math.abs(t.entry_price - t.sl_initial);
  const digits = String(t.entry_price).split(".")[1]?.length ?? 4;
  const pipMultiplier = digits >= 4 ? 10_000 : 100;
  return distance * pipMultiplier;
}

// ----------------------------------------------------------------------------
// Single-trade replay
// ----------------------------------------------------------------------------

interface BucketConstants {
  maeP75: number | null; // in trade's original-R units
}

function applySlRule(
  trade: Trade,
  keys: PairLabFieldKeys,
  rule: SlRule,
  bucket: BucketConstants,
): number {
  // Returns the new SL distance expressed as a multiple of the trade's
  // ORIGINAL R. 1.0 = unchanged. <1 = tighter (smaller stop, MFE/MAE in
  // new-R units gets larger). >1 = wider.
  if (rule === "original") return 1;
  if (rule === "tighten_to_ideal") {
    const ideal = numericCf(trade as any, keys.idealStopLoss);
    const actual = slPipsFor(trade);
    if (ideal == null || actual == null || actual <= 0) return 1;
    return Math.max(0.2, Math.min(2, ideal / actual));
  }
  if (rule === "widen_to_mae_p75_x_1_15") {
    if (bucket.maeP75 == null) return 1;
    // bucket.maeP75 is already in original-R units.
    return Math.max(1, bucket.maeP75 * 1.15);
  }
  return 1;
}

function replayOneTrade(
  trade: Trade,
  keys: PairLabFieldKeys,
  strategy: Strategy,
  bucket: BucketConstants,
): number {
  // Returns trade result in R-multiples (of the strategy's risked amount).
  if (strategy.useActualOutcome) {
    return trade.r_multiple_actual ?? 0;
  }

  const mfeOrig = numericCf(trade as any, keys.mfe);
  const maeOrig = numericCf(trade as any, keys.mae);
  if (mfeOrig == null) return trade.r_multiple_actual ?? 0; // can't replay without MFE

  const slScale = applySlRule(trade, keys, strategy.slRule, bucket); // new SL / original SL
  if (slScale <= 0) return 0;

  // Re-express in new-R units. New 1R = original slScale R.
  const mfeR = mfeOrig / slScale;
  const maeR = maeOrig != null ? Math.abs(maeOrig) / slScale : 0;

  // Stop check first — if MAE exceeded new SL, trade is -1R regardless of MFE.
  if (maeR >= 1) return -1;

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
      // trail_to_mfe — capture 80% of MFE (slippage allowance).
      runner = mfeR * 0.8;
    }
    booked += runner * remainingFrac;
  }

  return booked;
}

// ----------------------------------------------------------------------------
// Bucket-level replay
// ----------------------------------------------------------------------------

export interface ReplayOpts {
  /** Account balance in $ at start of replay. */
  balance: number;
  /** Optional prop-firm caps for pass/fail verdict. */
  propFirm: PropFirmContext | null;
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

export function replayBucket(
  trades: Trade[],
  keys: PairLabFieldKeys,
  strategy: Strategy,
  opts: ReplayOpts,
): ReplayResult {
  const closed = trades
    .filter((t) => !t.is_open && !t.is_archived && t.net_pnl != null)
    .sort((a, b) => String(a.entry_time ?? "").localeCompare(String(b.entry_time ?? "")));

  // Bucket constants for slRule (MAE p75 in original-R units).
  const maes = closed
    .map((t) => numericCf(t as any, keys.mae))
    .filter((v): v is number => v != null)
    .map((v) => Math.abs(v));
  const bucket: BucketConstants = { maeP75: quantile(maes, 0.75) };

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

  // Daily totals for prop-firm daily-loss check.
  const dailyDollars = new Map<string, number>();

  for (const t of closed) {
    const r = replayOneTrade(t, keys, strategy, bucket);
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
  };
}
