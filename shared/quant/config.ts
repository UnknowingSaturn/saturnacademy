// ============================================================================
// Shared quant configuration — single source of truth for tunable constants
// used by Pair Lab math, the strategy replay simulator, and prop-firm risk
// guards. Imported by both the React app (via Vite) and Supabase edge
// functions (via Deno).
//
// PATH CONVENTIONS:
//   - Vite/client (TS):   import { TP1_STAR_MIN_HIT_RATE } from "../../shared/quant/config";
//   - Deno/edge:          import { TP1_STAR_MIN_HIT_RATE } from "../../../shared/quant/config.ts";
//
// This file MUST stay dependency-free (no imports, no types/trading)
// so the same source can be consumed by Vite and Deno without aliasing.
//
// EDITING RULES:
//   - Change a value here, NOT inline at the call site.
//   - Document the rationale in the JSDoc — these constants drive
//     user-facing recommendations and silently changing them can flip
//     strategy rankings.
// ============================================================================

// ---------- TP1* recommendation ----------

/**
 * Minimum hit-rate (fraction 0-1) a TP candidate must achieve before it can
 * be considered the "TP1*" sweet-spot in `computeTp1Star`. Prevents the grid
 * from recommending high-R targets that are almost never reached.
 *
 * NOTE: A genuinely-edged low-hit-rate setup (e.g. 35% @ 3R) will be filtered
 * out by this gate. If you raise/lower it, expect rec churn for low-frequency
 * strategies. Sweep range historically considered: 0.20 – 0.50.
 */
export const TP1_STAR_MIN_HIT_RATE = 0.4;

// ---------- SL recommendation (Sweeney rule) ----------

/**
 * Quantile of winning-trade MAE used as the base for the suggested SL.
 * p90 keeps ~90% of historical winners safe from being stopped out.
 */
export const WINNERS_MAE_SL_QUANTILE = 0.90;

/**
 * Multiplicative noise buffer applied on top of the winners-MAE quantile.
 * 1.10 = +10% headroom for tick noise / slippage on the SL.
 */
export const WINNERS_MAE_SL_BUFFER = 1.10;

/**
 * Fallback SL widen factor applied to bucket MAE p75 when there is no
 * winners-MAE statistic available (e.g. all-loss bucket, sparse winners).
 */
export const MAE_P75_WIDEN_BUFFER = 1.15;

/**
 * SL-drift "aligned" band: the ratio of slInitialMedian / idealSlMedian must
 * fall inside [MIN, MAX] to count as aligned. Outside the band the bucket is
 * tagged "too_wide" or "too_tight".
 */
export const SL_DRIFT_ALIGNED_MIN = 0.80;
export const SL_DRIFT_ALIGNED_MAX = 1.20;

// ---------- Kelly sizing ----------

/**
 * Scale applied to raw full-Kelly fraction. 0.25 = quarter-Kelly, the
 * industry-standard variance-reduction for noisy edges.
 */
export const KELLY_SCALE = 0.25;

/**
 * Risk-percent floor: raw quarter-Kelly outputs below this are flagged
 * "edge too thin to size" and the UI suppresses a numeric suggestion.
 */
export const KELLY_FLOOR_PCT = 0.25;

/**
 * Risk-percent ceiling: regardless of edge, never suggest more than this
 * (defense against fat-tail estimation error and prop-firm hard caps).
 */
export const KELLY_CEILING_PCT = 1.5;

// ---------- Bootstrap / statistical tests ----------

/**
 * Iteration count used by every bootstrap routine (mean CI, positive p-value,
 * Kelly CI). 500 balances tightness of the CI against runtime in the browser.
 */
export const BOOTSTRAP_ITERATIONS = 500;

/**
 * Benjamini–Hochberg FDR alpha used to control false-discovery across the
 * bucket grid's per-bucket expectancy p-values.
 */
export const BH_FDR_ALPHA = 0.05;

// ---------- Prop-firm streak guard ----------

/**
 * Minimum streak length used as a floor on the prop-firm worst-streak cap.
 * Prevents tiny samples from suggesting a 1- or 2-loss streak guard.
 */
export const MIN_STREAK_FLOOR = 3;

// ---------- SL sweep grid ----------

/**
 * Quantiles of the per-trade MAE distribution scanned by the SL sweep.
 * Coarse on purpose — finer grids overfit noise inside a single bucket.
 */
export const SL_SWEEP_QUANTILES: ReadonlyArray<number> = [0.25, 0.40, 0.55, 0.70, 0.90];
