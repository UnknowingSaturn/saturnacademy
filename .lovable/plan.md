# Consolidate to `ideal_entry_window` as setup landscape

## Model

One hour can have two independent observations:

- **Where a setup *worked*** → `ideal_entry_window`: `none | first | second | both`
- **Where a setup *formed but failed*** → `failed_setup_half`: `none | first | second | both`

Together that's the "4 states + failed flag" you picked. Semantics are about the **hour**, not about your entry: a losing trade entered in the second half can still have `ideal_entry_window = first` if the first-half setup would have worked. That's the signal the lab needs.

## Schema

Drop the experiment from the last turn and promote `ideal_entry_window` to a real column.

```text
trades
├─ ideal_entry_window  text  null   -- 'none' | 'first' | 'second' | 'both'
└─ failed_setup_half   text  null   -- 'none' | 'first' | 'second' | 'both'
```

- Migration drops `first_half_setup` and `second_half_setup` (added last turn, no analysis depends on them yet).
- Adds `ideal_entry_window` as a real column on `trades` so it can be sorted, filtered, and aggregated without going through the custom-field path. Existing `cf_ideal_entry_window` references in `pairLabMath.ts` still resolve via the alias system for legacy rows; new writes go to the column.
- CHECK constraint restricts both columns to the four values above.

## Journal UI

Two inline-editable columns, hidden by default, enabled from **Settings → Fields** (this is why you don't see them right now — same fix applies):

| Column | Pills |
|---|---|
| Ideal entry window | None · First · Second · Both (green) |
| Failed setup | None · First · Second · Both (red) |

- `src/lib/hourSetup.ts` becomes the single source for the four-value option list + colors (one palette for "worked", one for "failed").
- `TradeProperties.tsx` sidebar replaces the two old rows with these two.
- `TradeTable.tsx` renders both as `BadgeSelect` and uses `useUpdateTrade`.
- `FilterBar` picks them up automatically once registered in `DEFAULT_COLUMNS`.
- `JournalCalendarView`: day-cell badge shows `W` if any trade that day has a worked window, `F` if any has a failed setup.
- **Visibility fix**: register both in `DEFAULT_COLUMNS` with `defaultVisible: true` (or whatever flag your settings system uses) so they show up without a Settings trip. That's the real reason today's columns are missing.

## Pair Lab — Intra-Hour Timing

Per pair × hour:

- **First-half hit rate** = `count(ideal=first OR ideal=both) / count(ideal in {first,both} OR failed in {first,both})`
- **Second-half hit rate** = symmetric
- **Print rate** per half = how often a setup of any kind printed in that half
- **Co-occurrence**: hours where both halves produced setups — compare worked-vs-failed across the two halves to recommend "take 1st" vs "wait for 2nd"

`MIN_HOURS_FOR_TRUST = 10` stays. The R-heatmap stays gone.

## What is out

- The two `*_setup` columns added last turn (deleted in the migration; no rows depend on them yet — confirm before you approve).
- Forcing setup entry at trade-open time. You still backfill from the Journal row after the hour closes.
- Bulk-edit menu — inline row edit is enough for now.

## Technical notes

- Migration: `ALTER TABLE` add columns, `DROP` old columns, add CHECK, `GRANT`s unchanged (no new table).
- `src/types/trading.ts`: replace the two fields with `ideal_entry_window` and `failed_setup_half`; keep the existing `HourSetupOutcome` type retired.
- `useTrades.tsx` `scalarFields` allowlist: swap field names.
- `pairLabMath.ts` (client + edge copy): keep the `idealEntryWindow` alias entry so legacy custom-field reads still resolve; new analytics read straight from the column.
- `IntraHourTiming.tsx`: rewrite the data shaping to use the new columns; rendering layout unchanged.
