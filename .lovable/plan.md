## Goal

Stop measuring "edge by fill-minute R" and start measuring "did a setup print in each half of the hour, and did it work" — per pair. The R you booked is no longer the input to the window question; setup occurrence + setup outcome is.

## What changes for the user

On every trade you log, two small fields appear in the Journal entry form, under a new **Hour Setup Landscape** section:

- **First-half setup (≤ :30):** `None` / `Worked` / `Failed`
- **Second-half setup (> :30):** `None` / `Worked` / `Failed`

You fill these in based on what the chart actually offered that hour, regardless of which setup you took. "Worked" / "Failed" is defined by your own normal TP/SL on that setup — same definition you'd use to grade any setup.

The existing `Ideal Entry Window` toggle is removed. It conflated three different things and none of them answered the real question.

## What the Pair Lab shows

The Timing tab is rebuilt around two questions per pair:

1. **Occurrence rate** — of all logged hours for this pair, what % had a first-half setup? Second-half? Both?
2. **Hit rate when it did occur** — when a first-half setup printed, what % worked? Same for second-half.

Layout:

```text
GBPUSD — 42 hours logged
                       Printed      Worked when printed
First half (≤ :30)     31 / 42      24 / 31   77%
Second half (> :30)    22 / 42      12 / 22   55%
Both halves printed    14 hours     First worked 11, Second worked 6
```

Plus a small **Co-occurrence panel**: when both halves printed, which one paid more often. This directly answers "if I'd waited for the second-half setup but the first-half also printed, would I have been better off taking the first?"

No R, no scatter, no minute-bucketing. Just hit rates from observed setups. Filter by pair / direction / session as today.

## Why this is the right shape

- **R is removed as the noise source.** A late-entry loser no longer pollutes the first-half edge number. Execution quality is a separate problem you can analyze separately if you want.
- **No bucket-cliff problem.** Two halves, defined by candle close. A setup whose final candle closes at :31 is unambiguously second-half. No 31st-minute discontinuity in the analysis.
- **Selection bias is reduced, not eliminated.** You still only log hours you traded, but within those hours you now log *both* halves' offerings — so the skipped-by-rule first-half setups finally enter the dataset.
- **Answers the original forward-test contradiction directly.** If GBP first-half hit rate is materially higher than second-half across 30+ hours, the "wait for second half" rule was wrong. If they're close, the rule is fine and the forward-test feeling was noise.

## Technical details

**Schema (`trades` table, additive migration):**
- `first_half_setup` — enum-as-text, nullable: `null` | `'none'` | `'worked'` | `'failed'`
- `second_half_setup` — same shape

Both nullable so existing trades stay valid and back-fill is optional.

**Touched files:**
- `supabase/migrations/...` — add two columns to `public.trades`
- `src/integrations/supabase/types.ts` — regenerated
- `src/types/trading.ts` — extend `Trade` type
- `src/components/journal/` — add `Hour Setup Landscape` section to the trade entry/edit form (two segmented controls)
- `src/components/pair-lab/IntraHourTiming.tsx` — replace heatmap with the occurrence + hit-rate table and co-occurrence panel
- `src/hooks/usePairLab.tsx` — aggregate the two new fields per pair (counts of printed / worked / both-printed)
- `src/lib/pairLabMath.ts` — small helpers for the per-half rollups
- `.lovable/plan.md` — record the decision

**Removed:** the `Ideal Entry Window` field on the form and any code paths reading it for analysis. The column itself stays in the DB for now (no destructive migration) and can be dropped later.

**Out of scope for this build:**
- Hypothetical R / missed-trade logging — not needed for the hit-rate model.
- Logging hours you didn't trade — would fix the remaining selection bias but is a much bigger workflow change. Can be added later if hit-rate numbers diverge from your forward-test feel.
- Sub-half slicing (quarters, raw minute scatter) — revisit only if half-of-hour proves too coarse after ~30+ logged hours per pair.
