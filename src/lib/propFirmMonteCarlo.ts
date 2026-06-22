// ============================================================================
// Prop-firm Monte-Carlo engine — shared by Risk Optimization, Rotation
// Simulator, and Challenge Planner.
//
// Bootstraps the user's actual per-trade R sample into synthetic paths and
// scores them against prop-firm daily-loss / max-loss / profit-target rules
// under different multi-account rotation models.
// ============================================================================

export type RotationModel =
  | "one_only"
  | "simultaneous"
  | "stay_on_winner"
  | "round_robin";

export interface MCParams {
  /** Historical r_multiple_actual sample to bootstrap from. */
  rSample: number[];
  /** Risk per trade as a fraction of account starting size, e.g. 0.01 = 1%. */
  riskPerTradeFrac: number;
  /** Number of parallel accounts. ≥1. */
  numAccounts: number;
  /** Starting balance per account, in $. */
  accountSize: number;
  /** Daily loss limit as a fraction of starting balance, e.g. 0.05 = 5%. Null = no limit. */
  dailyLossPct: number | null;
  /** Max total loss (peak-to-trough or trailing) as fraction, e.g. 0.10 = 10%. Null = no limit. */
  maxLossPct: number | null;
  /** Profit target as fraction of starting balance, e.g. 0.08 = 8%. Null = no target (returns no pass prob). */
  targetPct: number | null;
  /** Trades per day. */
  tradesPerDay: number;
  /** Maximum days before path is cut off as "no decision". */
  maxDays: number;
  rotationModel: RotationModel;
  /** Number of MC paths. Default 2000. */
  paths?: number;
  /** Optional deterministic seed for reproducibility. */
  seed?: number;
}

export interface MCResult {
  paths: number;
  /** Probability that at least one account reaches the target before all accounts bust. */
  passProb: number;
  /** Probability that every account busts before any hits the target (within maxDays). */
  failProb: number;
  /** Probability that maxDays elapsed with neither pass nor full fail. */
  inconclusiveProb: number;
  /** Mean days-to-pass across passing paths. Null if none passed. */
  avgDaysToPass: number | null;
  /** Mean of (peak-to-trough drawdown / accountSize) across all accounts × paths. */
  avgDrawdownPct: number;
  /** Mean fraction of accounts surviving at path end (not busted). */
  accountSurvivalRate: number;
  /** Probability any single account hits maxLoss (risk of ruin per account). */
  riskOfRuin: number;
  /** Distribution of final equity (% of starting balance) — aggregated per-account across all paths. */
  finalEquityDistributionPct: number[];
  /** Mean expected return as % of starting balance, per account, at path end. */
  expectedReturnPct: number;
  /** Stationary block bootstrap block size (sqrt(N)). 0 when rSample empty. */
  blockSize: number;
}

// ----------------------------------------------------------------------------
// Seedable RNG (mulberry32) — deterministic when seed is provided.
// ----------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// ----------------------------------------------------------------------------
// Single-path simulator
// ----------------------------------------------------------------------------

interface PathState {
  passed: boolean;
  failed: boolean;
  daysElapsed: number;
  perAccount: Array<{ finalEquity: number; peakDrawdown: number; busted: boolean }>;
}

function simulateOnePath(p: MCParams, rng: () => number): PathState {
  const numAccounts = Math.max(1, p.numAccounts);
  const dollarRisk = p.accountSize * p.riskPerTradeFrac;
  const dailyCap = p.dailyLossPct != null ? p.accountSize * p.dailyLossPct : null;
  const maxLossCap = p.maxLossPct != null ? p.accountSize * p.maxLossPct : null;
  const target = p.targetPct != null ? p.accountSize * (1 + p.targetPct) : null;

  const equity = new Array(numAccounts).fill(p.accountSize);
  const peak = new Array(numAccounts).fill(p.accountSize);
  const peakDD = new Array(numAccounts).fill(0);
  const busted = new Array(numAccounts).fill(false);
  let cursor = 0; // for round-robin / stay-on-winner

  // Stationary block bootstrap (Politis–Romano). Block size = sqrt(N), and at
  // each step we reset the block with probability 1/blockSize — this preserves
  // serial correlation (loss clusters stay clustered) without locking block
  // boundaries the way a fixed-block bootstrap would.
  const blockSize = Math.max(3, Math.round(Math.sqrt(p.rSample.length || 1)));
  const blockReset = 1 / blockSize;
  let bbIdx = p.rSample.length > 0 ? Math.floor(rng() * p.rSample.length) : 0;

  for (let day = 1; day <= p.maxDays; day += 1) {
    const dayPnL = new Array(numAccounts).fill(0);
    for (let tradeIdx = 0; tradeIdx < p.tradesPerDay; tradeIdx += 1) {
      // Sample one R from the historical pool via stationary block bootstrap.
      if (rng() < blockReset && p.rSample.length > 0) {
        bbIdx = Math.floor(rng() * p.rSample.length);
      }
      const r = p.rSample[bbIdx] ?? 0;
      bbIdx = (bbIdx + 1) % Math.max(1, p.rSample.length);
      const pnl = r * dollarRisk;

      // Decide which accounts receive this trade.
      const targets: number[] = [];
      if (p.rotationModel === "simultaneous") {
        for (let i = 0; i < numAccounts; i += 1) if (!busted[i]) targets.push(i);
      } else if (p.rotationModel === "one_only") {
        if (!busted[0]) targets.push(0);
      } else {
        // round_robin or stay_on_winner — find next live account starting at cursor.
        let probes = 0;
        while (probes < numAccounts && busted[cursor]) {
          cursor = (cursor + 1) % numAccounts;
          probes += 1;
        }
        if (!busted[cursor]) targets.push(cursor);
      }

      for (const i of targets) {
        equity[i] += pnl;
        dayPnL[i] += pnl;
        if (equity[i] > peak[i]) peak[i] = equity[i];
        const dd = peak[i] - equity[i];
        if (dd > peakDD[i]) peakDD[i] = dd;

        // Bust checks.
        if (maxLossCap != null && p.accountSize - equity[i] >= maxLossCap) {
          busted[i] = true;
        }
        if (dailyCap != null && -dayPnL[i] >= dailyCap) {
          busted[i] = true;
        }

        if (target != null && equity[i] >= target) {
          return {
            passed: true,
            failed: false,
            daysElapsed: day,
            perAccount: equity.map((e, idx) => ({
              finalEquity: e,
              peakDrawdown: peakDD[idx],
              busted: busted[idx],
            })),
          };
        }
      }

      // Rotation cursor update after each trade.
      if (p.rotationModel === "round_robin" && targets.length > 0) {
        cursor = (cursor + 1) % numAccounts;
      } else if (p.rotationModel === "stay_on_winner" && targets.length > 0) {
        if (r < 0) cursor = (cursor + 1) % numAccounts; // switch on loss
        // stay on winner otherwise
      }
    }

    // After-the-day check: if every account is busted → failure.
    if (busted.every(Boolean)) {
      return {
        passed: false,
        failed: true,
        daysElapsed: day,
        perAccount: equity.map((e, idx) => ({
          finalEquity: e,
          peakDrawdown: peakDD[idx],
          busted: true,
        })),
      };
    }
  }

  // Time-out.
  return {
    passed: false,
    failed: busted.every(Boolean),
    daysElapsed: p.maxDays,
    perAccount: equity.map((e, idx) => ({
      finalEquity: e,
      peakDrawdown: peakDD[idx],
      busted: busted[idx],
    })),
  };
}

