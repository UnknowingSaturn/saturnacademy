import type { Trade, PartialClose } from "@/types/trading";

export interface CloseFill {
  time: string;
  lots: number;
  price: number;
  pnl: number;
  isFinal: boolean;
}

// A "real" partial close has lots > 0. The repair marker pushed by ingest
// (`{ type: 'repaired_from_snapshot', ... }`) does NOT have lots and must be skipped.
export function getRealPartialCloses(trade: Pick<Trade, "partial_closes">): PartialClose[] {
  const list = trade.partial_closes || [];
  return list.filter((p): p is PartialClose => {
    return p && typeof (p as PartialClose).lots === "number" && (p as PartialClose).lots > 0;
  });
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
    const partialPnl = partials.reduce((s, f) => s + (f.pnl || 0), 0);
    // Final-fill lots are unknowable from the Trade type alone (original_lots lives in DB only).
    // Use 1 as a placeholder weight if zero — weighted-avg uses lots so we approximate via remaining PnL.
    const finalPnl = (trade.gross_pnl ?? 0) - partialPnl;
    partials.push({
      time: trade.exit_time,
      lots: Math.max(0.0001, (trade as { original_lots?: number }).original_lots
        ? ((trade as { original_lots?: number }).original_lots! - partials.reduce((s, f) => s + f.lots, 0))
        : 1),
      price: trade.exit_price,
      pnl: finalPnl,
      isFinal: true,
    });
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
