## Scope confirmed: ship everything (Section A + Section B), plus a new critical fix from your MAE-units answer.

---

## A. Data-accuracy fixes

**A0 — NEW (critical): MAE and Ideal-SL are stored in TICKS, not pips.**
`src/lib/pairLabMath.ts:400-407` and `:411-417` divide the raw value by `slDistancePips`, which is wrong by the tick/pip ratio (10× for 5-digit FX). Same in `src/lib/pairLabSimulator.ts:141-146` (`tradeMaeR`) and `:149-154` (`idealSlScaleFor`). Effect today:
- `maeP75Pips` is ~10× too small on FX → "suggested SL pips" is ~10× too tight → trades look "barely losing" when they actually got stopped.
- `tradeMaeR` and stop-out detection (`pairLabSimulator.ts:202-208`) under-report MAE in R → trades that hit −1R look like −0.1R → strategy replays falsely "survive" and overstate expectancy.
- `idealSlScale` is ~10× too small → "tighten to ideal" preset uses an unrealistically tight SL → again, fake survival.

Fix: introduce a `ticksToPips(symbol, ticks) = ticks * tickSize / pipSize` helper in `src/lib/symbolMapping.ts` and apply at every MAE/ideal-SL read site (frontend + `supabase/functions/_shared/quant/*`). Update the contract comment at `pairLabMath.ts:24` from "PIPS" to "TICKS". One-line backfill note in the changelog; no DB migration since the raw values stay as-is.

