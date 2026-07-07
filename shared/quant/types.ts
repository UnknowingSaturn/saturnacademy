// Shared quant types used by both the React client and edge functions.
// Kept dependency-free so it can run unchanged in Deno.

/**
 * Unified prop-firm context. Fields that are only meaningful for one surface
 * (UI or server) are optional. Both `firm` (id) and `firmName` (label) are
 * accepted; consumers should prefer `firm` for logic and `firmName` for UI.
 */
export interface PropFirmContext {
  /** Account balance in money — used to translate DD limits to R. */
  balance: number;
  /** Daily loss limit as $ (already converted from % if needed). */
  dailyLossDollars: number | null;
  /** Max drawdown limit as $. */
  maxDrawdownDollars: number | null;
  /** Profit target as $. Server-side challenge planner only. */
  profitTargetDollars?: number | null;
  /** Hard cap on suggested risk %, e.g. account.risk_per_trade_cap or 2. */
  hardCapPct: number;
  /** User's planned risk per trade as a fraction (e.g. 0.01 for 1%). UI sizing path. */
  riskPerTradeFrac?: number;
  /** Stable firm identifier (e.g. "ftmo"). Preferred for logic/branching. */
  firm?: string;
  /** Human-readable firm label. Preferred for display. */
  firmName?: string | null;
}

/**
 * Per-symbol robust breakdown of the applied SL under a preset. Shared shape
 * — client (`src/lib/pairLabSimulator.ts` :: `AppliedSlSymbolStat`) and the
 * edge twin (`supabase/functions/_shared/quant/pairLabSimulator.ts` ::
 * `PresetReplayResult["appliedSlBySymbol"]` row) both extend from this so a
 * future field rename on one side breaks the other at compile time.
 *
 * Native unit fields (`medianNative`, `iqrNative`) are in the symbol's own
 * unit (pips for FX/metals/crypto/oil, points for indices) — never mix
 * across symbols. `medianScale` is dimensionless (applied / original SL).
 */
export interface SharedAppliedSlSymbolStat {
  symbol: string;
  unit: "pips" | "points";
  n: number;
  medianNative: number;
  iqrNative: [number, number];
  medianScale: number;
}
