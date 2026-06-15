// Deno port of src/lib/pairLabSimulator.ts — proof-based strategy replay.

import { PairLabFieldKeys, numericCf, multiSelectCf, parseTpLabel, quantile, bootstrapMeanCi } from "./pairLabMath.ts";
import { tickSizeForSymbol } from "./symbolMapping.ts";

export const TRAIL_CAPTURE_FRAC = 0.8;
export const MIN_ELIGIBLE_SAMPLE = 10;

export type SlRule = "original" | "tighten_to_ideal" | "widen_to_mae_p75_x_1_15";
export type RunnerRule = "trail_to_mfe" | "be_after_first_tp" | "all_out_at_last_partial";

export interface ExitRule {
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
  useActualOutcome?: boolean;
}

export const STRATEGY_PRESETS: Strategy[] = [
  { id: "current", label: "Your current behavior", riskPct: 1, slRule: "original",
    exitRule: { partials: [{ atR: 1, fraction: 1 }], runner: "be_after_first_tp" }, useActualOutcome: true },
  { id: "quick-flip", label: "Quick-flip · 100% @1R", riskPct: 1, slRule: "original",
    exitRule: { partials: [{ atR: 1, fraction: 1 }], runner: "all_out_at_last_partial" } },
  { id: "scale-out", label: "Scale-out · 50% @1R + 50% @2R", riskPct: 1, slRule: "original",
    exitRule: { partials: [{ atR: 1, fraction: 0.5 }, { atR: 2, fraction: 0.5 }], runner: "be_after_first_tp" } },
  { id: "runner", label: "Runner · 33% @1R + 33% @2R + trail", riskPct: 1, slRule: "original",
    exitRule: { partials: [{ atR: 1, fraction: 0.34 }, { atR: 2, fraction: 0.33 }], runner: "trail_to_mfe" } },
  { id: "all-out-2r", label: "All-out @2R", riskPct: 1, slRule: "original",
    exitRule: { partials: [{ atR: 2, fraction: 1 }], runner: "all_out_at_last_partial" } },
  { id: "tighten-2r", label: "Tighten SL → ideal · all-out @2R", riskPct: 1, slRule: "tighten_to_ideal",
    exitRule: { partials: [{ atR: 2, fraction: 1 }], runner: "all_out_at_last_partial" } },
];

function slDistanceTicks(t: any): number | null {
  if (t.sl_initial == null || t.entry_price == null || !t.symbol) return null;
  const tick = tickSizeForSymbol(t.symbol);
  if (!(tick > 0)) return null;
  const distance = Math.abs(t.entry_price - t.sl_initial);
  if (!(distance > 0)) return null;
  return distance / tick;
}
function tradeMaeR(t: any, maeTicks: number | null): number | null {
  if (maeTicks == null) return null;
  const sl = slDistanceTicks(t);
  if (sl == null || sl <= 0) return null;
  return Math.abs(maeTicks) / sl;
}
function idealSlScaleFor(t: any, idealTicks: number | null): number | null {
  if (idealTicks == null) return null;
  const sl = slDistanceTicks(t);
  if (sl == null || sl <= 0) return null;
  return Math.max(0.2, Math.min(2, idealTicks / sl));
}

interface TradeProof {
  reachedR: number;
  hasReachProof: boolean;
  stoppedOut: boolean | null;
  loggedMfe: number | null;
  loggedMae: number | null;
  hasActualR: boolean;
  rActual: number;
  idealSlScale: number | null;
}
function maxTpReached(trade: any, keys: PairLabFieldKeys): number | null {
  const labels = multiSelectCf(trade, keys.tpReached);
  if (labels.length === 0) return null;
  const rs = labels.map(parseTpLabel).filter((v): v is number => v != null && v > 0);
  if (rs.length === 0) return null;
  return Math.max(...rs);
}
function extractProof(trade: any, keys: PairLabFieldKeys): TradeProof {
  const loggedMfeRaw = numericCf(trade, keys.mfe);
  const loggedMfe = loggedMfeRaw != null ? Math.max(0, loggedMfeRaw) : null;
  const loggedMae = tradeMaeR(trade, numericCf(trade, keys.mae));
  const tpHit = maxTpReached(trade, keys);
  const rActual = trade.r_multiple_actual;
  const hasActualR = rActual != null;
  const proofs: number[] = [];
  if (loggedMfe != null) proofs.push(loggedMfe);
  if (tpHit != null) proofs.push(tpHit);
  if (hasActualR && (rActual as number) > 0) proofs.push(rActual as number);
  const reachedR = proofs.length ? Math.max(...proofs) : 0;
  let stoppedOut: boolean | null = null;
  if (loggedMae != null) stoppedOut = loggedMae >= 1;
  else if (hasActualR) {
    const r = rActual as number;
    if (r <= -1.05) stoppedOut = true;
    else if (r >= -0.95) stoppedOut = false;
    else stoppedOut = null;
  }
  const idealSlScale = idealSlScaleFor(trade, numericCf(trade, keys.idealStopLoss));
  return { reachedR, hasReachProof: proofs.length > 0, stoppedOut, loggedMfe, loggedMae, hasActualR, rActual: rActual ?? 0, idealSlScale };
}

type ReplayOutcome = { r: number } | { ineligible: string };
interface BucketConstants { maeP75: number | null }

