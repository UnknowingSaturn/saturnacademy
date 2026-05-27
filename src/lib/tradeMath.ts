import type { Trade, PartialClose } from "@/types/trading";

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
      pnl: (Number(f.profit) || 0) - (Number(f.commission) || 0) - Math.abs(Number(f.swap) || 0),
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
    // so original_lots is the correct total. If original_lots is unknown (legacy rows),
    // assume the final fill carried whatever lots remained beyond partials, defaulting to
    // the partial total (so a single-fill trade still gets a sensible weight of 1×lots).
    const finalLots = trade.original_lots != null
      ? Math.max(0, trade.original_lots - partialLots)
      : Math.max(partialLots, 0.01);

    if (finalLots > 0) {
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

export function hasMultipleCloses(trade: Trade): boolean {
  return getAllCloseFills(trade).length > 1;
}
