## Goal

Make the Strategy Simulator math trustworthy by default. Stop replaying presets against inferred MFE data, and make it obvious which buckets have enough logged data to be statistically meaningful.

## Behavior changes

1. **High-fidelity is ON by default** across Ranker and Compare. The toggle stays (users can flip it off to see inferred data), but the default is honest-math-only.
2. **Min sample = 10 logged trades.** If a bucket has fewer than 10 trades with both MFE and MAE recorded, preset comparisons are suppressed and the cell shows an "insufficient logged data" state instead of misleading stats.
3. **Every bucket cell in the grid shows MFE coverage** — e.g. `1/30 logged` — color-coded so users see data quality at a glance before clicking in.
4. **"Actual behavior" preset is unaffected** by the filter (it only needs `r_multiple_actual`, not MFE). It still appears in rankings even on low-coverage buckets, but other presets are hidden/grayed.

## Coverage badge color rules (on each cell in `BucketGrid`)

- Green: ≥70% of trades have logged MFE
- Amber: 30–69%
- Red: <30% (or <10 absolute)
- Format: `12/30 MFE` under the existing MFE/MAE p75 line

## Insufficient-data state

When `highFidelityOnly` is on and `loggedTrades < 10` for a bucket:

- **Ranker**: show "Need 10+ trades with logged MFE to compare presets. This bucket has N. Showing actual behavior only." instead of the preset leaderboard.
- **Compare**: gray both preset cards, same message, with a "Show inferred data anyway" link that flips the toggle locally.
- **EquityCurveOverlay**: hide preset curves except "actual behavior".

## Technical changes

### `src/lib/pairLabSimulator.ts`
- Add `loggedTradeCount` and `totalTradeCount` to `ReplayResult` so the UI can render coverage without recomputing.
- Add a helper `getBucketCoverage(trades, fieldKeys)` returning `{ logged, total, pct }` for use by `BucketGrid` (cheap — just counts MFE-present trades).
- Export a constant `MIN_HIGH_FIDELITY_SAMPLE = 10`.

### `src/components/pair-lab/StrategyRanker.tsx`
- Default `highFidelityOnly` state to `true`.
- After computing results, if `winner.loggedTradeCount < MIN_HIGH_FIDELITY_SAMPLE` and `highFidelityOnly` is true, render the insufficient-data panel instead of the leaderboard. Keep "actual behavior" row visible.
- Add a one-line caption near the toggle: "Honest mode: only trades with logged MFE/MAE are replayed."

### `src/components/pair-lab/StrategyCompare.tsx`
- Default `highFidelityOnly` to `true`.
- Same insufficient-data guard. Add a "Show inferred data anyway" inline button that calls `setHighFidelityOnly(false)` and shows a subtle warning banner above the cards explaining the numbers are estimates.

### `src/components/pair-lab/BucketGrid.tsx`
- Compute coverage per cell via `getBucketCoverage`.
- Append a coverage badge under the existing `MFE x · MAE y` line, with the color rule above.
- Add a small legend chip to the grid header explaining the coverage colors.

### `src/components/pair-lab/EquityCurveOverlay.tsx`
- When the active bucket is low-coverage in high-fidelity mode, render only the "actual behavior" curve plus an empty-state message for preset curves.

## What this does NOT change

- Inference math itself stays exactly as it is — we are not making it more optimistic. Users who flip the toggle off get the same conservative inferred replay they have today.
- No DB or backend changes. This is presentation + default-state only.
- "Actual behavior" preset math is unchanged.

## Is this actually better?

For users with well-logged data: yes, immediately — the default view becomes trustworthy without any opt-in.

For your current EURUSD-Tokyo bucket (1/30 logged): the simulator will *correctly* refuse to compare presets and tell you to log more MFE data. That is the honest answer. The escape hatch ("Show inferred data anyway") preserves the existing capability for users who explicitly accept the uncertainty.
