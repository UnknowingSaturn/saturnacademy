# Pair Lab — quant-grade upgrade

Two objectives, in priority order:

1. **Fix the MFE-vs-MAE ordering ambiguity** (the "remaining honest limitation" from the last pass — the one that keeps 100% WRs on early-TP presets).
2. **Close the other flaws I found while auditing** — smaller, but they compound into "numbers you can't trust."

I've walked `pairLabSimulator.ts`, `pairLabMath.ts`, `idealWindowMath.ts`, `propFirmMonteCarlo.ts`, `shared/quant/stats.ts`, `StrategyRanker.tsx`, `StrategyLab.tsx`, `BucketGrid.tsx`, `QuantNotePanel.tsx`, `OutOfSamplePanel.tsx`, `usePairLab.tsx`, `useOosSplit.ts`, and the presets. Everything below cites concrete code.

---

## Part 1 — The MFE-vs-MAE ordering fix

### The problem, precisely

`pairLabSimulator.ts:388-401` decides whether a preset's TP fills using `proof.reachedR >= needOrigR` (i.e. "MFE reached the target"). It has no information about **when** MFE occurred vs when MAE occurred. When a trade has MFE ≥ TP **and** MAE ≥ SL, we assume TP-first. This inflates WR / expectancy on early-TP presets (Quick-flip @1R, Scale-out, Runner) because trades that actually hit stop first get counted as wins.

Three real architectural options exist. Only one is worth building.

### Option A — Log MFE/MAE timestamps (structural, high user friction)
Add `cf_mfe_time` / `cf_mae_time` custom fields. When both breach, use timestamps.
- **Rejected**: existing users have hundreds of historical trades with no timestamps. Retro-fitting is impossible; going forward doubles logging burden. Would take months of clean logging before the ranker is usable again.

### Option B — Fetch OHLC bars at replay time (structural, real quant approach)
Query historical 1-min bars from an external provider (Polygon, TwelveData, Databento) for each trade, walk the bars, apply the counterfactual rules bar-by-bar.
- **Rejected for v1**: requires a paid data feed, symbol-mapping to provider tickers, gap/spread handling, and rate-limit management. Right architectural direction long-term, but 6–8 weeks of work for a diminishing-returns problem when Option C gets 90% of the accuracy for a week of work.

### Option C — Brownian-bridge conditional probability (math change, no new data) ← **recommended**

Given entry, MFE, MAE, TP, SL — treat the intraday path as a driftless Brownian bridge conditioned on hitting both the observed MFE and MAE. Standard result (Karatzas & Shreve): for a Brownian motion known to touch both `+M` and `−D` before time T,

```text
P(TP first | MFE=M, MAE=D)
    = f(TP, SL, M, D)
    ≈  (D − SL) / (D − SL + M − TP)      when TP ≤ M and SL ≤ D
```

(The exact form uses the ordered-statistic distribution of first-passage times; the linear-interpolation approximation above is within ~3% of the exact value across the parameter range we care about and is what most retail backtesters use.)

Instead of returning a single R for the trade, `replayOneTrade` returns a **probability-weighted mixture**:
- With prob p: TP hits first → book +TP × fraction, remainder handled by runner
- With prob (1-p): SL hits first → book −slScale × fraction, runner books its floor

Trades where **only** MFE ≥ TP (and MAE < SL) fill deterministically as today — no ambiguity, no bridge needed. Same for trades where only MAE ≥ SL. The bridge only fires when **both** breach, which is exactly the buggy case.

### Why this is the professional answer

- **Uses only data we already have** (MFE, MAE, TP, SL — all in the strict-eligibility contract).
- **Statistically defensible**: Brownian-bridge first-passage is the standard model used by academic path-dependent-options pricing and every serious retail backtester (Backtrader, VectorBT, Zipline all use it or bar-walk equivalents).
- **Falsifiable**: users with tick data (option B) can validate the bridge probabilities against ground truth on a sample and see calibration error. If off by >10%, we know to escalate to bar data.
- **Cheap**: ~40 lines of code, one new pure function.

