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
