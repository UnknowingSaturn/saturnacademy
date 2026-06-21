# Pair Lab — completion pass

Audit of the previous implementation found everything shipped **except two B-features** from the approved scope. This plan closes the gap and validates the most consequential A0 unit fix.

## What's verified complete

- **A0 ticks→pips**: `ticksToPips()` applied at every MAE / ideal-SL read site in `src/lib/pairLabMath.ts`, `src/lib/pairLabSimulator.ts`, and shared `supabase/functions/_shared/quant/*`. Contract comments updated.
- **A1** 95% CI label, **A2** closed-only `totalTrades`, **A3** `slInitMed > 0` guard, **A4** parity (`new_york_am/pm`), **A6** raw Kelly + floor badge, **A7/A8** `be_after_first_tp` reasons + filtered `ineligibleReasons`, **A10** `sim_risk_per_trade_pct` default, **A11** Generate gated at `confidence === "low"`, **A12** Sharpe-of-R tiebreak.
- **B1** Wilson 95% CI, **B2** profit factor + payoff, **B5** Sharpe/Sortino, **B6** underwater equity, **B7** walk-forward 70/30, **B9** bootstrap Kelly CI.

## What's missing — to implement now

### B3 — MAE-based stop-loss sweep
Add `slSweep(trades, bucket)` to `src/lib/pairLabMath.ts` (+ shared edge copy). For the bucket's trades:
1. Compute MAE-in-pips per trade via `ticksToPips`.
2. Sweep candidate SL ∈ {`p25`, `p40`, `p55`, `p70`, `p90`} of MAE distribution.
3. For each candidate, replay R-multiple as: if `mae_pips > sl_cand` → `r = −1`; else `r = r_actual` scaled by `sl_init / sl_cand`. Report `% stopped`, `mean_R`, `ΔE[R]` vs current.
4. Surface in `RecommendationCard.tsx` as a compact table under the existing PF/Payoff row, with caption "Hypothetical — assumes same entry/exit logic at a different SL".

### B8 — Benjamini–Hochberg FDR badge on `BucketGrid`
Add `bhAdjust(pvals: number[], alpha=0.05)` helper in `src/lib/pairLabMath.ts`. For each bucket compute a one-sided p-value that `expectancyR > 0` from the bootstrap distribution already used for `expectedRCi` (count of bootstrap means ≤ 0 / iters). In `BucketGrid.tsx`, run BH across all displayed buckets and render a small "FDR-significant" check or muted "not significant after FDR" tag next to each bucket header. Tooltip explains: "Adjusted for multiple testing across N buckets — guards against cherry-picking."

## Verification after build
- Re-run the build (auto).
- Open `/pair-lab` via Playwright with the user's session, screenshot the Recommendation card (SL sweep table) and the BucketGrid (FDR tags), confirm no console errors.
- Spot-check a bucket: MAE p90 row should show ≤ current `% stopped`; BH tags should appear on at least the highest-expectancy bucket if any are individually significant.

## Files
- `src/lib/pairLabMath.ts` (+ `supabase/functions/_shared/quant/pairLabMath.ts` mirror)
- `src/components/pair-lab/RecommendationCard.tsx`
- `src/components/pair-lab/BucketGrid.tsx`

No DB or schema changes.