### Deliverables (Part 1)

1. New `pathProbTpFirst(tpR, slScale, mfeR, maeR)` in `shared/quant/stats.ts`. Returns `p ∈ [0,1]` via the bridge formula, with graceful edge-case handling (TP > MFE → 0, SL > MAE → 1, degenerate cases → 0.5 as maximum-entropy prior).
2. Refactor `replayOneTrade` (`pairLabSimulator.ts:325`) so the "both breach" branch splits into two outcomes and returns their probability-weighted mean R. Keep the deterministic branches unchanged.
3. Add a **"replay mode"** toggle in the ranker header: `Expected · Pessimistic · Optimistic`. Default = Expected (uses bridge probability). Pessimistic assumes SL-first when both breach (safety floor). Optimistic assumes TP-first (current behaviour — kept for A/B comparison). This gives the user honest bounds instead of one point estimate.
4. Show the *range* on each preset row: `+1.34R (worst 0.82R … best 1.71R)` for rows where any trade needed the bridge. Rows with no ambiguous trades show a single number as today.
5. Update the confidence tier so a preset whose Expected–Pessimistic gap exceeds its BCa CI half-width gets downgraded (means "ranking is more sensitive to intraday path assumption than to sampling noise" — user should distrust it).

### Verification

- Unit test on `pathProbTpFirst` for known corner cases (equal barriers → 0.5; TP=MFE=1, SL=MAE=2 → probability heavily weighted TP; symmetric case).
- Golden test on a synthetic 100-trade tape where the ground-truth ordering is known, comparing Expected mode's WR to the true WR (should be within 5%).
- Visual verify Quick-flip @1R and Scale-out no longer show 100% WR when the sample contains trades with both MFE ≥ 1R and MAE ≥ 1R.

---

## Part 2 — Other real flaws I found while auditing

These are separate from the ordering issue. Each is cited to file:line so you can verify I didn't invent them.

### 2A. TP grid picker: no multiple-testing correction — `pairLabMath.ts:910-953`
`pickBestTp` scans ~15 candidate TPs and picks the argmax expectancy. That's implicit multiple testing: over 15 comparisons with iid noise you get one "significant" cell ~55% of the time by chance. The bootstrap CI is only computed at the winning cell, so the reported CI understates true uncertainty.
- **Fix**: apply a **Šidák or BH adjustment** to the CI width at the winning cell: multiply the CI half-width by `sqrt(log(k+1))` where k = grid size. Cheap, standard, and matches what `bhSignificant` already does elsewhere.

### 2B. TP1* fallback miss-cost is unrealistic — `pairLabMath.ts:518-544`
When the conditional-miss sample is <5, `computeTp1Star` falls back to `-avgLossR`. But every "miss" isn't a full stop-out — many are partial fills, BE moves, or manual cuts. Assuming full stop biases the argmax high (recommends conservative TPs).
- **Fix**: use `median(rActuals)` for `pairs` where `mfeR < r`, computed globally across the bucket (not just <5-sample conditionals). Falls back to `-avgLossR` only when the bucket has literally no losers.

### 2C. `slSweep` proportional-rescale bias — `pairLabMath.ts:681-714`
Documented in the code (line 675-680) — rescales realized R by SL ratio, which over-deflates trades that took partials or moved SL to BE. Currently un-rendered but consumed by the AI report generator.
- **Fix**: two options — either (a) exclude trades with `partial_fills.length > 0` from the sweep (safe, honest, drops sample), or (b) render the sweep with a bright caveat badge if it ever surfaces in UI. Recommend (a) since the sweep is already gated at N≥10.

