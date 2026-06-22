// Shared helpers for ingest-events and reprocess-trades.
// Keep these two functions in lock-step — both must derive R from the same model.

export function getPipSize(symbol: string): number {
  const n = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (n.includes("JPY")) return 0.01;
  if (n.includes("XAU") || n.includes("GOLD")) return 0.1;
  if (n.includes("XAG") || n.includes("SILVER")) return 0.01;
  if (n.includes("SP500") || n.includes("SPX") || n.includes("US500")) return 0.01;
  if (n.includes("NAS") || n.includes("USTEC") || n.includes("US100")) return 0.01;
  if (n.includes("US30") || n.includes("DJ30") || n.includes("DOW")) return 1.0;
  if (n.includes("DAX") || n.includes("DE40") || n.includes("GER40")) return 0.1;
  if (n.includes("FTSE") || n.includes("UK100")) return 0.1;
  if (n.includes("OIL") || n.includes("BRENT") || n.includes("WTI") ||
      n.includes("USOIL") || n.includes("XTIUSD")) return 0.01;
  if (n.includes("BTC") || n.includes("BITCOIN")) return 1.0;
  if (n.includes("ETH")) return 0.01;
  return 0.0001;
}

/**
 * Approximate USD pip value per lot. Used ONLY as a fallback when the primary
 * gross-PnL-derived $/point path is unavailable — that path is broker-agnostic
 * and exact, so prefer it whenever possible.
 *
 * Returns `null` for symbols whose pip value depends on a live FX rate we
 * don't have at hand (JPY crosses): better to skip R-multiple than to publish
 * a 10–35%-biased number. The caller should treat `null` as "no fallback
 * available" and skip the R computation.
 */
export function getPipValue(
  symbol: string,
  lots: number,
  ctx?: { exitPrice?: number | null },
): number | null {
  const n = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (n.includes("JPY")) {
    // USD/JPY: pip value (USD) per lot = (0.01 / quote) * 100,000 = 1000 / quote.
    // For cross-JPY pairs (EURJPY etc.) we don't have USDJPY here; skip.
    const looksLikeUsdJpy = n.startsWith("USDJPY") || n === "USDJPY" || n.startsWith("USDJPYM") || n.startsWith("USDJPY.");
    const quote = ctx?.exitPrice;
    if (looksLikeUsdJpy && typeof quote === "number" && quote > 0) {
      return (lots * 1000) / quote;
    }
    return null;
  }
  if (n.includes("XAU") || n.includes("GOLD")) return lots * 10;
  if (n.includes("XAG") || n.includes("SILVER")) return lots * 50;
  if (n.includes("SP500") || n.includes("SPX") || n.includes("US500")) return lots * 0.50;
  if (n.includes("NAS") || n.includes("USTEC") || n.includes("US100")) return lots * 0.20;
  if (n.includes("US30") || n.includes("DJ30") || n.includes("DOW")) return lots * 0.10;
  if (n.includes("DAX") || n.includes("DE40") || n.includes("GER40")) return lots * 0.10;
  if (n.includes("OIL") || n.includes("BRENT") || n.includes("WTI") ||
      n.includes("USOIL") || n.includes("XTIUSD")) return lots * 10;
  if (n.includes("BTC") || n.includes("BITCOIN")) return lots * 1.0;
  if (n.includes("ETH")) return lots * 1.0;
  return lots * 10;
}

export interface ComputeROpts {
  entryPrice: number | null;
  exitPrice: number | null;
  slPrice: number | null;
  lots: number | null;
  grossPnl: number | null;
  netPnl: number | null;
  symbol: string;
  equityAtEntry: number | null;
  direction: string | null;
  fills?: Array<{ price?: number; lots?: number } | null> | null;
}

// Derive R-multiple. Prefers deriving $/point from the trade's own realized PnL across
// ALL fills (broker-agnostic, works for indices/metals/crypto and partial closes).
// Falls back to the pip table when grossPnl isn't usable.
//
// Returns `null` when neither path can produce an *honest* R. The equity-based
// fallback (`netPnl / equity * 100`) is deliberately removed because it is a
// percent-return on account, not an R-multiple — storing it in the R field
// poisoned every downstream bucket statistic.
export function computeRMultiple(opts: ComputeROpts): number | null {
  const { entryPrice, exitPrice, slPrice, lots, grossPnl, netPnl, symbol, direction, fills } = opts;
  if (netPnl === null || netPnl === undefined) return null;

  if (slPrice && entryPrice && slPrice !== entryPrice && lots && lots > 0) {
    const stopDistance = Math.abs(entryPrice - slPrice);
    const dirSign = direction === "sell" ? -1 : 1;

    const allFills: Array<{ price: number; lots: number }> = [];
    if (Array.isArray(fills)) {
      for (const f of fills) {
        if (f && typeof f.price === "number" && typeof f.lots === "number" && f.lots > 0) {
          allFills.push({ price: f.price, lots: f.lots });
        }
      }
    }
    if (typeof exitPrice === "number") {
      const usedLots = allFills.reduce((s, f) => s + f.lots, 0);
      const remaining = lots - usedLots;
      if (remaining > 0.0001) allFills.push({ price: exitPrice, lots: remaining });
      else if (allFills.length === 0) allFills.push({ price: exitPrice, lots });
    }

    if (grossPnl && grossPnl !== 0 && allFills.length) {
      let totalPointLots = 0;
      for (const f of allFills) totalPointLots += (f.price - entryPrice) * dirSign * f.lots;
      if (Math.abs(totalPointLots) > 1e-9) {
        const dollarsPerPointPerLot = grossPnl / totalPointLots;
        const risk = stopDistance * lots * Math.abs(dollarsPerPointPerLot);
        if (risk > 0) return Math.round((netPnl / risk) * 100) / 100;
      }
    }

    const pipSize = getPipSize(symbol);
    const pipValue = getPipValue(symbol, lots, { exitPrice });
    if (pipValue == null) return null;
    const risk = (stopDistance / pipSize) * pipValue;
    if (risk > 0) return Math.round((netPnl / risk) * 100) / 100;
  }

  return null;
}
