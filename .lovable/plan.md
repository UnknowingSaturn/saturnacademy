# Pair Lab Strategy Ranker — Robustness Pass

Three fixes, shipped together: consistent units, honest eligibility, and a statistically defensible ranker.

---

## 1) Units — per-column, honest, no fake conversions

**Problem.** `StrategyRanker.tsx:121` hardcodes `formatDistance(null, sl, "pips", "native", 1)` so the SL median always renders as "pips/pts" regardless of the Ticks/Pips toggle. Worse: the median is computed across mixed symbols (`slPipsSamples` in `pairLabSimulator.ts:530`), so a single number in *either* unit is geometrically meaningless when the bucket spans FX + indices.

**Fix.**

- **Per-column unit selector** in the ranker header: three chips — `Ticks · Pips · R (of initial stop)`. Applies to every distance column (SL median, IQR, MAE p75, MFE p50/60/75, per-symbol distances in the expanded row).
- **R is the default** for aggregates that cross symbols — R-multiples are the only unit that's mathematically comparable across EURUSD and NAS100. The ticks/pips chips still work, but when the bucket is multi-symbol they render as **"mixed — expand for per-symbol"** with a tooltip explaining why, and the expanded row shows a small per-symbol table (symbol · N · median in ticks · median in pips).
- **Single-symbol buckets** honour whichever chip is active with a real conversion (pass the symbol into `formatDistance` / `formatDistanceFromTicks` instead of `null`).
- Persist the chip choice per column in the existing `useDistanceUnit` store (extend the key to `pairLab.units.{sl|mae|mfe}`) so it survives reloads and syncs across tabs like today.
- Sweep the rest of Pair Lab for the same class of bug (`OverviewTab`, `QuantNotePanel`, any tooltip that formats a distance) and route every display through the unit-aware formatter.

**Result.** The "218.8 pips/pts (multi-symbol; ticks vary)" line disappears. You either see an honest R number, or a per-symbol breakdown — never a fabricated cross-symbol pip figure.

---

## 2) Eligibility — strict: MFE AND MAE required

**Problem.** The denominator (the "45" in "13/45") is `preparedTrades` = every closed non-archived trade with `net_pnl != null` (`pairLabSimulator.ts:571`). Trades logged before you tracked MFE/MAE inflate the denominator, making every preset look under-sampled and drowning real edge in noise.

**Fix.**

- New helper `rankerEligibleTrades(trades)` = closed, non-archived, `net_pnl != null`, **AND** `mae != null`, **AND** `mfe != null`, **AND** `sl_initial != null`, **AND** `entry_price != null`. This becomes the single denominator for every row in the ranker.
- Every preset now reports `X/N` against the **same N** — apples-to-apples across rows.
- **"Why excluded" panel** at the top of the ranker (collapsed by default): shows the count of trades dropped for each missing field (`missing MFE: 12 · missing MAE: 8 · missing SL: 3 · open/archived: 5`) with a "Fix in Journal" deep link that filters the journal by the missing field. Solves the "why is my sample so small" confusion permanently.
- Per-row **secondary** exclusion (unproven target, BE-after-TP with no partial, etc.) still applies inside the numerator — that's a legitimate per-preset proof requirement, not a data-quality issue. It's shown as a small "of these N, K met this preset's proof requirement" line under the row when expanded.
- The `MIN_ELIGIBLE_SAMPLE = 10` gate stays but is renamed to `MIN_PROVEN_SAMPLE` and enforced against the numerator, not the denominator. Below it: no crown, "provisional" tier, disabled walk-forward.

---

## 3) Ranker math — walk-forward + bootstrap + risk-adjusted score

**Problem today.**
- Default replay uses the entire history to both estimate bucket constants (`maeP75`, `mfeP50/60/75`, `trailCapture`) **and** score presets against those same trades → in-sample bias, adaptive presets systematically look better than they are.
- The optional walk-forward reuses a globally-estimated `trailCapture` (`pairLabMath.ts:987` comment) → leak.
- Ranking key is raw `expectancyR` — ignores variance, drawdown, and sample size uncertainty. A high-mean/high-variance preset beats a lower-mean/steady one that would actually outperform on any realistic account.

**New architecture.** Walk-forward is no longer optional; it's the ranker.

### 3a) Chronological k-fold walk-forward (k = 5)