**A1** — `RecommendationCard.tsx:142`: change `"90% CI"` label to `"95% CI"`.
**A2** — `usePairLab.tsx:160`: count only `!is_open` trades for `totalTrades`.
**A3** — `pairLabMath.ts:436`: add `&& slInitMed > 0` guard before `idealMed / slInitMed`.
**A4 — Parity** between `src/lib/pairLab*.ts` and `supabase/functions/_shared/quant/pairLab*.ts`:
   - Lift the frontend math into the shared module; re-export from both sides.
   - Prop-firm cap: keep the empirical-streak formula (frontend's) as canonical.
   - Bootstrap iters: standardize at 500.
   - Use `resolveSym()` in the shared `buildBuckets`.
   - Add `new_york_am/pm` to the frontend session map.
**A5** — `pairLabMath.ts:499-501`: rename `p70/p50/p25` to `pConservative/pMedian/pAggressive` (or `q30/q50/q75`) to match the actual quantile args.
**A6** — `pairLabMath.ts:201`: instead of silent `Math.max(0.25, ...)`, return the raw value and let the UI render a "below 0.25% floor — edge too thin" badge. Update `RecommendationCard` to show it.
**A7** — `pairLabSimulator.ts:327`: when `runner === "be_after_first_tp"` and `!anyFilled` and `!stoppedUnderNewSl`, mark `ineligible: "BE-after-TP runner requires at least one partial"` instead of booking 0R.
**A8** — `pairLabSimulator.ts:549-553`: filter `ineligibleReasons` in the matched-sample path to reasons triggered on trades actually dropped from the intersection (track per-trade which strategy excluded it, count only intersection-dropped trades).
**A9** — already covered by A0 (the stale comment turns out to be the *correct* unit; the contract comment was wrong).
**A10** — `useSimulatorProfile.tsx` + `usePairLab.tsx:129`: use the profile's `sim_risk_per_trade_pct` as the **default value** of the Ranker/Compare slider on mount; mark this as "from your simulator profile".
**A11** — `QuantNotePanel.tsx:114`: disable Generate when `bucket.confidence === "low"` (i.e. N < 15), with a hint tooltip.
**A12** — `pairLabSimulator.ts:83`: tiebreak in Ranker sort by `expectancyR / std(R)` (computed from the new Sharpe field in B5), then by N.

## B. Quant features (all 9)

**B1 — Wilson 95% CI on binomial proportions.** Add `wilsonCi(k, n)` to shared module. Apply to `winRate`, `tp1Star.hitRate`. Render as `62% [40% – 81%]` in `RecommendationCard` and the bucket grid hover.
**B2 — Profit factor and payoff ratio.** Add to `BucketStats`: `profitFactor = sum(winR) / sum(lossR_abs)`, `payoffRatio = mean(winR) / mean(lossR_abs)`. Chip them on `RecommendationCard` next to expectancy.
**B3 — MAE-based stop-loss sweep.** After A0 fix, replace the single `suggestedSlPips` heuristic with a sweep over SL distances `[p25_MAE_pips … p90_MAE_pips]` (5 steps). For each, compute `% trades stopped = fraction with MAE_pips > SL` and `ΔE[R] = expectancy under the new SL`. Return `slSweep: Array<{ slPips, stoppedPct, expectancyR }>`. Render as a tiny sparkline + table row in `RecommendationCard`; mark the existing point recommendation as "default pick".
**B4 — Empirical trail-capture ratio.** Replace constant `TRAIL_CAPTURE_FRAC = 0.8` with `estimateTrailCapture(trades) = median(r_actual / MFE)` over trades with both present and `r_actual > 0` and `MFE > r_actual` (so we exclude all-out exits at TP). Cache per `usePairLab` render, fall back to 0.8 when sample < 10. Pass into `replayBucket` opts; surface the chosen value + sample N in the Simulator header as "trail capture: 0.74 (N=42)".
**B5 — Sharpe/Sortino on simulated R series.** In `pairLabSimulator.ts:buildResult`, compute `sharpeR = mean(rs)/std(rs)` and `sortinoR = mean(rs) / downsideStd(rs)`. Add to `ReplayResult`. Show in `StrategyRanker` and `StrategyCompare` next to expectancy.
**B6 — Underwater equity in `EquityCurveOverlay`.** Add a second small chart below the equity curves: `equity[i] - runningMax(equity[0..i])`, filled negative area. One series per strategy with the same color.
**B7 — Walk-forward split in StrategyRanker.** Add a toggle "Walk-forward (70/30 by entry_time)". When on: choose the winning preset on the first 70% of chronologically sorted trades, then report its expectancy + Sharpe on the held-out 30%. Show both numbers side-by-side; flag overfit when `oosExpectancy < 0.5 × isExpectancy`.
**B8 — Multiple-testing badge on the grid.** For each per-cell bucket, compute the one-sample t-stat `(expectedR - baseline.expectedR) / (sd / sqrt(n))` and a p-value (use a normal approximation; ok for n≥10). Apply Benjamini–Hochberg at q=0.10 across all cells. Render a small "★ survives BH" badge in `BucketGrid` for cells that pass; otherwise show "n.s." chip.
**B9 — Kelly fraction CI.** Bootstrap the quarter-Kelly value (resample trades, recompute winRate/avgWin/avgLoss/Kelly per resample) at 500 iters. Add `suggestedRiskPctCi: [number, number] | null` to `BucketRecommendation`. Render `0.8% [0.1% – 1.6%]` on the card.

## C. Open questions (answered)

1. **MAE units = TICKS** → drives A0 (above).
2. **r_actual gross vs net** — unknown. Action: add a one-sentence footnote in `RecommendationCard` ("R metrics use `r_multiple_actual` from your trade log; if your import populates this from gross P&L, expectancy slightly overstates net.") so users can interpret. No code branch.
3. **Partial fills** — unknown. Action: detect by grouping `trades` on `(account_id, symbol, entry_time)` and counting rows per group. If >1, show a Pair Lab banner "Detected N trades with possible partial-fill rows; aggregation not yet implemented." Defer the actual aggregation to a follow-up plan when you confirm whether your import does split or consolidate.

## Files touched

```text
src/lib/symbolMapping.ts                         ── add ticksToPips
src/lib/pairLabMath.ts                           ── A0/A1-A6, B1, B2, B3, B8, B9 + lift to shared
src/lib/pairLabSimulator.ts                      ── A0, A7, A8, A12, B4, B5
src/hooks/usePairLab.tsx                         ── A2, A10, B3/B4 wiring, partial-fill detector
src/hooks/useSimulatorProfile.tsx                ── A10
src/pages/PairLab.tsx                            ── partial-fill banner, walk-forward toggle
src/components/pair-lab/RecommendationCard.tsx   ── A1, A6, B1, B2, B3, B9
src/components/pair-lab/BucketGrid.tsx           ── B8 badge
src/components/pair-lab/QuantNotePanel.tsx       ── A11
src/components/pair-lab/StrategyRanker.tsx       ── A12, B5, B7
src/components/pair-lab/StrategyCompare.tsx      ── A8 tooltip, B5
src/components/pair-lab/EquityCurveOverlay.tsx   ── B6 underwater chart
supabase/functions/_shared/quant/pairLabMath.ts        ── re-export from shared (A4)
supabase/functions/_shared/quant/pairLabSimulator.ts   ── re-export from shared (A4)
supabase/functions/generate-report/index.ts            ── pick up new fields if surfaced
supabase/functions/pair-lab-report/index.ts            ── pick up new fields if surfaced
```

No DB migrations. No new dependencies.

## Validation after shipping

- Open Pair Lab on an FX bucket with MAE-logged trades → confirm `suggestedSlPips` jumped ~10× (this is the visible signature of A0).
- Pick a bucket with N≥20: `winRate`, `tp1Star.hitRate`, `Kelly%` all render with CI brackets (B1, B9).
- Compare two strategies: Sharpe column populated, tiebreaker uses it, underwater chart renders (A12, B5, B6).
- Walk-forward toggle splits trades by `entry_time` and shows OOS expectancy (B7).
- Edge function `pair-lab-report` returns the new fields end-to-end.

Calling this big — let me know to proceed or trim, otherwise approving ships all of it in one pass.