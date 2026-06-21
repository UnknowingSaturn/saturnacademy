# Remove the Recommendation card

The card is broken (Suggested SL = 0 pips because MAE/Ideal-SL ticks→pips conversion collapses to zero on this data) and structurally redundant: the **Auto-ranker** already produces a TP / SL / risk recommendation per scope, proof-replayed across 12 strategies. Two answers to the same question = confusion.

## Changes

**Delete the component and its render site:**
- `src/components/pair-lab/RecommendationCard.tsx` — delete.
- `src/pages/PairLab.tsx` — remove the import and the `<RecommendationCard>` mount in the grid tab.

**Promote the AI quant note to the full row** when a cell is selected (it currently shares a 2-col grid with the recommendation):
- In `PairLab.tsx`, replace the `grid lg:grid-cols-2` wrapper around `RecommendationCard` + `QuantNotePanel` with a single full-width `QuantNotePanel`.

**Surface the bucket's raw stats inside the quant-note card** so the user still sees N / win rate / expected R / MFE / MAE / SL drift without scrolling back to the grid:
- Add a compact stats strip at the top of `QuantNotePanel.tsx` (above the Generate button) listing: `N`, `Win rate`, `Expected R ± CI`, `MFE p50/p75`, `MAE p50/p75`, `SL drift` badge. Same data, no recommendations.

**Keep intact:**
- `BucketGrid` — selection still drives the rest of the page.
- `QuantNotePanel` — still the AI write-up entry point.
- `StrategyRanker` — already the single source of truth for actionable parameters.
- Math layer (`pairLabMath.ts`) — `recommendation` field stays computed (still consumed by `pair-lab-report` edge function); only the UI surface is removed.

## Out of scope

No engine, math, or DB changes. The underlying ticks→pips conversion bug stays unresolved on this branch (it only affected the removed card; the ranker uses R-multiples, not pips). I'll flag it as a follow-up if you want it fixed separately.

## Verification

- Playwright `/pair-lab`: select a cell, confirm only the quant-note card renders below the grid (full width), and the new stats strip shows N / WR / E[R] / MFE / MAE / SL drift.
- No console errors; no broken imports.
- Auto-ranker still renders 12 rows and the inline equity overlay.
