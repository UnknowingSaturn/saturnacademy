// Deno port of src/lib/pairLabSimulator.ts — proof-based strategy replay.
//
// Intentional divergence from src/lib/pairLabSimulator.ts:
//   - server uses duck-typed `any` trade rows (raw DB shape)
//   - replay output exposes `nComparable` + `biasWarning` +
//     `expectancyROnIntersection` for the report pipeline's bias-aware deltas.

import { PairLabFieldKeys, numericCf, quantile, bootstrapMeanCi } from "./pairLabMath.ts";
import { pipSizeForSymbol, ticksToPips } from "./symbolMapping.ts";
import { MAE_P75_WIDEN_BUFFER, TRAIL_CAPTURE_FALLBACK } from "../../../../shared/quant/config.ts";
import { pathProbTpFirst, resolveTpFirstProb, type ReplayMode } from "../../../../shared/quant/stats.ts";


/** Fallback when too few trades to estimate empirical trail capture.
 *  S2.11: shared with the client simulator via `TRAIL_CAPTURE_FALLBACK`. */
export const DEFAULT_TRAIL_CAPTURE_FRAC = TRAIL_CAPTURE_FALLBACK;
export const MIN_ELIGIBLE_SAMPLE = 10;

export type SlRule = "original" | "tighten_to_ideal" | "widen_to_mae_p75_x_1_15";
export type RunnerRule = "trail_to_mfe" | "be_after_first_tp" | "all_out_at_last_partial";
export type AtRSource = "fixed" | "bucket_mfe_p50" | "bucket_mfe_p60" | "bucket_mfe_p75";

export interface PartialRule {
  atR: number;
  fraction: number;
  atRSource?: AtRSource;
}
export interface ExitRule {
  partials: PartialRule[];
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
    exitRule: { partials: [{ atR: 1, fraction: 0.33 }, { atR: 2, fraction: 0.33 }], runner: "trail_to_mfe" } },
  { id: "all-out-2r", label: "All-out @2R", riskPct: 1, slRule: "original",
    exitRule: { partials: [{ atR: 2, fraction: 1 }], runner: "all_out_at_last_partial" } },
  { id: "all-out-3r", label: "All-out @3R", riskPct: 1, slRule: "original",
    exitRule: { partials: [{ atR: 3, fraction: 1 }], runner: "all_out_at_last_partial" } },
  { id: "pure-trail", label: "Pure trail · no partials", riskPct: 1, slRule: "original",
    exitRule: { partials: [], runner: "trail_to_mfe" } },
  { id: "tighten-scale", label: "Tighten SL → ideal · scale-out 50%@1R + 50%@2R", riskPct: 1, slRule: "tighten_to_ideal",
    exitRule: { partials: [{ atR: 1, fraction: 0.5 }, { atR: 2, fraction: 0.5 }], runner: "be_after_first_tp" } },
  { id: "tighten-runner", label: "Tighten SL → ideal · runner 33%@1R + 33%@2R + trail", riskPct: 1, slRule: "tighten_to_ideal",
    exitRule: { partials: [{ atR: 1, fraction: 0.33 }, { atR: 2, fraction: 0.33 }], runner: "trail_to_mfe" } },
  { id: "tighten-2r", label: "Tighten SL → ideal · all-out @2R", riskPct: 1, slRule: "tighten_to_ideal",
    exitRule: { partials: [{ atR: 2, fraction: 1 }], runner: "all_out_at_last_partial" } },
  { id: "widen-2r", label: "Widen SL → MAE-p75 × 1.15 · all-out @2R", riskPct: 1, slRule: "widen_to_mae_p75_x_1_15",
    exitRule: { partials: [{ atR: 2, fraction: 1 }], runner: "all_out_at_last_partial" } },
  { id: "adaptive-mfe-p60", label: "Adaptive TP @ MFE p60 of bucket", riskPct: 1, slRule: "original",
    exitRule: { partials: [{ atR: 1, fraction: 1, atRSource: "bucket_mfe_p60" }], runner: "all_out_at_last_partial" } },
];

