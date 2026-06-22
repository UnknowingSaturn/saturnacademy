/**
 * Centralized P&L formula used across ingest-events, repair-snapshot-closed,
 * and any future trade-rebuild path.
 *
 * MT5 reports swap as already-signed (negative = funding cost, positive =
 * carry credit). Adding it preserves carry credits as gains; subtracting
 * the absolute value (the old behavior) silently turned positive-carry
 * holds into losses on every trade — wrong for any positive-carry pair.
 *
 * Commission is always signed (typically negative on MT5), so we still
 * subtract its absolute value to match the "cost" intent regardless of
 * broker sign convention.
 */
export function computeNetPnl(
  gross: number,
  commission: number = 0,
  swap: number = 0,
): number {
  return gross - Math.abs(commission) + swap;
}
