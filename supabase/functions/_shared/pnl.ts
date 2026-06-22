/**
 * Centralized P&L formula used across ingest-events, repair-snapshot-closed,
 * and any future trade-rebuild path.
 *
 * MT5 reports both swap and commission as already-signed (negative = cost,
 * positive = credit). Simple signed addition is the textbook formula:
 *     net = gross + commission + swap
 * The previous `gross - Math.abs(commission) + swap` form double-subtracted
 * commission for any broker that reports it positive-signed.
 *
 * If a future broker integration reports commission as a positive cost, the
 * ingest pipeline should negate it at the source (single point of truth) so
 * everything downstream of this helper stays sign-correct.
 */
export function computeNetPnl(
  gross: number,
  commission: number = 0,
  swap: number = 0,
): number {
  return gross + commission + swap;
}

