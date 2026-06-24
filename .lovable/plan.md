## Revert plan

Rip out the window-discipline feature from the Timing tab. The existing first-half vs second-half block already validates your `first_30min` / `last_30min` rules — anything I added on top was answering the wrong question.

## What changes

`src/components/pair-lab/IntraHourTiming.tsx`:

- Delete the `DisciplineFilter`, `WindowClass`, `SymbolDiscipline` types
- Delete `parseEntryWindow`, `classifyTrade`, `meanOf`, and related constants (`MIN_N_FOR_DRIFT_FLAG`, `DRIFT_FLAG_R`, `MIN_TRADES_FOR_COVERAGE_NUDGE`, `MIN_PARSEABLE_FOR_DISCIPLINE`, `DISCIPLINE_OPTIONS`)
- Drop the `idealEntryWindowKey` prop
- Remove the "Window discipline" control row, the excluded-count footer, the per-symbol discipline summary block, and the coverage nudges
- Restore the unconditional first-half vs second-half block exactly as it was
- Restore the original header and footer copy
- Remove the `discipline` / parsed-window logic from the `useMemo` aggregation

`src/pages/PairLab.tsx`:

- Drop the `idealEntryWindowKey={data.fieldKeys.idealEntryWindow}` prop from `<IntraHourTiming />`

That leaves the file effectively at its pre-change state, minus the new copy. No other files touched, no math/edge-function/journal changes.

## Verify

- `/pair-lab` → Timing tab loads with the original controls (Mode / Bucket size / Symbol)
- Heatmap renders as before
- "First half vs second half" block renders unconditionally beneath it
- Typecheck passes
