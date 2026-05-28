## Remove the period-over-period delta badge

You're right — surfacing a big "−$11,682" comparison number pushes traders into result-dwelling and reactive emotions, which works against the calm, process-focused tone the rest of the app aims for.

### Change

In `src/components/dashboard/EquityCurve.tsx` (lines 291–328), remove the entire comparison row:
- The `Last {period}: ±$X` text
- The colored delta badge (`Δ$`, `%`, `(flipped)`, `TrendingUp/Down` icons)
- The `Same` pill

The big current-period P&L and % above it stays — that's the single, neutral data point a trader needs.

### Cleanup

Once the row is gone, drop now-unused locals in the same component: `previousPeriodPnl`, `prevIsProfit`, `isSame`, `isBetter`, `delta`, `deltaDollar`, `deltaBalancePct`, `signFlipped`, and the `TrendingUp` / `TrendingDown` / `Minus` icon imports if nothing else uses them.

No backend, data, or other UI changes.
