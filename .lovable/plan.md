
# Pair Lab cleanup — drop Intra-hour, fix toggle behavior

## 1. Remove the Intra-hour timing tab

- Drop the `<TabsTrigger value="timing">` and `<TabsContent value="timing">` from `src/pages/PairLab.tsx`.
- Drop the `IntraHourTiming` import.
- Delete `src/components/pair-lab/IntraHourTiming.tsx` — it has no other call sites.

Hour-half edge analysis now lives entirely in the Ideal Windows tab.

## 2. Make toggles visibly work on sparse data

The selects (Regime, Direction, Min N, Sort) and hour chips already wire through to the math — but with your dataset (largest bucket n=4, Min N=10) every cell is `belowMinN`, so they render grey-on-grey and changes look inert. Fix the perception with three small behavioral tweaks:

- **Color below-N cells anyway** — currently `cellTone()` returns a flat grey for `n < minN`. Change to: always render the lift color (red/green), just at lower opacity, and reserve the dashed border + star suppression for the below-N state. This way Min N still gates significance (★), but visual feedback responds to every filter change.
- **Lower default Min N** from 20 → 10 (matches what most users land on with realistic sample counts; advanced users can raise it).
- **Hour chip click → also clear `selectedCell`** if the cleared hour was selected, so the drill-down doesn't dangle on a hidden row.

## 3. Audit the rest of the toggles

Walk through each control and confirm it's wired:

- Pair select → drives `filters.pair` → recomputes ✅ (also resets `selectedCell`).
- Regime select → drives `filters.regime` ✅.
- Direction select → drives `filters.direction` ✅.
- Min N select → drives `filters.minN` and persists to localStorage ✅.
- Sort by select → drives `displayHours` row ordering ✅.
- Hour chips → toggle membership, persist to localStorage, recompute ✅.
- Clear button → empties the hour list ✅.
- Cell click → opens drill-down (disabled when n=0) ✅.

No code changes here beyond the cell-render fix above and resetting `selectedCell` when its hour is removed.

## 4. Technical notes

- Files touched: `src/pages/PairLab.tsx`, `src/components/pair-lab/IdealWindowHeatmap.tsx`, delete `src/components/pair-lab/IntraHourTiming.tsx`.
- No schema or math changes.
- No new dependencies.
