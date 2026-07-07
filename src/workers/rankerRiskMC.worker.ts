// ============================================================================
// Ranker risk Monte-Carlo worker.
//
// For each strategy, sweep a risk-% grid and Monte-Carlo the trader's R-sample
// with compounding on. Return, per rung, median terminal equity, peak-drawdown
// %, and the growth-optimal rung subject to the user's DD comfort setting.
//
// This is what powers the "Suggested risk" + "Verdict" columns in the Ranker.
// Ranking order itself is unaffected — it's computed synchronously by the
// walk-forward replay pipeline.
//
// Communication: parent posts `{ id, params }`, worker posts back
// `{ id, results: Record<strategyId, StrategyRiskResult> }`. The latest `id`
// wins — older replies are dropped client-side.
// ============================================================================

import { runMonteCarlo, type MCParams } from "@/lib/propFirmMonteCarlo";

export interface StrategyRiskInput {
  strategyId: string;
  /** Per-trade R sample (already walk-forward-replayed). Length = eligibleCount. */
  rSample: number[];
  /** Trader's current risk % (baseline column). */
  currentRiskPct: number;
}

export interface RankerRiskMCRequest {
  strategies: StrategyRiskInput[];
  /** Risk-% grid to test, e.g. [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3]. */
  grid: number[];
  /** Starting account balance in $. */
  accountSize: number;
  /** Max acceptable peak drawdown as a %, e.g. 10 for 10%. */
  comfortDdPct: number;
  /** Internal ruin probability ceiling (default 5%). */
  ruinProbCap: number;
  /** MC paths per rung. Default 2000. */
  paths: number;
  /** Optional prop-firm caps that override the user's comfort setting. */
  propFirm?: {
    dailyLossPct: number | null;
    maxLossPct: number | null;
  } | null;
}

export interface RiskRungResult {
  riskPct: number;
  /** Median terminal equity as a % of starting balance (+ = growth). */
  medianTerminalPct: number;
  /** Mean peak-to-trough drawdown %. */
  meanPeakDdPct: number;
  /** Path-level ruin probability. */
  ruinProb: number;
  /** True when this rung violates the user's DD or the internal ruin cap. */
  violatesComfort: boolean;
}

export interface StrategyRiskResult {
  strategyId: string;
  grid: RiskRungResult[];
  /** Best rung under the comfort constraint, or null if none feasible. */
  suggested: {
    riskPct: number;
    medianTerminalPct: number;
    meanPeakDdPct: number;
  } | null;
  /** DD/ruin status at the user's current risk %. */
  atCurrent: {
    riskPct: number;
    medianTerminalPct: number;
    meanPeakDdPct: number;
    ruinProb: number;
    exceedsComfort: boolean;
  } | null;
}

export interface RankerRiskMCResponse {
  id: number;
  results: Record<string, StrategyRiskResult>;
  error?: string;
}

// Deterministic per-(strategyId, risk) seed so a re-render doesn't shuffle
// the suggestion under the user's feet.
function seedFor(strategyId: string, riskPct: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < strategyId.length; i += 1) {
    h ^= strategyId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h ^ Math.round(riskPct * 1000)) >>> 0;
}

function medianOf(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = nums.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function simRung(
  rSample: number[],
  riskPct: number,
  accountSize: number,
  paths: number,
  seed: number,
  propFirm: RankerRiskMCRequest["propFirm"],
  horizon: number,
): RiskRungResult {
  const params: MCParams = {
    rSample,
    riskPerTradeFrac: riskPct / 100,
    numAccounts: 1,
    accountSize,
    dailyLossPct: propFirm?.dailyLossPct ?? null,
    maxLossPct: propFirm?.maxLossPct ?? null,
    targetPct: null,
    // horizon = eligibleCount trades, spread over ~1 trade/day is fine — bust
    // uses total drawdown, not calendar. Cap at 1 trade/day so `maxDays` = N.
    tradesPerDay: 1,
    maxDays: Math.max(1, horizon),
    rotationModel: "one_only",
    maxLossMode: "trailing",
    paths,
    seed,
  };
  const mc = runMonteCarlo(params);
  const medianTerminalPct = medianOf(mc.finalEquityDistributionPct);
  return {
    riskPct,
    medianTerminalPct,
    meanPeakDdPct: mc.avgDrawdownPct,
    ruinProb: mc.riskOfRuin,
    // Fill in after we know comfortDdPct at the caller.
    violatesComfort: false,
  };
}

self.onmessage = (e: MessageEvent<{ id: number; params: RankerRiskMCRequest }>) => {
  const { id, params } = e.data;
  try {
    const {
      strategies,
      grid,
      accountSize,
      comfortDdPct,
      ruinProbCap,
      paths,
      propFirm,
    } = params;
    const results: Record<string, StrategyRiskResult> = {};

    for (const s of strategies) {
      const horizon = s.rSample.length;
      if (horizon < 2) {
        results[s.strategyId] = {
          strategyId: s.strategyId,
          grid: [],
          suggested: null,
          atCurrent: null,
        };
        continue;
      }
      const rungs: RiskRungResult[] = [];
      for (const risk of grid) {
        const rung = simRung(
          s.rSample,
          risk,
          accountSize,
          paths,
          seedFor(s.strategyId, risk),
          propFirm,
          horizon,
        );
        rung.violatesComfort =
          rung.meanPeakDdPct > comfortDdPct || rung.ruinProb > ruinProbCap;
        rungs.push(rung);
      }

      // Best feasible rung by median terminal equity.
      const feasible = rungs.filter((r) => !r.violatesComfort);
      const best = feasible.reduce<RiskRungResult | null>(
        (acc, r) => (acc == null || r.medianTerminalPct > acc.medianTerminalPct ? r : acc),
        null,
      );

      // Metrics at the trader's current risk (nearest grid rung, so this
      // reuses one simulated rung — cheap).
      const nearest = rungs.reduce((acc, r) =>
        Math.abs(r.riskPct - s.currentRiskPct) < Math.abs(acc.riskPct - s.currentRiskPct)
          ? r
          : acc,
      );

      results[s.strategyId] = {
        strategyId: s.strategyId,
        grid: rungs,
        suggested: best
          ? {
              riskPct: best.riskPct,
              medianTerminalPct: best.medianTerminalPct,
              meanPeakDdPct: best.meanPeakDdPct,
            }
          : null,
        atCurrent: {
          riskPct: nearest.riskPct,
          medianTerminalPct: nearest.medianTerminalPct,
          meanPeakDdPct: nearest.meanPeakDdPct,
          ruinProb: nearest.ruinProb,
          exceedsComfort: nearest.violatesComfort,
        },
      };
    }

    const response: RankerRiskMCResponse = { id, results };
    (self as unknown as Worker).postMessage(response);
  } catch (err) {
    const response: RankerRiskMCResponse = {
      id,
      results: {},
      error: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(response);
  }
};
