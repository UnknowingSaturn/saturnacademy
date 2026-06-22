// Shared R-multiple helper for ingest-events and reprocess-trades.
//
// Pip size + classification come from the single canonical source
// (`./quant/symbolMapping.ts`). The previous file had its own divergent
// table that returned 0.01 for NAS100/SPX (should be 1.0) and 0.1 for DAX
// (should be 1.0), producing 10–100× R errors on the fallback path.
//
// Pip *value* (USD per pip per lot) is still a small local table because
// the canonical symbol-mapping module deliberately does not embed broker
// economics. Index pip values here are calibrated to standard contract
// specs and only fire when the grossPnl-derived path is unavailable.

import { pipSizeForSymbol, classifySymbol } from "./quant/symbolMapping.ts";

/**
 * Approximate USD pip value per lot. Used ONLY as a fallback when the
 * grossPnl-derived $/point path is unavailable — that path is broker-agnostic
 * and exact, so prefer it whenever possible.
 *
 * Returns `null` for symbols whose pip value depends on a live FX rate we
 * don't have at hand (cross-JPY pairs): better to skip R-multiple than to
 * publish a 10–35%-biased number.
 */
export function getPipValue(
  symbol: string,
  lots: number,
  ctx?: { exitPrice?: number | null },
): number | null {
  const n = (symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const cls = classifySymbol(symbol);

  if (cls === "fx3" || n.includes("JPY")) {
    // USD/JPY: pip value (USD) per lot = (0.01 / quote) * 100,000 = 1000 / quote.
    // For other JPY crosses we don't have USDJPY here; skip.
    const looksLikeUsdJpy = n.startsWith("USDJPY");
    const quote = ctx?.exitPrice;
    if (looksLikeUsdJpy && typeof quote === "number" && quote > 0) {
      return (lots * 1000) / quote;
    }
    return null;
  }
  if (cls === "metal_xau") return lots * 10;       // XAUUSD: 1 pip = $0.10/oz × 100 oz
  if (cls === "metal_xag") return lots * 50;       // XAGUSD: 1 pip = $0.01/oz × 5000 oz
  if (cls === "crypto") {
    if (n.includes("BTC")) return lots * 1.0;
    return lots * 1.0;
  }
  if (cls === "oil") return lots * 10;
  if (cls === "index") {
    // 1 point of an index ≈ $1 × contract multiplier × lots. Standard CFD
    // multipliers per broker convention (FTMO/IC/etc.):
    if (n.includes("SP500") || n.includes("SPX") || n.includes("US500")) return lots * 50;
    if (n.includes("NAS") || n.includes("USTEC") || n.includes("US100") || n.includes("NDX")) return lots * 20;
    if (n.includes("US30") || n.includes("DJ30") || n.includes("DJI") || n.includes("DOW")) return lots * 5;
    if (n.includes("DAX") || n.includes("DE40") || n.includes("GER40") || n.includes("DE30") || n.includes("GER30")) return lots * 25;
    if (n.includes("FTSE") || n.includes("UK100")) return lots * 10;
    if (n.includes("JP225") || n.includes("JPN225") || n.includes("NIKKEI") || n.includes("N225")) return lots * 5;
    return lots * 10;
  }
  // fx5 default: 1 pip ≈ $10 per standard lot (quote-currency dependent;
  // close enough for non-JPY majors where USD is the quote currency).
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

    // Primary: broker-agnostic via realized $/point.
    if (grossPnl && grossPnl !== 0 && allFills.length) {
      let totalPointLots = 0;
      for (const f of allFills) totalPointLots += (f.price - entryPrice) * dirSign * f.lots;
      if (Math.abs(totalPointLots) > 1e-9) {
        const dollarsPerPointPerLot = grossPnl / totalPointLots;
        const risk = stopDistance * lots * Math.abs(dollarsPerPointPerLot);
        if (risk > 0) return Math.round((netPnl / risk) * 100) / 100;
      }
    }

    // Fallback: canonical pip size × symbol-class pip value.
    const pipSize = pipSizeForSymbol(symbol);
    const pipValue = getPipValue(symbol, lots, { exitPrice });
    if (pipValue == null || !(pipSize > 0)) return null;
    const risk = (stopDistance / pipSize) * pipValue;
    if (risk > 0) {
      // One-line warning so we can audit how often the fallback fires in prod.
      // Filter logs by "[rMultiple] fallback path" to surface affected symbols.
      try { console.warn(`[rMultiple] fallback path used for symbol=${symbol} risk=${risk.toFixed(2)}`); } catch { /* ignore */ }
      return Math.round((netPnl / risk) * 100) / 100;
    }
  }

  return null;
}
