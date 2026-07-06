# Pair Lab Accuracy Pass — PR-3

## Verdict on the "off-edge lens" idea

Skip it. The audit confirms three problems that would make it hurt more than help:

1. **Hindsight-labelling bias.** Mistake tags are assigned after outcome; losers get tagged far more often than winners for identical process. Filtering them out inflates expectancy without a real edge improvement.
2. **Cherry-pick risk.** Any per-preset lens breaks Ranker comparability, which is its whole purpose.
3. **Doesn't move the needle.** The audit found five concrete accuracy issues elsewhere that dominate any signal a mistake filter would produce — including two server bugs that are silently inflating the AI-generated quant note by 10–40% depending on preset shape.

Instead this PR ships the fixes that actually change decisions users make.

## What we're fixing (priority order)

### P0-A. Server replay is missing the survivorship-bias fix
`supabase/functions/_shared/quant/pairLabSimulator.ts` still contains an early `return { ineligible: "unproven target" }` (line 236) that the client removed months ago. Any multi-TP preset on the server drops winners that didn't reach the top rung. The AI quant note is generated from these biased numbers.

**Fix:** port the client's runner-block outcome logic (`src/lib/pairLabSimulator.ts:406–440`) verbatim: when a partial's TP isn't breached AND the trade isn't stopped, do not return — fall into the runner block and book the honest outcome.

### P0-B. Server replay is missing the PR-1 Brownian-bridge mixture
The server always assumes TP-first on ambiguous trades (both TP and SL breached inside the bar). Early-TP presets look ~10–30% better than they are in the AI note.

**Fix:** import `pathProbTpFirst` from `shared/quant/stats.ts` (already Deno-importable) and copy the mixture block from `src/lib/pairLabSimulator.ts:469–481` into the server file's `replayOneTrade`.

### P1-A. Fold sorts use `localeCompare` instead of `ensureUtcMs`
`StrategyRanker.tsx:662` (`preparedTrades`) and `:753` (`rankerEligibleTrades`) sort chronologically with `String(...).localeCompare(...)`. The `T` separator (ISO) sorts after the space separator (CSV) in ASCII. Users who mix CSV imports with broker-API trades get fold boundaries scrambled by days-to-weeks — the walk-forward badge is meaningless in that case and the OOS delta is contaminated.

**Fix:** replace both comparators with `ensureUtcMs(a.entry_time) - ensureUtcMs(b.entry_time)`. Two one-line changes.

### P1-B. OOS panel double-nests walk-forward inside the test slice
`OutOfSamplePanel` calls `buildBuckets` on each half, which internally runs `runWalkForward` inside the test slice. The displayed "Test E[R]" is a 70/30 split within the held-out data, not the naive OOS performance a user expects. This understates degradation and weakens overfit detection.

**Fix:** add `disableWalkForward?: boolean` to `BuildBucketsOpts`; pass `true` from the OOS worker on the test half; `computeBucket` skips `runWalkForward` when set. Three-layer flag threading, no math change.

### P2-A. BucketGrid hides `ns` badges on negative-E cells
`fdrFor` at `BucketGrid.tsx:280` gates on `b.expectedR > 0`, but the BH family (line 268) correctly includes both positive and negative cells. Users see only the winners and cannot see that four negative cells were part of the correction denominator — which explains why the significance bar was harder to clear.

**Fix:** remove the `!(b.expectedR > 0)` gate so negative cells show `ns`. One line.

## What we are NOT changing
- Kelly / CVaR / BCa math — audit confirmed they degrade correctly at small n and edge cases.
- Šidák TP-grid width — over-corrects in the safe direction (audit note: plan.md overclaims "Šidák" but the effect is fine).
- BH-FDR family construction on the Ideal Window — audit confirms per-half is the right split.
- Trail-capture estimator — client/server confirmed identical, single source in `shared/quant/config.ts`.
- `StrategyLab` scoring — G3 CVaR utility is complete and handles the no-breach / positive-CVaR edge cases without crashes.
- No changes to `QuantNotePanel` UI. P0-A and P0-B fix its inputs; the component itself is fine.
- No off-edge lens, no mistake-tag filter, no per-preset toggles.

## Technical details

### Files touched
- `supabase/functions/_shared/quant/pairLabSimulator.ts` — P0-A + P0-B
- `src/components/pair-lab/StrategyRanker.tsx` — P1-A (two sort comparators)
- `src/lib/pairLabMath.ts` — P1-B (add `disableWalkForward` to `BuildBucketsOpts`, honor in `computeBucket`)
- `src/workers/oosSplit.worker.ts` — P1-B (pass flag on test half)
- `src/components/pair-lab/BucketGrid.tsx` — P2-A (remove sign gate)
- `src/lib/__tests__/serverReplayParity.test.ts` — new; asserts server and client `replayAllPresets` produce identical `expectancyR` and `nEligible` on a fixture

No DB migrations, no edge-function API changes, no new dependencies, no schema changes. Estimated ~120 lines total, ~80 of which are the server port (mostly copy-paste from the client twin).

### Verification
1. `tsgo --noEmit` clean on both src and supabase/functions.
2. `bunx vitest run src/lib/__tests__/serverReplayParity.test.ts` green — server and client `replayAllPresets` agree to 1e-9 on a synthetic 200-trade fixture that includes ambiguous MFE/MAE cases and multi-TP presets.
3. `bunx vitest run` — existing `pathProb.test.ts` still green.
4. Playwright on `/pair-lab?tab=strategy`:
   - Compare Ranker expectancy for `runner` and `scale-out` presets before and after — should not change (client wasn't broken; the delta is server-only).
   - Force a mixed-timestamp fixture in a test account, verify the walk-forward fold boundaries land on the correct calendar dates after the sort fix.
5. Playwright on the AI quant note (Reports flow that calls `pair-lab-report`): confirm the returned per-preset `expectancyR` for `scale-out` and `runner` presets matches the client Ranker within numerical tolerance.

## Why this is the "quant-honest" move

Every fix above tightens a number the user already sees, without adding a new toggle they can misuse. No hindsight-adjusted counterfactuals, no cherry-pick surface, no new UI complexity — just the client and server telling the same story, folds actually respecting chronology, OOS actually being out of sample, and FDR denominators being visible. That is what "more accurate without complicating things" looks like.
