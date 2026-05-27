import { Trade, TradeReview, PartialClose, PartialFill, RepairEvent, ActionableStep } from "@/types/trading";

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

  // Phase 2 cutover: prefer typed `trade_partial_fills` join. Synthesize the
  // PartialClose[] shape so existing consumers (tradeMath, UI) keep working
  // without changes. Falls back to legacy JSONB during transition.
  const partialFillsRaw = (row.trade_partial_fills as any[]) || [];
  const partialFills: PartialFill[] = partialFillsRaw.map((f) => ({
    id: f.id,
    trade_id: f.trade_id,
    ticket: f.ticket != null ? Number(f.ticket) : null,
    deal_id: f.deal_id != null ? Number(f.deal_id) : null,
    lots: Number(f.lots),
    price: Number(f.price),
    profit: f.profit != null ? Number(f.profit) : null,
    commission: f.commission != null ? Number(f.commission) : null,
    swap: f.swap != null ? Number(f.swap) : null,
    occurred_at: f.occurred_at,
    created_at: f.created_at,
  }));

  const synthesizedPartials: PartialClose[] = partialFills.map((f) => ({
    time: f.occurred_at,
    lots: f.lots,
    price: f.price,
    pnl: (f.profit ?? 0) - (f.commission ?? 0) - Math.abs(f.swap ?? 0),
  }));

  // Keep any legacy *repair markers* (objects without a `lots` field) so the
  // snapshot-closed UI keeps detecting them until the JSONB column is dropped.
  const legacyMarkers = Array.isArray(rawPartials)
    ? rawPartials.filter((p: any) => p && typeof p === "object" && !("lots" in p))
    : [];

  const partialClosesMerged = partialFills.length > 0
    ? [...synthesizedPartials, ...legacyMarkers]
    : (Array.isArray(rawPartials) ? rawPartials : []);

  const repairEventsRaw = (row.trade_repair_events as any[]) || [];
  const repairEvents: RepairEvent[] = repairEventsRaw.map((e) => ({
    id: e.id,
    trade_id: e.trade_id,
    action: e.action,
    source: e.source ?? null,
    metadata: (e.metadata as Record<string, unknown>) || {},
    applied_at: e.applied_at,
  }));

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
    partial_closes: partialClosesMerged,
    partial_fills: partialFills,
    repair_events: repairEvents,
    review: latestReview ? transformReview(latestReview) : undefined,
    playbook: row.playbook || undefined,
    ai_review: row.ai_reviews?.[0] || undefined,
    account: row.accounts || row.account || undefined,
  };
}