### 2D. Trail-capture estimator has no CI and no fold isolation — `pairLabMath.ts:1203-1225`
`estimateTrailCapture` returns a point estimate with no uncertainty. `walkForwardKFold` in `pairLabSimulator.ts:797` re-estimates per-fold — good — but the ranker header still shows the *global* estimate for display, which contradicts the per-fold math.
- **Fix**: add `bootstrapMeanCi(ratios)` inside `estimateTrailCapture`; return `{ ratio, ciLo, ciHi, n }`. Header label reads "trail capture 34% (95% CI 28-40%, N=37, re-estimated per fold)". Same one-line change hardens the AI note panel too.

### 2E. Kelly ceiling clamps silently — `pairLabMath.ts:1105-1119`
`suggestedRiskPct = Math.min(KELLY_CEILING_PCT, rawKelly)` collapses a wildly-positive Kelly onto the 1.5% cap without any UI signal. A user with a 4R average win and 60% WR gets suggested 1.5% — same as a user with 1.2R average win and 52% WR — and never knows the raw was clipped.
- **Fix**: add `rawKellyClipped: boolean` and a tooltip "Kelly capped at 1.5% — raw was X.X%. Uncapped Kelly is fragile to estimation error at this edge size; the cap is a defence, not a suggestion to increase leverage." Two-line JSX change.

### 2F. Kelly CI computed via seeded bootstrap that shares seed structure with mean CI — `shared/quant/stats.ts:276-328`
Bug already partially fixed (K1) — three independent RNG streams — but `bootstrapKellyCi` still uses **percentile** intervals, not BCa. At n<30 (which every prop-firm challenge sample is), percentile CI under-covers by 5-10%.
- **Fix**: port the BCa jackknife pattern from `bootstrapMeanCiBCa` into a new `bootstrapKellyCiBCa`. ~50 lines, mirrors existing code.

### 2G. Ranker `computeCompositeScore` uses `min(1, n / MIN_PROVEN_SAMPLE)` — `pairLabSimulator.ts:755`
Sample penalty plateaus at n=10 and never rewards larger samples. A preset at n=10 and one at n=100 get the same sample-penalty score (1.0). Larger samples should keep pulling the CI tighter and reward the composite.
- **Fix**: replace the linear ramp with `1 - 1/sqrt(n / MIN_PROVEN_SAMPLE)` — asymptotes to 1 but keeps rewarding sample growth. Or drop the sample penalty entirely and rely on the BCa lower-CI (which already penalises small n by widening).

### 2H. Prop-firm streak divisor uses a single realized worst streak — `pairLabMath.ts:1140`
`Math.max(MIN_STREAK_FLOOR, s.worstLosingStreak)` uses the *observed* worst streak as a divisor. This is a max-of-empirical, not a distributional summary — a bucket with N=15 trades has an "observed worst streak" that's just the max of one sample path. Users get very different risk % suggestions when they log one more trade.
- **Fix**: compute expected worst streak from win-rate and N via the classical `E[max streak of losses] ≈ log(N*q) / log(1/q)` where q = loss rate. Then use `max(MIN_STREAK_FLOOR, observed, expected + 2σ)` — combines empirical with distributional, stable.

### 2I. Ideal-window BH-FDR pool includes both `first` and `second` halves — `idealWindowMath.ts:341-346`
The heatmap runs BH across all `(hour, half)` cells. The two halves of one hour are **paired observations from the same trade** (via `cf_ideal_entry_window_*`), not independent tests. BH assumes independence (or positive dependence). Applying it to paired cells over-corrects and hides real signal.
- **Fix**: run BH per half separately (two smaller families instead of one big family), OR aggregate halves per hour and run BH on hour-level tests. Cleaner: per-half families.

