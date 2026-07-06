## PR-4 — Pair Lab Accuracy Pass (build, landed)

Goal: loosen the page exactly where it drops usable data, tighten it exactly where it over-claims comparability, and label the two cases where "safe" == "misleading". Guiding principle: **soft downgrade beats hard drop.**

### Shipped

- **Fix 2 · MAE-proxy tightening.** `tighten_to_ideal` no longer requires the hindsight-only `ideal_stop_loss` field. When it's missing but `MAE` is logged, we derive `slScale = min(1, maeR × 1.05)` as the tightest survivable stop and mark the trade `slProxy: true`. `ReplayResult.slProxyCount` aggregates the count; the ranker shows a `k proxy-tightened` chip. Recovers real trades that the strict path silently dropped.
- **Fix 3 · BE-after-TP runner cap-MFE floor.** Non-stopped, non-filled trades under a BE-after-TP preset used to book exactly `0R` — inventing a zero. Replaced with `0.5 × min(reachedNewR, maxTargetAtR) × remainingFrac`, matching how the trail-runner branch already handles the same case. Half-credit is the honest Bayesian discount for "we don't know where the trader would have manually exited".
- **Fix 4 · Common-pool crown gate.** No preset re-scoring (would silently strip N from unaffected rows). Instead the ranker computes `nCommon = min(row.eligibleCount)` and requires `nCommon ≥ 15` AND winner `eligibleCount ≥ 15` for the crown. Otherwise the "No preset dominates on the common sample" banner renders with the current sample size.
- **Fix 5 · Confidence-tier N cap.** `confidenceFor()` now caps at `Low` when `n < 20` and at `Insufficient` when `n < MIN_PROVEN_SAMPLE`. A narrow BCa CI on 12 trades can no longer be labelled Medium/High.
- **Fix 6 · Hindsight badge on tighten-SL presets.** Any row with `slRule: "tighten_to_ideal"` now renders a small amber `hindsight` chip with a tooltip explaining that `ideal_stop_loss` is a post-hoc field and the eligible sample is not random.
- **Fix 7 · Adaptive-TP bucket-N floor.** `resolvePartialAtR` returns null for any `atRSource ∈ {bucket_mfe_p50|60|75}` when `bucket.nMfe < 20`, and the caller returns `ineligible: "bucket too thin for adaptive TP (n=X, need 20)"`. Prevents fitting a p60 on 7 samples.
- **Exclusion-panel copy fix.** The old footer claim "every preset is scored on the same strict pool so rows are directly comparable" was false the moment a tighten preset dropped a trade. Rewritten to say presets start from the strict pool and each may drop further, so users know what the per-row N column is showing.

### Server twin parity

`supabase/functions/_shared/quant/pairLabSimulator.ts` received Fixes 2 · 3 · 7 in the same shape so the AI-generated quant note doesn't diverge from the client ranker. Fixes 4 · 5 · 6 are UI-only. `BucketConstants` gained `nMfe`; the report `PresetReplayResult` shape is unchanged (no new fields exposed downstream — `slProxy` is consumed internally).

### Tests

- New `src/lib/__tests__/pairLabRobust.test.ts` — 6 tests covering: MAE-proxy tighten admits missing-ideal-SL trades and flags them via `slProxyCount`; proxy vs real ideal-SL both hit their 2R target; BE-runner floor books `0.3R` on a 0.6R MFE trade (was 0); scaled+non-stopped preserves `0.875R`; adaptive-TP refuses <20 sample buckets and admits ≥20.
- Existing 12 pathProb + 6 serverReplayParity tests unchanged.
- Full suite: 24/24 green (`bunx vitest run`). `tsgo --noEmit` clean.

### Explicitly not touched

BCa CI, Kelly, CVaR, Šidák TP grid, BH-FDR, walk-forward context, OOS split, `useActualOutcome` path, trail-capture estimator, StrategyLab MC worker, IdealWindow BH families, `BucketGrid` cell math. All correct.

### Scope note vs original plan

The proposed **Fix 1 · two-tier `N_strict / N_wide` eligibility across every page** was descoped from this PR — it required parallel replay pipelines through `pairLabMath.ts` + `BucketGrid` + the server twin, and the smaller per-preset visibility of Fixes 2 + 4 covers most of the same user need without touching bucket math. Revisit as PR-5 if users still ask "why is my WR based on 12 trades when I have 40 closed."

---

## PR-3 — Pair Lab Accuracy Pass (previously landed, kept for reference)

Skipped the "off-edge lens" (mistake-tag filter) — audit concluded hindsight-labelling bias plus a per-preset cherry-pick surface would make numbers less trustworthy, not more. Shipped the five audit-prioritised fixes instead.

### Landed
- **P0-A · server survivorship-bias fix.** `supabase/functions/_shared/quant/pairLabSimulator.ts` no longer returns early with `ineligible: "unproven target"` inside the partial loop. Trades that hit some rungs but not all now fall into the runner block and book their honest outcome — matching the client. The AI quant note stops inflating WR/expectancy on multi-TP presets (10–40% depending on ladder shape).
- **P0-B · server Brownian-bridge ordering mixture.** Ported `pathProbTpFirst` + `resolveTpFirstProb` from `shared/quant/stats.ts` into the server twin. Ambiguous "both TP and SL breached" trades are now blended per the same bridge probability the client uses. `replayAllPresets` accepts `opts.replayMode` (expected · optimistic · pessimistic), default expected.
- **P1-A · fold-sort chronology fix.** `preparedTrades` and `rankerEligibleTrades` now sort by `ensureUtcMs(entry_time)` instead of `String.localeCompare`. Mixed CSV+ISO timestamp datasets no longer scramble fold boundaries.
- **P1-B · OOS panel: disable embedded walk-forward.** `BuildBucketsOpts` gained `disableWalkForward?: boolean`; `oosSplit.worker.ts` passes `true` on the test half.
- **P2-A · BucketGrid FDR transparency.** `fdrFor` no longer hides `ns` on negative-E cells.
