## Pair Lab Accuracy Pass · PR-4

Goal: loosen the page exactly where it drops usable data, tighten it exactly where it over-claims comparability, and label the two cases where "safe" == "misleading". No new toggles, no server schema, no lens.

Guiding principle throughout: **soft downgrade beats hard drop.** When a trade is missing one input, use what it has and label the result — don't evict it and inflate the survivors.

---

## 1 · Two-tier eligibility across the whole page

Today every bucket / preset requires BOTH `MFE` and `MAE` (and often `ideal_stop_loss`). A trade missing one is dropped from everything, even the stats that don't need it.

Split into two pools per bucket/preset:

- **Strict pool** — has every field the metric needs. Used for expectancy, BCa CI, edge ratio, Sortino, and anything R-denominated.
- **Wide pool** — has enough to place the trade on the win/loss/stop axis (`r_multiple_actual` OR (SL + net_pnl sign) is sufficient). Used for **WR, N reported, drawdown path, sample-size chip**.

Surface both: rows show `N_strict / N_wide` (e.g. `10/18`). Confidence tiers key off `N_strict`. This alone recovers ~30-50% of trades on typical journals without weakening any R-based number.

Files: `src/lib/pairLabMath.ts` (add `nStrict` / `nWide` to `BucketReport`), `src/lib/pairLabSimulator.ts` (return both pools from `replayAllPresets`), `src/components/pair-lab/StrategyRanker.tsx` + `BucketGrid.tsx` (render the split), server twin `supabase/functions/_shared/quant/pairLabSimulator.ts` (parity).

## 2 · Tighten-SL fallback via MAE proxy

`tighten_to_ideal` currently drops any trade missing `ideal_stop_loss`. When that field is absent but `MAE` is present, we already know the answer to "would this trade have been stopped under a tighter SL?" for any `slScale ≤ loggedMae`.

Add a soft path in `computeProof`:

- If `ideal_stop_loss` exists → use it (current behaviour).
- Else if `MAE` exists → use `slScale = min(1, maeR × 1.05)` as a proxy "tightest survivable stop" and flag the trade with `slProxy: true`.
- Else → still ineligible.

Aggregate `slProxy` count per preset and show a `k proxy-tightened` chip next to the row. Trader sees exactly how much of the number is real ideal-SL vs inferred.

Files: `src/lib/pairLabSimulator.ts` (`computeProof`, row aggregate), `StrategyRanker.tsx` (chip), server twin.

## 3 · BE-after-TP runner: cap-MFE fallback instead of 0

Current `else` branch books 0R for any non-stopped, non-partial-filled trade under BE-after-TP. That's not conservative, it's inventing a zero. Replace with:

```
booked += min(reachedNewR, maxTargetAtR) × remainingFrac × 0.5
```

The 0.5 is a Bayesian discount for "we don't know where the trader would have manually exited" — half-credit the proven MFE up to the ladder cap. Matches how the trail-runner branch already handles the same situation.

Files: `src/lib/pairLabSimulator.ts:434`, server twin, one new unit test.

## 4 · Common-pool indicator + crown gate (softened Fix A)

Do NOT recompute presets on the intersection (would silently strip N from unaffected rows). Instead:

- Compute `nCommonStrict` = size of the intersection of strict-eligible IDs across all presets.
- Show each row's `N_strict / N_common` — mismatch is visible.
- **Only the crown selection** uses `nCommon` — winner must be the top row *when scored on the common pool*. Ties broken by BCa lower bound.
- If `nCommon < 15`, hide the crown banner entirely and show "No preset dominates on the common sample."

Files: `StrategyRanker.tsx`, no math changes.

## 5 · Confidence-tier N cap (softened Fix C)

Keep the current CI-width tier logic, but overlay:

- `N_strict < 20` → cap at "Low"
- `N_strict < 10` → cap at "Insufficient" (row still renders; just no tier badge)
- Crown banner hidden when winner's `N_strict < 15` (already covered by fix 4, keep both guards).

Files: `shared/quant/stats.ts` (tier helper), `StrategyRanker.tsx`.

## 6 · Hindsight badge on tighten-SL presets

Small `hindsight-annotated` chip next to any preset with `slRule: "tighten_to_ideal"`. Tooltip: "`ideal_stop_loss` is filled after the fact; the eligible sample is not random." Zero math, pure honesty.

Files: `StrategyRanker.tsx`, `pairLabPresets.ts` (add optional `sampleCaveat` field).

## 7 · Bucket-N floor on adaptive-TP presets

`resolvePartialAtR` for any `atRSource: "bucket_*"` returns `ineligible: "bucket too thin for adaptive TP (n<20)"` when `bucket.nMfe < 20`. Prevents fitting a p60 on 7 samples.

Files: `src/lib/pairLabSimulator.ts`, server twin, `pairLabMath.ts` (expose `nMfe` on bucket if not already).

---

## Tests

New `src/lib/__tests__/pairLabRobust.test.ts`:

- Two-tier: a 20-trade fixture with 12 having MFE+MAE and 8 having only MAE → strict pool N=12, wide pool N=20, expectancy from strict pool only.
- MAE-proxy tightening: trade with no `ideal_stop_loss` but MAE=0.6R gets booked correctly under tighten-2R, flagged `slProxy`.
- BE-runner floor: non-stopped non-filled trade with MFE=1.5R books `0.5 × min(1.5, 2) × 1 = 0.75R`, not 0.
- Common-pool gate: preset with N_strict < nCommon can't win the crown.
- Tier cap: BCa CI width 0.3R on N=12 → tier = "Low" (was "Medium").
- Bucket-N: preset with `bucket_mfe_p60` on 15-trade bucket returns ineligible.

Plus one server parity case per new behaviour in `serverReplayParity.test.ts`.

---

## Files touched

- `src/lib/pairLabMath.ts` · two-tier `BucketReport`, expose `nMfe`
- `src/lib/pairLabSimulator.ts` · MAE proxy, BE-runner floor, bucket-N guard, `nStrict`/`nWide` on rows
- `shared/quant/stats.ts` · N-capped tier helper
- `src/components/pair-lab/StrategyRanker.tsx` · split N column, chips, crown gate
- `src/components/pair-lab/BucketGrid.tsx` · split N in cell tooltip
- `src/lib/pairLabPresets.ts` · optional `sampleCaveat` on tighten presets
- `supabase/functions/_shared/quant/pairLabSimulator.ts` · full parity port
- New test file: `src/lib/__tests__/pairLabRobust.test.ts`
- Extended: `src/lib/__tests__/serverReplayParity.test.ts`
- `.lovable/plan.md` · PR-4 entry

## Explicitly NOT touched

BCa CI, Kelly, CVaR, Šidák TP grid, BH-FDR, walk-forward context, OOS split, `useActualOutcome` path, trail-capture estimator, StrategyLab MC worker, IdealWindow BH families. All correct.

## Size

~200 lines client, ~90 lines server parity, ~120 lines tests. `tsgo --noEmit` + full vitest + Playwright screenshot of `/pair-lab?tab=strategy` confirming: (a) rows show `N_s / N_w`, (b) tighten rows show hindsight chip, (c) crown is either present with N_common ≥ 15 or absent with "No preset dominates" message, (d) at least one preset row displays `k proxy-tightened` on a fixture with missing ideal-SL trades.