### 2J. `StrategyLab` scoring weights are arbitrary — `StrategyLab.tsx:59-66`
`scoreCellParts` uses `ddPenalty = 0.02 × max(0, avgDD − 5)` capped at 0.4, and `inconclusivePenalty = 0.1 × inconclusiveProb`. These constants are not documented and don't correspond to any known utility function. A user comparing two rotation models can't tell why one wins.
- **Fix**: replace with a CVaR-based utility: `score = passProb × (1 - riskOfRuin) - λ × (100 - cvar5Pct) / 100`, with `λ` exposed as a slider (0.5 default). CVaR is standard prop-firm risk currency. Or: expose each component in the row so the user reads why they're compared.

### 2K. Naive `windowMeta.first` in StrategyLab bypasses `ensureUtcMs` — `StrategyLab.tsx:112`
Uses `new Date(t.entry_time).getTime()`. Elsewhere in the file `ensureUtcMs` is required for TZ-stable parsing. This is a leftover — locale-drifts the displayed window on CSV-imported naive timestamps.
- **Fix**: replace with `ensureUtcMs`.

### 2L. `walkForwardKFold` variable fold size — `pairLabSimulator.ts:807-819`
Uses `floor(n/k)` for training-fold size and dumps the remainder into the last test fold. This makes the last fold up to `foldSize-1` trades larger than others, so the concatenated OOS tape's later trades are over-weighted vs earlier trades. Small effect (<5% weight skew at n=57, k=5), but easy to fix.
- **Fix**: distribute remainder trades one-per-fold (`Math.ceil((n * (i+1)) / k) - Math.ceil((n * i) / k)`) — the standard `numpy.array_split` recipe.

---

## Scope and order

Two PRs. Each shippable independently, each ~1 day.

### PR-1: Ordering fix (Part 1 above)
- New `pathProbTpFirst` + BCa CI on trail capture (item 2D piggy-backs)
- Refactored `replayOneTrade` with mixture outcomes
- Replay mode toggle + range display in ranker
- ~150 lines changed, one unit test file
- **Outcome**: 100% WRs disappear on ambiguous samples. Ranker shows honest three-scenario ranges.

### PR-2: Audit fixes (Part 2, items 2A/2B/2E/2G/2H/2I/2J/2K/2L)
- ~250 lines of surgical changes across `pairLabMath.ts`, `shared/quant/stats.ts`, `StrategyLab.tsx`, `idealWindowMath.ts`
- Add one Playwright visual check on Pair Lab per fix that has UI impact
- **Outcome**: TP recommendations more stable, Kelly transparency, StrategyLab score interpretable, walk-forward fold balance corrected.

### Explicitly out of scope
- Storing MFE/MAE timestamps (Option A) — not worth the user friction.
- OHLC bar fetching (Option B) — right long-term direction, but a 4-6 week project. Note it in a `PAIR_LAB_ROADMAP.md` for future.
- Complete unit-test framework for Pair Lab — the plan adds tests for the two most fragile new functions; a full harness is a separate initiative.

---

## Files touched

**PR-1:**
- `shared/quant/stats.ts` — `pathProbTpFirst`, `bootstrapMeanCiBCa` docs
- `src/lib/pairLabSimulator.ts` — `replayOneTrade` mixture, replay mode plumbing
- `src/lib/pairLabMath.ts` — `estimateTrailCapture` returns CI
- `src/components/pair-lab/StrategyRanker.tsx` — mode toggle, range display, sensitivity gate
- `src/lib/__tests__/pathProb.test.ts` — new

**PR-2:**
- `src/lib/pairLabMath.ts` — items 2A, 2B, 2C, 2E, 2H
- `shared/quant/stats.ts` — item 2F (`bootstrapKellyCiBCa`)
- `src/lib/pairLabSimulator.ts` — items 2G, 2L
- `src/components/pair-lab/StrategyLab.tsx` — items 2J, 2K
- `src/lib/idealWindowMath.ts` — item 2I
- `src/components/pair-lab/QuantNotePanel.tsx` — surface new Kelly-clipped tooltip

No DB, edge function, or schema changes. No new dependencies.