function buildBucketConstants(trades: any[], keys: PairLabFieldKeys): BucketConstants {
  const maes = trades
    .map((t) => tradeMaeR(t, numericCf(t, keys.mae)))
    .filter((v): v is number => v != null && Number.isFinite(v));
  return { maeP75: quantile(maes, 0.75) };
}

function replayOneTrade(strategy: Strategy, trade: any, proof: TradeProof, bucket: BucketConstants): ReplayOutcome {
  if (strategy.useActualOutcome) {
    return proof.hasActualR ? { r: proof.rActual } : { ineligible: "no recorded r_actual" };
  }
  let slScale: number;
  if (strategy.slRule === "original") slScale = 1;
  else if (strategy.slRule === "tighten_to_ideal") {
    if (proof.idealSlScale == null) return { ineligible: "missing SL/entry or ideal-SL" };
    slScale = proof.idealSlScale;
  } else {
    if (bucket.maeP75 == null) return { ineligible: "no MAE samples for widen rule" };
    slScale = Math.max(1, bucket.maeP75 * 1.15);
  }
  let stoppedUnderNewSl: boolean | null;
  if (proof.loggedMae != null) stoppedUnderNewSl = proof.loggedMae >= slScale;
  else if (slScale <= 1) {
    if (proof.stoppedOut === true) stoppedUnderNewSl = true;
    else if (proof.stoppedOut === false && slScale === 1) stoppedUnderNewSl = false;
    else stoppedUnderNewSl = null;
  } else {
    if (proof.stoppedOut === false) stoppedUnderNewSl = false;
    else stoppedUnderNewSl = null;
  }
  if (stoppedUnderNewSl === null) return { ineligible: "missing MAE/SL — unprovable" };

  const partials = [...strategy.exitRule.partials].sort((a, b) => a.atR - b.atR);
  let booked = 0;
  let remainingFrac = 1;
  let anyFilled = false;
  let lastFilledAtR = 0;
  for (const p of partials) {
    const needOrigR = p.atR * slScale;
    if (proof.reachedR >= needOrigR) {
      const take = Math.min(p.fraction, remainingFrac);
      booked += p.atR * take;
      remainingFrac -= take;
      anyFilled = true;
      lastFilledAtR = p.atR;
    } else if (stoppedUnderNewSl) {
      // no fill
    } else {
      return { ineligible: `unproven ${p.atR}R target` };
    }
  }
  if (remainingFrac > 0) {
    if (stoppedUnderNewSl && !anyFilled) booked += -1 * remainingFrac;
    else if (stoppedUnderNewSl && anyFilled) {
      if (strategy.exitRule.runner === "be_after_first_tp") booked += 0;
      else if (strategy.exitRule.runner === "all_out_at_last_partial") booked += lastFilledAtR * remainingFrac;
      else {
        if (proof.loggedMfe == null) return { ineligible: "no MFE for trail" };
        const mfeNewR = proof.loggedMfe / slScale;
        booked += Math.max(-1, TRAIL_CAPTURE_FRAC * mfeNewR) * remainingFrac;
      }
    } else {
      if (strategy.exitRule.runner === "be_after_first_tp") booked += 0;
      else if (strategy.exitRule.runner === "all_out_at_last_partial") booked += lastFilledAtR * remainingFrac;
      else {
        if (proof.loggedMfe == null) return { ineligible: "no MFE for trail" };
        booked += TRAIL_CAPTURE_FRAC * (proof.loggedMfe / slScale) * remainingFrac;
      }
    }
  }
  return { r: booked };
}

export interface PresetReplayResult {
  presetId: string;
  label: string;
  nEligible: number;
  totalConsidered: number;
  winRate: number;
  expectancyR: number;
  totalR: number;
  expectancyRCi: [number, number] | null;
  meanReachedR: number | null;
  ineligibleReasons: Record<string, number>;
}

export function replayAllPresets(trades: any[], keys: PairLabFieldKeys): PresetReplayResult[] {
  const all = trades.filter((t) => !t.is_open && !t.is_archived && t.net_pnl != null);
  const bucket = buildBucketConstants(all, keys);
  return STRATEGY_PRESETS.map((strategy) => {
    const rs: number[] = [];
    let wins = 0, losses = 0, totalR = 0;
    let reachedSum = 0, reachedCount = 0;
    const reasons: Record<string, number> = {};
    for (const t of all) {
      const proof = extractProof(t, keys);
      const out = replayOneTrade(strategy, t, proof, bucket);
      if ("r" in out) {
        rs.push(out.r);
        totalR += out.r;
        if (out.r > 0) wins += 1;
        else if (out.r < 0) losses += 1;
        if (Number.isFinite(proof.reachedR)) {
          reachedSum += proof.reachedR;
          reachedCount += 1;
        }
      } else {
        reasons[out.ineligible] = (reasons[out.ineligible] ?? 0) + 1;
      }
    }
    const n = rs.length;
    return {
      presetId: strategy.id,
      label: strategy.label,
      nEligible: n,
      totalConsidered: all.length,
      winRate: n > 0 ? wins / n : 0,
      expectancyR: n > 0 ? totalR / n : 0,
      totalR,
      expectancyRCi: bootstrapMeanCi(rs),
      meanReachedR: reachedCount > 0 ? reachedSum / reachedCount : null,
      ineligibleReasons: reasons,
    };
  });
}
