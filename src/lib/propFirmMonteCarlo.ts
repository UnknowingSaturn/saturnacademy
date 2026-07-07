// ============================================================================
// Prop-firm Monte-Carlo engine — shared by the Strategy Lab (joint risk ×
// rotation sweep) and the Challenge Planner card.
//
// Bootstraps the user's actual per-trade R sample into synthetic paths and
// scores them against prop-firm daily-loss / max-loss / profit-target rules
// under different multi-account rotation models. Uses a stationary block
// bootstrap (Politis–Romano) to preserve short-horizon autocorrelation in
// the R sample.
// ============================================================================

import { wilsonCi, ensureUtcMs } from "../../shared/quant/stats";

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
  /**
   * Max-loss accounting mode.
   *  - `static` (default): bust when account is `maxLossPct` below the *starting* balance.
   *    Matches firms with a fixed daily/overall drawdown line (e.g. The Funded Trader static).
   *  - `trailing`: bust when account is `maxLossPct` below its *peak equity since start*.
   *    Matches FTMO / MyForexFunds / most modern trailing-DD firms.
   */
  maxLossMode?: "static" | "trailing";
}

export interface MCResult {
  paths: number;
  /** Probability that at least one account reaches the target before all accounts bust. */
  passProb: number;
  /** Wilson 95% CI for passProb (Monte-Carlo sampling noise only). */
  passProbCI: [number, number];
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
  /** Probability that AT LEAST ONE account busts within a path (per-path ruin). */
  riskOfRuin: number;
  /** Per-account bust rate across all accounts × paths (legacy metric, kept for compatibility). */
  perAccountBustRate: number;
  /** Distribution of final equity (% of starting balance) — aggregated per-account across all paths. */
  finalEquityDistributionPct: number[];
  /** Mean expected return as % of starting balance, per account, at path end. */
  expectedReturnPct: number;
  /**
   * CVaR-5%: mean of the worst 5% of final equity outcomes (% of starting balance).
   * More informative than mean DD for tail-risk-averse traders.
   */
  cvar5Pct: number;
  /**
   * Per-trade geometric mean growth at the chosen risk fraction, expressed as %.
   * Computed as (Π(1 + f·r))^(1/N) − 1 over the historical R sample. Positive ⇒
   * compounding edge; negative ⇒ Kelly-overshoot (high arithmetic mean still loses).
   */
  geometricMeanGrowthPct: number;
  /** Stationary block bootstrap block size (N^(1/3)). 0 when rSample empty. */
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

  // Stationary block bootstrap (Politis–Romano 1994). Optimal block length
  // for MSE of the stationary distribution scales as N^(1/3); the prior
  // sqrt(N) preserved too much autocorrelation and inflated path variance,
  // producing more simulated busts than reality at the same risk %.
  const blockSize = Math.max(3, Math.round(Math.pow(p.rSample.length || 1, 1 / 3)));
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
      // Advance within the block. When the block walks off the end of rSample,
      // start a fresh block at a uniformly-random index instead of deterministically
      // wrapping to 0 — wrapping to 0 over-samples the head of the series by
      // ~blockSize/N (Politis–Romano stationary bootstrap requires uniform starts).
      if (p.rSample.length > 0) {
        const next = bbIdx + 1;
        bbIdx = next >= p.rSample.length ? Math.floor(rng() * p.rSample.length) : next;
      }
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
        // Audit M-B5: update `peak` BEFORE the trailing-DD check so a
        // freshly-set peak on this same trade is used as the reference,
        // not the pre-trade peak (which would over-generously flag a
        // winning trade as still under water).
        if (equity[i] > peak[i]) peak[i] = equity[i];
        const dd = peak[i] - equity[i];
        if (dd > peakDD[i]) peakDD[i] = dd;

