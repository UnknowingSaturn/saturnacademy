## Goal

Track per-pair, per-hour **setup quality by half-hour window**, decoupled from trade W/L. Answer: *what's the probability the setup plays out in the first vs. second half of this hour for this pair?*

## Data model

Replace the single 7-state `ideal_entry_window` field with **two independent multi-select fields** on each trade:

| Field                  | Type             | Meaning                                                    |
|------------------------|------------------|------------------------------------------------------------|
| `setup_worked_halves`  | `text[]`         | Halves where the setup printed **and played out**. Subset of `{first, second}`. |
| `setup_failed_halves`  | `text[]`         | Halves where the setup printed **and failed**. Subset of `{first, second}`.    |

Rules:
- Both empty → no qualifying setup that hour (regardless of trade W/L).
- A half can appear in only one of the two arrays per trade (worked XOR failed), but the two halves are independent: e.g. `worked=[second]`, `failed=[first]` is valid and meaningful.
- Trade W/L is **not** used by this math — these fields describe the *setup*, not your execution.

## Probability math (per pair × hour × half)

For each `(pair, hour-of-day, half)` bucket, scan all trades and count:

```text
worked = trades where half ∈ setup_worked_halves
failed = trades where half ∈ setup_failed_halves
worked_rate = worked / (worked + failed)
sample_size = worked + failed
```

Display per pair-hour: two rows (first / second) showing `worked_rate %`, `n = sample_size`, and raw `worked / failed` counts.

## UI

**TradeProperties.tsx** — replace the single dropdown with a compact two-row control:

```text
Setup worked in:    [ ] First half   [ ] Second half
Setup failed in:    [ ] First half   [ ] Second half
```

Helper text: *"Tag the halves where the setup actually printed. 'Worked' = setup played out. 'Failed' = setup printed but didn't follow through. Leave both blank if no valid setup this hour."*

Client-side validation: prevent the same half being checked in both rows; show inline warning.

**IntraHourTiming.tsx** — table columns: `Pair | Hour | Half | Worked rate | Worked | Failed | n`. Sort by `worked_rate` desc with a minimum sample-size filter.

**TradeTable.tsx / JournalCalendarView.tsx** — replace the single badge with a compact dual badge: `✓1 ✗2` style, or hide when both arrays are empty.

## Files to change

- `src/types/trading.ts` — drop `IdealEntryWindow` union, add `setup_worked_halves: HalfWindow[]` and `setup_failed_halves: HalfWindow[]` where `HalfWindow = 'first' | 'second'`.
- `src/lib/hourSetup.ts` — replace `decode()` with helpers: `worksIn(trade, half)`, `failsIn(trade, half)`.
- `src/lib/pairLabMath.ts` & `supabase/functions/_shared/quant/pairLabMath.ts` — rewrite intra-hour aggregator per the math above.
- `src/components/journal/TradeProperties.tsx` — new dual-multiselect control.
- `src/components/journal/TradeTable.tsx`, `JournalCalendarView.tsx` — new badge rendering.
- `src/components/pair-lab/IntraHourTiming.tsx` — new columns + sort/filter.
- `src/hooks/useTrades.tsx` — pass the two new arrays through create/update.
- `src/types/settings.ts` — drop any preset references to the old 7-state values.
- `src/integrations/supabase/types.ts` — regenerated after migration.

## Migration

New SQL migration:

1. Add `setup_worked_halves text[] not null default '{}'` and `setup_failed_halves text[] not null default '{}'` to `trades`.
2. Backfill from existing `ideal_entry_window`:
   - `first_worked` → worked=[first]
   - `first_failed` → failed=[first]
   - `second_worked` → worked=[second]
   - `second_failed` → failed=[second]
   - `mixed` → worked=[first], failed=[second]   *(best-effort under the old convention)*
   - `none` / null → both empty
3. Add a CHECK constraint via trigger: arrays must be subsets of `{first, second}` and disjoint from each other.
4. Drop `ideal_entry_window` column (after confirming nothing reads it).

## Out of scope

- Logging missed setups on hours where no trade was taken (separate feature for selection-bias correction).
- Sub-30-minute granularity (no minute-of-hour bucketing).
- Joining this with W/L for an "execution conversion rate" (could be a future view; the data supports it).

## Acceptance

- A losing trade with `worked=[first]` lifts the first-half worked rate for that pair-hour.
- A trade with `worked=[second], failed=[first]` adds 1 to second-half worked and 1 to first-half failed.
- Intra-hour Timing percentages are bounded (no more trivial 100% rows) and reflect setup quality, not execution.
- No `ideal_entry_window` references remain in the codebase.