- Sort eligible trades by `entry_time`. Split into 5 sequential blocks.
- For each fold `i ∈ {2..5}`: bucket constants (`maeP75`, `mfeP*`, `trailCapture`) are estimated on blocks `1..i-1` only; the preset is scored on block `i`. Concatenate the 4 OOS blocks → the preset's OOS trade tape.
- Block 1 is warm-up (used for estimation, never scored). Requires ≥ 25 eligible trades to run k-fold; below that, fall back to a single 70/30 split (like today's walk-forward), below 15 mark the whole ranker "provisional — need more logged trades" and disable crowning.
- All downstream metrics (expectancy, Edge R/σ, drawdown, dollars, CI) are computed on the OOS tape only.

### 3b) Risk-adjusted composite score

Replace the raw `expectancyR` sort key with:

```
score = expectancy_lower_CI × penalty(drawdown) × penalty(sample)
```

- `expectancy_lower_CI` — the 2.5th percentile of the bootstrap distribution of OOS mean R. Rewards presets whose edge is *robustly* positive, not just presets that got lucky on a small sample.
- `penalty(drawdown) = 1 / (1 + max_dd_R / risk_tolerance_R)` where `risk_tolerance_R = 10R` by default (surfaced as a slider next to the existing Risk % control).
- `penalty(sample) = min(1, n_oos / MIN_PROVEN_SAMPLE)` — smooth ramp so a preset with 8 OOS trades doesn't beat one with 30 on noise.
- Ties broken by `perTradeSortinoRatio` then `n_oos`. Prop-firm-busted presets still sort last.

### 3c) Better bootstrap

- Replace basic percentile bootstrap (`shared/quant/stats.ts:109`) with **BCa** (bias-corrected & accelerated). Under-coverage at n = 10–30 is exactly where our ranker operates; BCa is the standard fix and costs one extra jackknife pass.
- Keep the seeded RNG so results stay deterministic across renders.
- Compute CI on: expectancy R (shown), Edge R/σ (new column, "±" chip), and win% (Wilson interval — no bootstrap needed).

### 3d) Explicit uncertainty in the UI

- New column: **"Confidence"** — a 3-level chip (`High` / `Medium` / `Low`) derived from `n_oos`, CI width, and whether lower-CI > 0. Replaces the current provisional banner as the primary signal.
- The "Provisional ranking — no best yet" banner only appears when *no* preset earns `High`.
- Expanded row shows: N eligible, N OOS scored, expectancy ± BCa CI, Edge R/σ ± CI, worst-fold expectancy (stability check — if one fold dominates, flag it).

### 3e) Trail capture — estimated per-fold

Fixes the leak. In each fold, `trailCapture` is re-estimated on the training slice only (blocks `1..i-1`). Threaded through `simulatePairLabPresets` opts instead of the current global estimate in `usePairLab.tsx:297`.

---

## Scope, order, and safety

All three land in one PR because units and eligibility feed the ranker's inputs — shipping them separately would mean rewriting the ranker twice.

Implementation order inside the PR (each step keeps the app runnable):

1. Extend `useDistanceUnit` with per-column keys; add the R formatter; fix the `StrategyRanker.tsx:121` hardcode; sweep other Pair Lab surfaces.
2. Add `rankerEligibleTrades` + "why excluded" panel; wire ranker to use it as the sole denominator.
3. Refactor `simulatePairLabPresets` / `replayBucket` to accept a **precomputed** bucket context (constants + trailCapture) instead of computing them inside; this is the seam k-fold hooks into.
4. Add `walkForwardKFold` orchestrator in `src/lib/pairLabSimulator.ts`; concatenate OOS tapes; wire into `usePairLab`.
5. Replace bootstrap with BCa in `shared/quant/stats.ts`; add Wilson interval for win%.
6. New composite score + confidence chip in `StrategyRanker.tsx`; update sort, tie-breakers, banner logic.
7. Delete the old "Walk-forward" toggle in the header — it's now the only mode.

### Verification

- **Unit tests** (bun test) on `shared/quant/stats.ts`: BCa on known distributions (compare to R's `boot.ci`), Wilson interval boundaries.
- **Unit tests** on the k-fold splitter: correct block sizes, no train/test overlap, warm-up honoured.
- **Golden test**: seed a synthetic 100-trade tape with a known-edge preset and a known-noise preset; assert the edge preset wins, noise preset is `Low` confidence.
- `tsgo --noEmit` clean.
- **Playwright**: open `/pair-lab`, toggle Ticks/Pips/R chip, confirm the SL cell reformats (no more "pips/pts"); expand a preset row, confirm per-symbol breakdown appears for multi-symbol buckets; screenshot the ranker showing the Confidence column and "why excluded" panel.

## Files touched (approx.)

- `src/hooks/useDistanceUnit.tsx` — per-column keys, R formatter
- `src/components/pair-lab/StrategyRanker.tsx` — units fix, new score, confidence chip, why-excluded panel, remove walk-forward toggle
- `src/components/pair-lab/OverviewTab.tsx`, `QuantNotePanel.tsx` — units sweep
- `src/lib/pairLabSimulator.ts` — `rankerEligibleTrades`, extract bucket-context computation, `walkForwardKFold`
- `src/lib/pairLabMath.ts` — per-fold `trailCapture`
- `shared/quant/stats.ts` — BCa bootstrap, Wilson interval
- `shared/quant/config.ts` — `MIN_PROVEN_SAMPLE`, `RISK_TOLERANCE_R_DEFAULT`
- `src/hooks/usePairLab.tsx` — thread precomputed context; remove global trailCapture
- New tests under `src/lib/__tests__/` and `shared/quant/__tests__/`

No DB changes. No edge function changes. No changes to how trades are logged — this is purely a math + presentation upgrade over data you already have.