function slDistancePips(t: any): number | null {
  if (t.sl_initial == null || t.entry_price == null || !t.symbol) return null;
  const pip = pipSizeForSymbol(t.symbol);
  if (!(pip > 0)) return null;
  const distance = Math.abs(t.entry_price - t.sl_initial);
  if (!(distance > 0)) return null;
  return distance / pip;
}
function tradeMaeR(t: any, maeTicks: number | null): number | null {
  if (maeTicks == null || !t.symbol) return null;
  const slPips = slDistancePips(t);
  if (slPips == null || slPips <= 0) return null;
  const maePips = ticksToPips(t.symbol, Math.abs(maeTicks));
  return maePips / slPips;
}
function idealSlScaleFor(t: any, idealTicks: number | null): number | null {
  if (idealTicks == null || !t.symbol) return null;
  const slPips = slDistancePips(t);
  if (slPips == null || slPips <= 0) return null;
  const idealPips = ticksToPips(t.symbol, idealTicks);
  return Math.max(0.1, Math.min(2, idealPips / slPips));
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
function extractProof(trade: any, keys: PairLabFieldKeys): TradeProof {
  const loggedMfeRaw = numericCf(trade, keys.mfe);
  const loggedMfe = loggedMfeRaw != null ? Math.max(0, loggedMfeRaw) : null;
  const loggedMae = tradeMaeR(trade, numericCf(trade, keys.mae));
  const rActual = trade.r_multiple_actual;
  const hasActualR = rActual != null;
  const proofs: number[] = [];
  if (loggedMfe != null) proofs.push(loggedMfe);
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

type ReplayOutcome = { r: number; slProxy: boolean } | { ineligible: string };
interface BucketConstants {
  maeP75: number | null;
  mfeP50: number | null;
  mfeP60: number | null;
  mfeP75: number | null;
  /** Empirical trail-capture ratio (median r/mfe over winners with mfe-r ≥ 0.1). */
  trailCapture: number;
  /** PR-4 · Fix 7 — MFE sample count for adaptive-TP guard (min 20). */
  nMfe: number;
}

/** PR-4 · Fix 7 — minimum bucket sample count for adaptive-TP presets. */
const MIN_BUCKET_N_ADAPTIVE = 20;

function buildBucketConstants(trades: any[], keys: PairLabFieldKeys): BucketConstants {
  const maes = trades
    .map((t) => tradeMaeR(t, numericCf(t, keys.mae)))
    .filter((v): v is number => v != null && Number.isFinite(v));
  const mfes = trades
    .map((t) => {
      const v = numericCf(t, keys.mfe);
      return v != null ? Math.max(0, v) : null;
    })
    .filter((v): v is number => v != null && Number.isFinite(v));

  // Empirical trail-capture estimate: median of r/mfe over winners whose MFE
  // gave the trail enough room (mfe − r ≥ 0.1) and ratio is in (0, 1.05).
  // Falls back to DEFAULT_TRAIL_CAPTURE_FRAC for thin samples. Mirrors the
  // client-side estimate so server and client agree on trail-runner expectancy.
  const ratios: number[] = [];
  for (const t of trades) {
    if (t.is_open || t.is_archived) continue;
    const mfe = numericCf(t, keys.mfe);
    const r = t.r_multiple_actual;
    if (mfe == null || r == null) continue;
    if (!(mfe > 0) || !(r > 0)) continue;
    if (mfe - r < 0.1) continue;
    const ratio = r / mfe;
    if (ratio > 0 && ratio < 1.05) ratios.push(ratio);
  }
  let trailCapture = DEFAULT_TRAIL_CAPTURE_FRAC;
  if (ratios.length >= 10) {
    const m = quantile(ratios, 0.5);
    if (m != null && m > 0) trailCapture = Math.max(0.1, Math.min(0.95, m));
  }

  return {
    maeP75: quantile(maes, 0.75),
    mfeP50: quantile(mfes, 0.5),
    mfeP60: quantile(mfes, 0.6),
    mfeP75: quantile(mfes, 0.75),
    trailCapture,
    nMfe: mfes.length,
  };
}


function resolvePartialAtR(p: { atR: number; atRSource?: AtRSource }, bucket: BucketConstants): number | null {
  switch (p.atRSource ?? "fixed") {
    case "bucket_mfe_p50": return bucket.mfeP50 != null && bucket.mfeP50 > 0 ? bucket.mfeP50 : null;
    case "bucket_mfe_p60": return bucket.mfeP60 != null && bucket.mfeP60 > 0 ? bucket.mfeP60 : null;
    case "bucket_mfe_p75": return bucket.mfeP75 != null && bucket.mfeP75 > 0 ? bucket.mfeP75 : null;
    default: return p.atR;
  }
}

function replayOneTrade(
  strategy: Strategy,
  trade: any,
  proof: TradeProof,
  bucket: BucketConstants,
  replayMode: ReplayMode = "expected",
): ReplayOutcome {
  if (strategy.useActualOutcome) {
    return proof.hasActualR ? { r: proof.rActual } : { ineligible: "no recorded r_actual" };
  }
  // Pure-trail (no partials, trail_to_mfe) is allowed; BE-after-TP without a partial is not.
  if (strategy.exitRule.runner === "be_after_first_tp" && strategy.exitRule.partials.length === 0) {
    return { ineligible: "BE-after-TP runner needs ≥1 partial" };
  }
  let slScale: number;
  if (strategy.slRule === "original") slScale = 1;
  else if (strategy.slRule === "tighten_to_ideal") {
    if (proof.idealSlScale == null) return { ineligible: "missing SL/entry or ideal-SL" };
    slScale = proof.idealSlScale;
  } else {
    if (bucket.maeP75 == null) return { ineligible: "no MAE samples for widen rule" };
    slScale = Math.max(1, bucket.maeP75 * MAE_P75_WIDEN_BUFFER);
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

  const resolved: Array<{ atR: number; fraction: number }> = [];
  for (const p of strategy.exitRule.partials) {
    const atR = resolvePartialAtR(p, bucket);
    if (atR == null) return { ineligible: `bucket has no MFE samples for adaptive TP (${p.atRSource})` };
    resolved.push({ atR, fraction: p.fraction });
  }
  resolved.sort((a, b) => a.atR - b.atR);

  let booked = 0;
  let remainingFrac = 1;
  let anyFilled = false;
  let lastFilledAtR = 0;
  /** First partial whose TP was breached by MFE. Drives the bridge probability
   *  when the stop was ALSO breached — that's the ambiguous ordering case. */
  let firstBreachedTpR: number | null = null;
  for (const p of resolved) {
    const needOrigR = p.atR * slScale;
    if (proof.reachedR >= needOrigR) {
      const take = Math.min(p.fraction, remainingFrac);
      booked += p.atR * take;
      remainingFrac -= take;
      anyFilled = true;
      lastFilledAtR = p.atR;
      if (firstBreachedTpR == null) firstBreachedTpR = p.atR;
    }
    // P0-A parity: do NOT drop the trade here. Fall into the runner block
    // below so the honest outcome is booked from proven-reached R. Previously
    // an early `ineligible: "unproven target"` return caused survivorship
    // bias on multi-TP presets — only trades that hit every rung survived,
    // inflating WR and expectancy in the server-generated AI quant note.
  }

  const maxTargetAtR = resolved.length ? resolved[resolved.length - 1].atR : 0;

  if (remainingFrac > 0) {
    if (stoppedUnderNewSl && !anyFilled) {
      booked += -1 * remainingFrac;
    } else if (stoppedUnderNewSl && anyFilled) {
      if (strategy.exitRule.runner === "be_after_first_tp") {
        booked += 0;
      } else if (strategy.exitRule.runner === "all_out_at_last_partial") {
        // S4.6 parity: when a partial filled and price then stopped under the
        // new SL, the runner exited at the stop — not at the previous TP.
        booked += -slScale * remainingFrac;
      } else {
        if (proof.loggedMfe == null) return { ineligible: "no MFE for trail runner" };
        const mfeNewR = proof.loggedMfe / slScale;
        booked += Math.max(-1, bucket.trailCapture * mfeNewR) * remainingFrac;
      }
    } else {
      // Not stopped under the new SL.
      const reachedNewR = proof.reachedR / slScale;
      if (strategy.exitRule.runner === "be_after_first_tp") {
        booked += 0;
      } else if (strategy.exitRule.runner === "all_out_at_last_partial") {
        if (anyFilled) {
          booked += lastFilledAtR * remainingFrac;
        } else {
          booked += Math.min(reachedNewR, maxTargetAtR) * remainingFrac;
        }
      } else {
        if (proof.loggedMfe == null) return { ineligible: "no MFE for trail runner" };
        const mfeNewR = proof.loggedMfe / slScale;
        booked += bucket.trailCapture * mfeNewR * remainingFrac;
      }
    }
  }

  // P0-B — PR-1 Brownian-bridge / gambler's-ruin ordering mixture.
  // Ambiguity only exists when at least one partial's TP was breached AND the
  // trade also breached the new SL. Deterministic branches pass through
  // unchanged (pStopFirst = 0). Mirrors client `src/lib/pairLabSimulator.ts`.
  if (stoppedUnderNewSl && firstBreachedTpR != null && proof.loggedMae != null) {
    const mfeForBridge = proof.loggedMfe ?? proof.reachedR;
    const mfeInNewR = mfeForBridge / slScale;
    const maeInNewR = proof.loggedMae / slScale;
    const pTpFirstRaw = pathProbTpFirst(firstBreachedTpR, 1, mfeInNewR, maeInNewR);
    const pTpFirst = resolveTpFirstProb(pTpFirstRaw, replayMode);
    const pStopFirst = 1 - pTpFirst;
    if (pStopFirst > 0) {
      const bookedSlFirst = -slScale;
      booked = pTpFirst * booked + pStopFirst * bookedSlFirst;
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
  /** Number of trades eligible under BOTH this preset and the `current` baseline. */
  nComparable: number;
  /** Apples-to-apples expectancy on the intersection of eligible trades vs `current`. */
  expectancyROnIntersection: number | null;
  /** Per-trade expectancy of `current` on that same intersection. */
  currentExpectancyROnIntersection: number | null;
  /** True when the eligible sample is < 70% of the total trades — `delta_vs_current` is biased. */
  biasWarning: boolean;
}

export function replayAllPresets(
  trades: any[],
  keys: PairLabFieldKeys,
  opts: { replayMode?: ReplayMode } = {},
): PresetReplayResult[] {
  const all = trades.filter((t) => !t.is_open && !t.is_archived && t.net_pnl != null);
  const bucket = buildBucketConstants(all, keys);
  const replayMode: ReplayMode = opts.replayMode ?? "expected";

  // First pass: replay each preset, store per-trade outcomes keyed by trade id.
  const perPreset = STRATEGY_PRESETS.map((strategy) => {
    const outcomes = new Map<string, number>();
    const reasons: Record<string, number> = {};
    let reachedSum = 0, reachedCount = 0;
    for (const t of all) {
      const proof = extractProof(t, keys);
      const out = replayOneTrade(strategy, t, proof, bucket, replayMode);
      if ("r" in out) {
        outcomes.set(t.id, out.r);
        if (Number.isFinite(proof.reachedR)) {
          reachedSum += proof.reachedR;
          reachedCount += 1;
        }
      } else {
        reasons[out.ineligible] = (reasons[out.ineligible] ?? 0) + 1;
      }
    }
    return { strategy, outcomes, reasons, reachedSum, reachedCount };
  });

  const currentRow = perPreset.find((p) => p.strategy.id === "current");
  const currentOutcomes = currentRow?.outcomes ?? new Map<string, number>();

  return perPreset.map(({ strategy, outcomes, reasons, reachedSum, reachedCount }) => {
    const rs = Array.from(outcomes.values());
    const n = rs.length;
    const totalR = rs.reduce((s, v) => s + v, 0);
    const wins = rs.filter((r) => r > 0).length;

    // Intersection vs current preset
    let intersectionN = 0, intersectionSumPreset = 0, intersectionSumCurrent = 0;
    if (strategy.id !== "current") {
      for (const [id, r] of outcomes.entries()) {
        const cur = currentOutcomes.get(id);
        if (cur != null) {
          intersectionN += 1;
          intersectionSumPreset += r;
          intersectionSumCurrent += cur;
        }
      }
    } else {
      intersectionN = n;
      intersectionSumPreset = totalR;
      intersectionSumCurrent = totalR;
    }

    const biasWarning = strategy.id !== "current"
      && all.length > 0
      && n < all.length * 0.7;

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
      nComparable: intersectionN,
      expectancyROnIntersection: intersectionN > 0 ? intersectionSumPreset / intersectionN : null,
      currentExpectancyROnIntersection: intersectionN > 0 ? intersectionSumCurrent / intersectionN : null,
      biasWarning,
    };
  });
}