// ----------------------------------------------------------------------------
// Public entry — aggregate N paths.
// ----------------------------------------------------------------------------

export function runMonteCarlo(params: MCParams): MCResult {
  const paths = Math.max(50, params.paths ?? 2000);
  const rng = mulberry32(params.seed ?? Math.floor(Math.random() * 2 ** 31));

  if (params.rSample.length === 0) {
    return {
      paths: 0,
      passProb: 0,
      failProb: 0,
      inconclusiveProb: 0,
      avgDaysToPass: null,
      avgDrawdownPct: 0,
      accountSurvivalRate: 0,
      riskOfRuin: 0,
      finalEquityDistributionPct: [],
      expectedReturnPct: 0,
      blockSize: 0,
    };
  }
  const blockSize = Math.max(3, Math.round(Math.sqrt(params.rSample.length)));

  let passes = 0;
  let fails = 0;
  let daysToPassSum = 0;
  let ddSum = 0;
  let ddCount = 0;
  let survivors = 0;
  let totalAccounts = 0;
  let ruinedAccounts = 0;
  let returnSumPct = 0;
  const finalEqPct: number[] = [];

  for (let i = 0; i < paths; i += 1) {
    const s = simulateOnePath(params, rng);
    if (s.passed) {
      passes += 1;
      daysToPassSum += s.daysElapsed;
    } else if (s.failed) {
      fails += 1;
    }
    for (const acc of s.perAccount) {
      totalAccounts += 1;
      if (!acc.busted) survivors += 1;
      if (acc.busted) ruinedAccounts += 1;
      ddSum += acc.peakDrawdown / params.accountSize;
      ddCount += 1;
      const pct = (acc.finalEquity / params.accountSize - 1) * 100;
      finalEqPct.push(pct);
      returnSumPct += pct;
    }
  }

  const passProb = passes / paths;
  const failProb = fails / paths;
  return {
    paths,
    passProb,
    failProb,
    inconclusiveProb: 1 - passProb - failProb,
    avgDaysToPass: passes > 0 ? daysToPassSum / passes : null,
    avgDrawdownPct: ddCount > 0 ? (ddSum / ddCount) * 100 : 0,
    accountSurvivalRate: totalAccounts > 0 ? survivors / totalAccounts : 0,
    riskOfRuin: totalAccounts > 0 ? ruinedAccounts / totalAccounts : 0,
    finalEquityDistributionPct: finalEqPct,
    expectedReturnPct: totalAccounts > 0 ? returnSumPct / totalAccounts : 0,
  };
}

// ----------------------------------------------------------------------------
// Helpers used by UI surfaces
// ----------------------------------------------------------------------------

/** Pull all numeric r_multiple_actual values from closed trades. */
export function extractRSample(trades: Array<{ r_multiple_actual: number | null; is_open?: boolean | null; is_archived?: boolean | null }>): number[] {
  return trades
    .filter((t) => !t.is_open && !t.is_archived && t.r_multiple_actual != null && Number.isFinite(t.r_multiple_actual))
    .map((t) => t.r_multiple_actual as number);
}

export const ROTATION_LABELS: Record<RotationModel, string> = {
  one_only: "Trade one account only",
  simultaneous: "Trade all accounts simultaneously",
  stay_on_winner: "Stay on winner, switch on loss",
  round_robin: "Round-robin rotation",
};