        // Bust checks.
        // Static mode: drawdown is measured from the *starting* balance.
        // Trailing mode: drawdown is measured from the running *peak* equity.
        if (maxLossCap != null) {
          const reference = p.maxLossMode === "trailing" ? peak[i] : p.accountSize;
          if (reference - equity[i] >= maxLossCap) {
            busted[i] = true;
          }
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
      passProbCI: [0, 0],
      failProb: 0,
      inconclusiveProb: 0,
      avgDaysToPass: null,
      avgDrawdownPct: 0,
      accountSurvivalRate: 0,
      riskOfRuin: 0,
      perAccountBustRate: 0,
      finalEquityDistributionPct: [],
      expectedReturnPct: 0,
      cvar5Pct: 0,
      geometricMeanGrowthPct: 0,
      blockSize: 0,
    };
  }
  const blockSize = Math.max(3, Math.round(Math.pow(params.rSample.length, 1 / 3)));

  // Geometric-mean per-trade growth at the chosen risk fraction.
  // Defined as exp(mean(log(1 + f·r))) − 1. If ever 1+f·r ≤ 0 the path is
  // wiped out → growth is −100%.
  let geomGrowthPct = 0;
  {
    const f = params.riskPerTradeFrac;
    let sumLog = 0;
    let count = 0;
    let blown = false;
    for (const r of params.rSample) {
      const factor = 1 + f * r;
      if (factor <= 0) { blown = true; break; }
      sumLog += Math.log(factor);
      count += 1;
    }
    geomGrowthPct = blown ? -100 : (Math.exp(sumLog / Math.max(1, count)) - 1) * 100;
  }

  let passes = 0;
  let fails = 0;
  let pathsWithAnyBust = 0;
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
    let anyBust = false;
    for (const acc of s.perAccount) {
      totalAccounts += 1;
      if (!acc.busted) survivors += 1;
      if (acc.busted) {
        ruinedAccounts += 1;
        anyBust = true;
      }
      ddSum += acc.peakDrawdown / params.accountSize;
      ddCount += 1;
      const pct = (acc.finalEquity / params.accountSize - 1) * 100;
      finalEqPct.push(pct);
      returnSumPct += pct;
    }
    if (anyBust) pathsWithAnyBust += 1;
  }

  const passProb = passes / paths;
  const failProb = fails / paths;
  const passProbCI = wilsonCi(passes, paths) ?? [0, 0];

  // CVaR-5%: mean of worst 5% final equity outcomes (per-account, all paths).
  let cvar5Pct = 0;
  if (finalEqPct.length > 0) {
    const sorted = finalEqPct.slice().sort((a, b) => a - b);
    const cutoff = Math.max(1, Math.floor(sorted.length * 0.05));
    let s = 0;
    for (let i = 0; i < cutoff; i += 1) s += sorted[i];
    cvar5Pct = s / cutoff;
  }

  return {
    paths,
    passProb,
    passProbCI,
    failProb,
    inconclusiveProb: 1 - passProb - failProb,
    avgDaysToPass: passes > 0 ? daysToPassSum / passes : null,
    avgDrawdownPct: ddCount > 0 ? (ddSum / ddCount) * 100 : 0,
    accountSurvivalRate: totalAccounts > 0 ? survivors / totalAccounts : 0,
    // Per-path RoR = probability that AT LEAST ONE account busts during a path.
    riskOfRuin: pathsWithAnyBust / paths,
    perAccountBustRate: totalAccounts > 0 ? ruinedAccounts / totalAccounts : 0,
    finalEquityDistributionPct: finalEqPct,
    expectedReturnPct: totalAccounts > 0 ? returnSumPct / totalAccounts : 0,
    cvar5Pct,
    geometricMeanGrowthPct: geomGrowthPct,
    blockSize,
  };
}

// S4.9: previously a duplicate local Wilson CI lived here. The shared helper
// in `shared/quant/stats.ts` (`wilsonCi`) uses an identical z=1.96 formula
// and is the single source of truth — eliminates drift risk if the CI level
// is ever made configurable. Returns null when trials<=0; callers default
// to [0,0] at the call site.

// ----------------------------------------------------------------------------
// Helpers used by UI surfaces
// ----------------------------------------------------------------------------

/**
 * Pull all numeric r_multiple_actual values from closed trades, sorted by
 * entry_time ascending. Sort is required for the stationary block bootstrap
 * to preserve any short-horizon autocorrelation; an unordered sample makes
 * the block-length logic meaningless (degenerates to plain bootstrap).
 */
export function extractRSample(
  trades: Array<{
    r_multiple_actual: number | null;
    is_open?: boolean | null;
    is_archived?: boolean | null;
    entry_time?: string | Date | null;
  }>,
): number[] {
  return trades
    .filter(
      (t) =>
        !t.is_open &&
        !t.is_archived &&
        t.r_multiple_actual != null &&
        Number.isFinite(t.r_multiple_actual),
    )
    .slice()
    .sort((a, b) => {
      // S4.2: `+new Date(naiveString)` is locale-dependent — the block
      // bootstrap relies on stable temporal ordering, otherwise the block
      // length is meaningless and pass/RoR probs diverge by host TZ.
      const at = a.entry_time ? ensureUtcMs(a.entry_time as string | Date) : 0;
      const bt = b.entry_time ? ensureUtcMs(b.entry_time as string | Date) : 0;
      return at - bt;
    })
    .map((t) => t.r_multiple_actual as number);
}

/**
 * Stationary block-bootstrap 95% CI for the mean of an R-sample. Uses the
 * same block-size rule as the path simulator so the edge-direction gate and
 * the path engine speak the same statistical language.
 *
 * Returns [lower, upper, mean]. If n < 2 returns [mean, mean, mean].
 */
export function meanRWithCI(
  rSample: number[],
  opts: { resamples?: number; seed?: number } = {},
): { mean: number; ciLow: number; ciHigh: number; n: number } {
  const n = rSample.length;
  if (n === 0) return { mean: 0, ciLow: 0, ciHigh: 0, n: 0 };
  const mean = rSample.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { mean, ciLow: mean, ciHigh: mean, n };

  const resamples = Math.max(200, opts.resamples ?? 1000);
  const rng = mulberry32(opts.seed ?? 0x9E3779B9);
  const blockSize = Math.max(3, Math.round(Math.pow(n, 1 / 3)));
  const blockReset = 1 / blockSize;

  const means: number[] = new Array(resamples);
  for (let b = 0; b < resamples; b += 1) {
    let idx = Math.floor(rng() * n);
    let sum = 0;
    for (let k = 0; k < n; k += 1) {
      if (rng() < blockReset) idx = Math.floor(rng() * n);
      sum += rSample[idx];
      const next = idx + 1;
      idx = next >= n ? Math.floor(rng() * n) : next;
    }
    means[b] = sum / n;
  }
  means.sort((a, b) => a - b);
  const lo = means[Math.floor(0.025 * resamples)];
  const hi = means[Math.min(resamples - 1, Math.floor(0.975 * resamples))];
  return { mean, ciLow: lo, ciHigh: hi, n };
}

export const ROTATION_LABELS: Record<RotationModel, string> = {
  one_only: "Trade one account only",
  simultaneous: "Trade all accounts simultaneously (mirror)",
  stay_on_winner: "Stay on winner, switch on loss",
  round_robin: "Round-robin rotation",
};
