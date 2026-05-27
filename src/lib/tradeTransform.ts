import { Trade, TradeReview, PartialClose, ActionableStep } from "@/types/trading";

// Helper to normalize embedded trade_reviews (could be object or array from Supabase)
export function normalizeReviews(raw: any): any[] {
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));

export function transformReview(row: any): TradeReview {
  return {
    ...row,
    checklist_answers: (row.checklist_answers as Record<string, boolean>) || {},
    mistakes: (row.mistakes as string[]) || [],
    did_well: (row.did_well as string[]) || [],
    to_improve: (row.to_improve as string[]) || [],
    actionable_steps: (row.actionable_steps as ActionableStep[]) || [],
    screenshots: (row.screenshots as string[]) || [],
  };
}

/**
 * Canonical trade row → Trade transform.
 * Spreads the raw row through (so all columns are preserved) and coerces
 * numerics + normalizes embedded relations. Used by both useTrades and
 * useOpenTrades — keep this the single source of truth.
 */
export function transformTrade(row: any): Trade {
  const reviews = normalizeReviews(row.trade_reviews);
  const sortedReviews = [...reviews].sort(
    (a: any, b: any) =>
      new Date(b.updated_at || b.created_at).getTime() -
      new Date(a.updated_at || a.created_at).getTime()
  );
  const latestReview = sortedReviews[0];

  const rawPartials = (row.partial_closes as PartialClose[]) || [];

  return {
    ...row,
    total_lots: num(row.total_lots) ?? 0,
    original_lots: num(row.original_lots),
    entry_price: num(row.entry_price) ?? 0,
    exit_price: num(row.exit_price),
    sl_initial: num(row.sl_initial),
    tp_initial: num(row.tp_initial),
    sl_final: num(row.sl_final),
    tp_final: num(row.tp_final),
    gross_pnl: num(row.gross_pnl),
    net_pnl: num(row.net_pnl),
    commission: num(row.commission) ?? 0,
    swap: num(row.swap) ?? 0,
    r_multiple_planned: num(row.r_multiple_planned),
    r_multiple_actual: num(row.r_multiple_actual),
    balance_at_entry: num(row.balance_at_entry),
    equity_at_entry: num(row.equity_at_entry),
    risk_percent: num(row.risk_percent),
    trade_type: row.trade_type || "executed",
    is_open: row.is_open ?? true,
    partial_closes: Array.isArray(rawPartials) ? rawPartials : [],
    review: latestReview ? transformReview(latestReview) : undefined,
    playbook: row.playbook || undefined,
    ai_review: row.ai_reviews?.[0] || undefined,
    account: row.accounts || row.account || undefined,
  };
}
