import type { Trade, PartialClose } from "@/types/trading";
import { computeNetPnl } from "../../shared/quant/pnl";
import { ensureUtcMs } from "./pairLabMath";

export interface CloseFill {
  time: string;
  lots: number;
  price: number;
  pnl: number;
  isFinal: boolean;
}

// A "real" partial close has a positive `lots` field. The repair marker pushed by
// ingest (`{ type: 'repaired_from_snapshot', ... }`) lacks lots and must be skipped
// by every consumer that iterates `partial_closes`. Use this guard everywhere.
export function isRealFill(p: unknown): p is PartialClose {
  return !!p && typeof (p as PartialClose).lots === "number" && (p as PartialClose).lots > 0;
}

export function getRealPartialCloses(trade: Pick<Trade, "partial_closes" | "partial_fills">): PartialClose[] {
  // Prefer typed fills (Phase 2 cutover). Fall back to legacy JSONB partial_closes.
  const fills = (trade as any).partial_fills as Array<{ occurred_at: string; lots: number; price: number; profit: number | null; commission: number | null; swap: number | null }> | undefined;
  if (fills && fills.length > 0) {
    return fills.map((f) => ({
      time: f.occurred_at,
      lots: Number(f.lots),
      price: Number(f.price),
      // Centralized signed-addition formula — single source of truth.
      // See shared/quant/pnl.ts for the sign-convention rationale. MT5 reports
      // commission/swap already-signed; brokers that report commission as a
      // positive cost must negate at the ingest layer.
      pnl: computeNetPnl(Number(f.profit) || 0, Number(f.commission) || 0, Number(f.swap) || 0),
    }));
  }
  return (trade.partial_closes || []).filter(isRealFill);
}

export function getAllCloseFills(trade: Trade): CloseFill[] {
  const partials = getRealPartialCloses(trade).map<CloseFill>((p) => ({
    time: p.time,
    lots: p.lots,
    price: p.price,
    pnl: p.pnl || 0,
    isFinal: false,
  }));

  if (!trade.is_open && trade.exit_price != null && trade.exit_time) {
    const partialLots = partials.reduce((s, f) => s + f.lots, 0);
    // Final fill lots = original_lots - sum(partials). On closed trades total_lots is 0,
    // so original_lots is the correct total.
    //
    // Legacy rows (original_lots null):
    //  - No partials → single-fill trade. Use lots=1 as a sentinel so VWAP collapses
    //    to exit_price (the only fill). VWAP is ratio-based, so the absolute weight is
    //    immaterial; the full gross_pnl is preserved on this fill.
    //  - With partials → the final fill lots are genuinely unknown. Don't synthesize a
    //    spurious fill (it would double-count partial volume in the VWAP); the consumer
    //    will get a partials-only VWAP, which is the most honest answer available.
    let finalLots: number | null = null;
    if (trade.original_lots != null) {
      finalLots = Math.max(0, trade.original_lots - partialLots);
    } else if (partialLots === 0) {
      finalLots = 1;
    }

    if (finalLots != null && finalLots > 0) {
      const partialPnl = partials.reduce((s, f) => s + (f.pnl || 0), 0);
      partials.push({
        time: trade.exit_time,
        lots: finalLots,
        price: trade.exit_price,
        pnl: (trade.gross_pnl ?? 0) - partialPnl,
        isFinal: true,
      });
    }
  }

  return partials.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

export function getWeightedAvgExitPrice(trade: Trade): number | null {
  const fills = getAllCloseFills(trade);
  const totalLots = fills.reduce((s, f) => s + f.lots, 0);
  if (totalLots <= 0) return null;
  const weighted = fills.reduce((s, f) => s + f.lots * f.price, 0);
  return weighted / totalLots;
}

/**
 * Volume-weighted average entry price.
 *
 * NOTE: As of 2026-06 the schema stores only the final entry price on the
 * trade row — `trade_partial_fills` tracks partial CLOSES (DEAL_ENTRY_OUT),
 * not scaled-entry fills (DEAL_ENTRY_IN). The broker's `entry_price` IS the
 * volume-weighted entry for the lots actually opened. This helper is the
 * single API consumers should call; if scaled-entry tracking lands later,
 * compute the VWAP here without touching every call site.
 */
export function getWeightedAvgEntryPrice(trade: Trade): number | null {
  if (trade.entry_price == null || !Number.isFinite(trade.entry_price)) return null;
  return trade.entry_price;
}

/**
 * Resolve the stop-loss distance that was in force at the moment of maximum
 * adverse excursion.
 *
 * The cf_mae custom field is just a number — no `mae_logged_at` timestamp —
 * so we can't pinpoint the SL state at the exact drawdown bar. The
 * conservative proxy: use `sl_final` (the SL the broker reports at close)
 * because a 50-pip-risk trade moved to BE before a 15-pip drawdown should
 * NOT count as 0.30 R-at-risk — the user was risking ≈ 0 at that point.
 *
 * Fallback cascade:
 *   1. trade_modifications: most recent SL change with occurred_at ≤ exit_time
 *   2. trade.sl_final
 *   3. trade.sl_initial
 *
 * Returns the absolute SL distance from entry in price units, or null if
 * indeterminate or BE'd (distance ≤ 0) — caller should treat null as "drop
 * this trade from the MAE-R distribution".
 */
export function resolveSlAtMae(trade: Trade): number | null {
  if (trade.entry_price == null) return null;
  let effectiveSl: number | null = null;
  const mods = trade.trade_modifications;
  if (Array.isArray(mods) && mods.length > 0 && trade.exit_time) {
    const exitMs = Date.parse(trade.exit_time);
    const slMods = mods
      .filter((m) => m && m.field === "sl" && m.new_value != null && Date.parse(m.occurred_at) <= exitMs)
      .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
    if (slMods.length > 0 && slMods[0].new_value != null) {
      effectiveSl = Number(slMods[0].new_value);
    }
  }
  if (effectiveSl == null) effectiveSl = trade.sl_final ?? trade.sl_initial ?? null;
  if (effectiveSl == null) return null;
  const dist = Math.abs(trade.entry_price - effectiveSl);
  return dist > 0 ? dist : null;
}

export function hasMultipleCloses(trade: Trade): boolean {
  return getAllCloseFills(trade).length > 1;
}
