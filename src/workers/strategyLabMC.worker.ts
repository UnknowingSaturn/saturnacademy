// ============================================================================
// Strategy Lab Monte-Carlo worker.
//
// The 24-cell sweep (4 rotation models × 6 risk tiers × 1,200 paths) blocks
// the main thread for 200-500ms on cold runs. Pushing it into a worker keeps
// the UI responsive while inputs are tweaked.
//
// Communication: parent posts `{ id, params: StrategyLabSweepRequest }`,
// worker posts back `{ id, cells: StrategyLabSweepCell[] }`. The latest `id`
// wins — older replies are dropped client-side.
// ============================================================================

import {
  runMonteCarlo,
  type MCParams,
  type MCResult,
  type RotationModel,
} from "@/lib/propFirmMonteCarlo";

export interface StrategyLabSweepRequest {
  rSample: number[];
  riskTiers: number[];
  rotationModels: RotationModel[];
  numAccounts: number;
  accountSize: number;
  dailyLossPct: number;
  maxLossPct: number;
  targetPct: number;
  tradesPerDay: number;
  windowDays: number;
  trailingDD: boolean;
  paths: number;
}

export interface StrategyLabSweepCell {
  key: string;
  risk: number;
  model: RotationModel;
  result: MCResult;
}

function cellSeed(model: RotationModel, risk: number, models: RotationModel[]): number {
  const modelIdx = models.indexOf(model);
  return ((modelIdx + 1) * 100003) ^ Math.round(risk * 1000) ^ 0x5f3759df;
}

self.onmessage = (e: MessageEvent<{ id: number; params: StrategyLabSweepRequest }>) => {
  const { id, params } = e.data;
  try {
    const out: StrategyLabSweepCell[] = [];
    for (const model of params.rotationModels) {
      for (const risk of params.riskTiers) {
        const mc: MCParams = {
          rSample: params.rSample,
          riskPerTradeFrac: risk / 100,
          numAccounts: params.numAccounts,
          accountSize: params.accountSize,
          dailyLossPct: params.dailyLossPct,
          maxLossPct: params.maxLossPct,
          targetPct: params.targetPct / 100,
          tradesPerDay: params.tradesPerDay,
          maxDays: params.windowDays,
          rotationModel: model,
          maxLossMode: params.trailingDD ? "trailing" : "static",
          paths: params.paths,
          seed: cellSeed(model, risk, params.rotationModels),
        };
        out.push({ key: `${model}|${risk}`, risk, model, result: runMonteCarlo(mc) });
      }
    }
    (self as unknown as Worker).postMessage({ id, cells: out });
  } catch (err) {
    // Q11: surface the failure to the parent instead of leaving the UI hung
    // on "simulating…" forever when one cell throws (typically NaN R inputs).
    (self as unknown as Worker).postMessage({
      id,
      cells: [],
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
