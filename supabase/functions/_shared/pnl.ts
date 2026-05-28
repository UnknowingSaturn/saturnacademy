/**
 * Centralized P&L formula used across ingest-events, repair-snapshot-closed,
 * and any future trade-rebuild path. Swap is subtracted as an absolute value
 * because MT5 reports it as a signed credit/debit and the convention in this
 * codebase is "net = gross minus the cost of holding" regardless of sign.
 */
export function computeNetPnl(
  gross: number,
  commission: number = 0,
  swap: number = 0,
): number {
  return gross - commission - Math.abs(swap);
}
