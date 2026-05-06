# Fix R-multiple calculation for indices

## The bug

Index R-multiples are ~10–100× too small. Examples from your DB:

| Symbol | Entry | SL | Lots | Net PnL | Stored R | Real R |
|---|---|---|---|---|---|---|
| NASUSD buy | 28490.4 | 28421.3 (69.1 pts) | 7.26 | +$781 | 0.08 | ~+1.5R |
| SPXUSD buy | 7349.0 | 7337.4 (11.6 pts) | 30.17 | +$483 | 0.03 | ~+1.4R |
| US100.cash buy | 25734.7 | 25710.27 (24.4 pts) | 4.66 | -$53 | -0.02 | ~-0.5R |

## Root cause

In `supabase/functions/ingest-events/index.ts` and `supabase/functions/reprocess-trades/index.ts`, the helpers `getPipSize` + `getPipValue` use hard-coded constants per symbol family. For US indices they assume `pipSize = 0.01` and `pipValue = lots * 0.20` (NAS) / `0.50` (SPX) / `0.10` (US30). Those numbers don't match what your broker actually pays per point per lot, so the implied $-risk is roughly 10–50× the real risk and R% comes out tiny.

Hard-coding contract specs per broker is fundamentally fragile — different brokers (NASUSD vs US100.cash vs NAS100) have different contract sizes and `lot = 1.0` can mean very different things.

## Fix: derive point value from realized PnL

For every closed trade we already know:
- `entry_price`, `exit_price` → realized price move
- `net_pnl` (or `gross_pnl`)
- `original_lots`
- `sl_initial` → stop distance

So the actual realized USD per price point is:

```
$/point/lot = gross_pnl / ((exit_price - entry_price) * direction_sign * original_lots)
risk_$      = |entry_price - sl_initial| * original_lots * $/point/lot
R           = net_pnl / risk_$
```

This is broker-agnostic and always self-consistent because it uses the broker's own PnL number. It works for forex, indices, metals, crypto — everything.

Fallbacks when derivation isn't possible:
1. If price move is 0 (BE close) or `gross_pnl` is 0 → fall back to existing `getPipSize`/`getPipValue` table.
2. If no SL → fall back to `net_pnl / equity_at_entry * 100` (R% mode, current behavior).

## Implementation

### 1. `supabase/functions/ingest-events/index.ts`

Add helper:

```ts
function computeRMultiple(opts: {
  entryPrice: number; exitPrice: number | null;
  slPrice: number | null; lots: number;
  grossPnl: number; netPnl: number;
  symbol: string; equityAtEntry: number | null;
  direction: "buy" | "sell";
}): number | null {
  const { entryPrice, exitPrice, slPrice, lots, grossPnl, netPnl, symbol, equityAtEntry, direction } = opts;
  if (!slPrice || !entryPrice || slPrice === entryPrice || !lots) {
    if (equityAtEntry && equityAtEntry > 0)
      return Math.round((netPnl / equityAtEntry) * 10000) / 100;
    return null;
  }
  const stopDistance = Math.abs(entryPrice - slPrice);

  // Preferred: derive $/point from this trade's own PnL
  if (exitPrice && grossPnl !== 0) {
    const dirSign = direction === "buy" ? 1 : -1;
    const priceMove = (exitPrice - entryPrice) * dirSign;
    if (Math.abs(priceMove) > 1e-9) {
      const dollarsPerPointPerLot = grossPnl / (priceMove * lots);
      const risk = stopDistance * lots * Math.abs(dollarsPerPointPerLot);
      if (risk > 0) return Math.round((netPnl / risk) * 100) / 100;
    }
  }

  // Fallback: hard-coded pip table (existing logic)
  const pipSize = getPipSize(symbol);
  const pipValue = getPipValue(symbol, lots);
  const risk = (stopDistance / pipSize) * pipValue;
  if (risk > 0) return Math.round((netPnl / risk) * 100) / 100;
  return null;
}
```

Replace both R-multiple blocks (lines ~703–717 orphan-exit branch, ~804–822 full-close branch) with calls to `computeRMultiple`.

### 2. `supabase/functions/reprocess-trades/index.ts`

Replace the calculation around line 198–204 with the same `computeRMultiple` helper.

### 3. `supabase/functions/backfill-trades/index.ts`

This function currently only does R% (`net_pnl / equity * 100`). Leave it as-is — it's a separate "R as percent of account" view, not stop-based R.

### 4. Backfill existing trades

After the helper is in, hit `reprocess-trades` for the affected accounts so the wrong stored values get recomputed. We can either:
- Add a one-shot button in the UI (already exists in account settings if reprocess is wired), OR
- Run a single SQL-driven pass via the edge function for each affected `account_id`.

I'll wire a "Recompute R-multiples" call against `reprocess-trades` for all accounts holding index trades after deploy.

## Files touched

- `supabase/functions/ingest-events/index.ts` — add helper, replace 2 call sites
- `supabase/functions/reprocess-trades/index.ts` — add helper, replace 1 call site
- Memory `mem://journal/market-math` — update with the new derivation rule

No DB schema change. No frontend change.
