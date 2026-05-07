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
    const partialLots = partials.reduce((s, f) => s + f.lots, 0);
    const finalLots = Math.max(0, (trade.original_lots ?? trade.total_lots ?? 0) - partialLots);
    if (finalLots > 0.0001 || partials.length === 0) {
      partials.push({
        time: trade.exit_time,
        lots: finalLots > 0.0001 ? finalLots : (trade.original_lots ?? 0),
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
