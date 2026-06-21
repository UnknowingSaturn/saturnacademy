## Audit of current strategy presets

**The 6 presets in `src/lib/pairLabPresets.ts` are mathematically correct** under the proof-based replay engine (`replayOneTrade`), with these caveats:

### Accuracy findings

1. **Runner preset partial fractions** — `33% @1R + 33% @2R` partials sum to 0.67, leaving 0.33 for `trail_to_mfe`. Code handles this correctly via `remainingFrac`. No bug, but the label says "33% / 33% / trail" while the actual fractions are 0.34 / 0.33 / 0.33 — rounding artifact, harmless.
2. **"Your current behavior" baseline is mislabeled** — `useActualOutcome: true` returns `r_actual`, then multiplies by `(simBalance * riskPct%)`. So the "+$25,450" baseline is *not* the user's real P&L; it is "what your recorded R-outcomes would have produced at 1% risk on $100k". Label says "Baseline to beat" which is fine, but description should clarify this is a normalized-risk replay, not actual dollars booked.
3. **`Tighten SL → ideal · all-out @2R` clamps `idealSlScale` to [0.2, 2]** in `idealSlScaleFor()`. If a user's logged ideal-SL is much tighter than recorded SL (e.g. 0.15× — common after wide initial stops), the floor of 0.2 silently caps the benefit. Not a bug per se, but worth widening the floor to 0.1 or surfacing the clamp count.
4. **`widen_to_mae_p75_x_1_15` SL rule exists in the engine but no preset uses it** — dead code path.
5. **Walk-forward winner is chosen on IS expectancyR alone**, ignoring Sharpe/eligibility — a noisy IS winner can carry to OOS. Already tiebreaks on Sharpe in the main ranker; mirror that in `walkForwardEvaluate`.

### Strategies that *should* exist given the data the engine already collects

The engine records `loggedMfe`, `loggedMae`, `r_actual`, `idealSlScale`, plus bucket-level `maeP75`. Six obvious presets are missing:

| # | Proposed preset | Why it fits the data |
|---|---|---|
| 7 | **All-out @3R** | The Auto-ranker shows mean Reached R = 4.73R across the sample — every current preset caps booking at 2R, leaving the entire right tail on the table. A 3R preset will reveal whether targets are being closed too early. |
| 8 | **Pure trail from entry (no partials)** | Trail-capture is now empirically measured (38%, N=23). A pure trail preset isolates trailing-stop value vs. the 2R cap. Needs the engine to skip the `partials.length === 0 + be_after_first_tp` guard (use `trail_to_mfe`). |
| 9 | **Tighten SL → ideal · scale-out 50%@1R + 50%@2R** | Same SL tightening but lower-variance exit; lets the ranker isolate SL-tightening from exit-style. |
| 10 | **Tighten SL → ideal · runner 33%/33%/trail** | Mirrors #9 with the runner — completes the SL × exit matrix. |
| 11 | **Widen SL → MAE-p75 × 1.15 · all-out @2R** | Activates the dead `widen_to_mae_p75_x_1_15` rule. Tests whether SL tightness is sacrificing R-multiples for win rate. |
| 12 | **Bucket-adaptive TP @ MFE p60 of bucket** | Use bucket-level MFE distribution (already computed) to pick a data-driven TP per bucket instead of fixed 1R/2R. Single partial at p60(MFE), all-out. Most "quant-like" of the proposed presets — the others are heuristics. |

#12 requires a new `exitRule.partials` mode that resolves `atR` from a bucket statistic at replay time. Smallest engine change: add an `atRSource: "fixed" | "bucket_mfe_p60" | "bucket_mfe_p75"` field; resolve in `replayOneTrade`.

### Implementation

1. `src/lib/pairLabSimulator.ts`
   - Add optional `atRSource?: "fixed" | "bucket_mfe_p50" | "bucket_mfe_p60" | "bucket_mfe_p75"` on partials (default `"fixed"`).
   - Extend `BucketConstants` with `mfeP50`, `mfeP60`, `mfeP75` (computed from existing `loggedMfe` extraction).
   - In `replayOneTrade`, resolve each partial's effective `atR` from the bucket constant when `atRSource !== "fixed"`. If the bucket stat is null or ≤ 0, mark ineligible (`"bucket has no MFE samples for adaptive TP"`).
   - Relax the `be_after_first_tp + no partials` guard so a pure-trail preset works (the existing `trail_to_mfe` branch already handles `anyFilled=false`).
   - In `walkForwardEvaluate`, add Sharpe tiebreak when IS expectancies tie within 0.05R.
   - Lower `idealSlScale` floor from 0.2 to 0.1; emit `clampedCount` in `ReplayResult` so UI can flag it.

2. `supabase/functions/_shared/quant/pairLabSimulator.ts` — mirror all of the above.

3. `src/lib/pairLabPresets.ts` — add the 6 new entries above. Fix the "current behavior" description to read: *"Replay using each trade's recorded R-outcome at this simulator risk % — normalized P&L baseline, not actual dollars booked."*

4. `src/components/pair-lab/StrategyRanker.tsx` — no structural change; the new presets will appear in the leaderboard automatically. Add a column tooltip noting bucket-adaptive presets resolve TP per-bucket.

### Verification

- Run preview on `/pair-lab` via Playwright, screenshot the Auto-ranker leaderboard, confirm 12 rows render with no console errors and the new "All-out @3R" / adaptive presets produce sensible eligible counts.
- Spot-check `bucket_mfe_p60` math against a single bucket: open the Grid tab, pick a cell with N≥10, compare the resolved TP to the bucket's MFE p60 shown in `BucketGrid`.
- Confirm walk-forward still reports OOS and the overfit flag triggers when expected.

No DB / schema changes.
