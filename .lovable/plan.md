## Walk-forward layer for the Analyze tab

Bring the Analyze tab (BucketGrid + QuantNotePanel + StrategyRanker) up to the same walk-forward standard the Ideal windows tab now has. Same primitives, same UX language — applied to the symbol × session world that uses `pairLabMath` / MFE / MAE / expectancy.

### What you'll see

1. **WalkForwardControls bar** at the top of the Analyze tab (above the baseline card).
   - Lens toggle: All-time / 90d / 30d (relative to as-of).
   - As-of date slider (bounded by your trade history). "Jump to today" shortcut.
   - The same component already in use on Ideal windows — pulled out so both tabs share it.

2. **Group / individual scope selector** on Analyze.
   - Same scope dropdown style: "Groups (merged)" + "Individual pairs" + an "All pairs" default.
   - When a group is selected, the BucketGrid collapses every member symbol into a single row using a wrapped resolver — no per-pair-per-pair math; trades just bucket under the group name.
   - Ad-hoc "Analyse as one" action on a row's overflow menu — select N rows → temporary group for this view.

3. **Drift signal on every BucketGrid cell.**
   - Recent-N (default 10) worked-rate / expectancy compared to lifetime within the active lens.
   - Cell shows a small ↑ / ↓ chip with the pp swing when |drift| ≥ 15pp AND recent N ≥ 5.
   - Tooltip surfaces "Recent 10: 62% · +18pp vs lifetime" so it doesn't have to be inferred.

4. **QuantNotePanel drill-down chart.**
   - Cumulative expectancy curve with bootstrap CI band.
   - Rolling-10 expectancy line (orange, dashed) overlaid.
   - Per-trade R dots along the timeline (green ✓ / red ✗).
   - Same SVG style as the Ideal windows drill-down for visual consistency.

5. **Out-of-sample mini-panel** under the baseline card.
   - Pick a split date → "train" worked-rate / expectancy vs "test" side-by-side, per cell or for the whole baseline.
   - Defaults to a 70/30 split on the date axis of in-scope trades.
   - Flags cells where train was profitable but test went negative (overfit candidates).

### How it works

- Extend `usePairLab` to accept `dateFrom` / `dateTo` / `recentN` / `groupOverride`, and forward them into `buildBuckets`. Trades are pre-filtered by entry timestamp before bucketing → no future leakage, no special-casing downstream.
- Add per-bucket `events: { ts, won, r }[]` to `BucketReport` so the drift signal and cumulative chart are causal by construction. `pairLabMath.buildBuckets` already iterates the trades once; we just keep the per-event tail.
- Compute `recentRate` / `recentExpectancy` / `drift` in the same finalize loop using `events.slice(-recentN)`. Same formula as `idealWindowMath` so the two tabs stay aligned.
- Add a `groupOverride: { name, symbols } | null` arg. When set, `usePairLab` wraps the existing `symbolResolver` to collapse members into the group name, identical to the heatmap wrapper.
- Extract the lens/as-of UI into `WalkForwardControls` (already created last turn) so both tabs share one component. Move `resolveWindow` next to it.
- Out-of-sample panel = pure presentation: it calls `buildBuckets` twice with `dateTo = splitDate` and `dateFrom = splitDate`, diffs the per-cell results, renders.

### State / URL

- Analyze tab's existing `?symbol=&session=` deep link stays. Adds `?lens=&asOf=&scope=` so a walk-forward view is shareable / refresh-safe.
- Lens + as-of state is local to the Analyze tab — Ideal windows keeps its own. (They diverge naturally: you'd often inspect different dates on each.)

### Files touched

- `src/hooks/usePairLab.tsx` — accept date window, recentN, groupOverride. Pre-filter trades.
- `src/lib/pairLabMath.ts` — keep per-bucket `events`, compute `recentRate` / `drift`. Add `cumulativeExpectancySeries` helper.
- `src/pages/PairLab.tsx` — wire WalkForwardControls + scope selector into the Analyze tab; URL-sync new params.
- `src/components/pair-lab/BucketGrid.tsx` — drift chip per cell, ad-hoc "Analyse as one" row action.
- `src/components/pair-lab/QuantNotePanel.tsx` — append the cumulative + rolling chart.
- New: `src/components/pair-lab/OutOfSamplePanel.tsx`.
- New (split): `src/components/pair-lab/AnalyzeScopeSelector.tsx` (groups + individual + "All pairs", shared with the heatmap scope picker).

### Out of scope

- Touching the simulator / StrategyRanker math — they consume the same scoped trades, so they pick up walk-forward for free.
- Server-side caching — math stays client-side; trade volumes are well within budget.
- Exponential time-decay weighting (revisit only if the drift signal proves noisy in practice).
