# PR-5 · Pair Lab accuracy, parity, and hygiene pass

Two independent audits (math/simulator and UI/pipeline) produced 27 findings. Each fix below cites the exact file:line I verified. Speculative or "might-bias" items are listed under **Deferred** with the reason.

## Blocker

### B1 · Brownian-bridge SL-first branch over-stops filled partials
`src/lib/pairLabSimulator.ts:513-525` and server twin `supabase/functions/_shared/quant/pairLabSimulator.ts` (same block).
When a partial has already filled AND the trade later stops, the bridge blend uses `bookedSlFirst = -slScale` — a **whole-position** stop — and overwrites the running `booked` (which already includes the filled partials). Correct SL-first counterfactual books the filled partials at their TPs plus `-slScale × remainingFrac` for the runner only.
Fix: replace `bookedSlFirst = -slScale` with
`bookedSlFirst = filledBooked + (-slScale) × remainingFracAtBridge`, where `filledBooked` is the running sum of `p.atR * take` (tracked separately from the runner books). Mirror in the server twin. Add a test in `pairLabRobust.test.ts` covering "partial filled → runner stopped, bridge fires".

## High

### H1 · QuantNote AI payload sends deprecated field names → SL-drift data silently dropped
`src/components/pair-lab/QuantNotePanel.tsx:63-64` sends `idealSlMedian` / `slInitialMedian`; edge function `supabase/functions/pair-lab-report/index.ts:44` expects `idealSlMedianPips` / `slInitialMedianPips`. Confirmed via rg.
Fix: send the `*Pips` names. Delete the deprecated writes in `src/lib/pairLabMath.ts:812-814` and the aliases in `pairLabMath.ts:140-146`. Update the fallback read at `pairLabMath.ts:1075` and `QuantNotePanel.tsx:216` to canonical names only.

### H2 · Server↔client math parity — three cases diverge
All three widen server CIs / recommendations relative to client, so a "validated" server bucket may show "low" on the client.
- **H2a** Server `pickBestTp` uses plain percentile CI; client uses BCa + √log(k+1) widening. `supabase/.../pairLabMath.ts:376-382` vs `src/lib/pairLabMath.ts:986-995`.
- **H2b** Server Kelly CI calls `bootstrapKellyCi` (percentile) while client calls `bootstrapKellyCiBCa`. `supabase/.../pairLabMath.ts:582` vs `src/lib/pairLabMath.ts:1175`.
- **H2c** `computeTp1Star` miss-cost fallback: server uses `-|avgLossR|`; client uses `globalMedian` of `rActual` when <5 misses. `supabase/.../pairLabMath.ts:251-253` vs `src/lib/pairLabMath.ts:561-563`.
Fix: port the BCa helpers, TP-grid widener, and `globalMedian` fallback into the server twin. Extend `serverReplayParity.test.ts` to cover the TP-grid widening and Kelly BCa paths.

### H3 · Prop-firm streak formula diverges
`supabase/.../pairLabMath.ts:601-605` uses `max(MIN_STREAK_FLOOR, worstStreak)`; client blends with `log(N·q)/log(1/q)` distributional bound. Fix: port client formula to server.

### H4 · `all_out_at_last_partial`, not-stopped, no-fill: books positive R when the rule would have exited at SL
`src/lib/pairLabSimulator.ts:487-491` (and server parity line 304). A trade that never touched the last-partial TP would, under this rule, have ridden to the stop — it should book `-slScale × remainingFrac`, not `min(reachedR, maxTargetAtR) × remainingFrac`.
Fix: change the no-fill branch to `-slScale × remainingFrac` (matches the same rule's stopped branch already at line 465). Add a targeted test.

## Medium

### M1 · Simulator ↔ bucket population mismatch
`replayAllPresets` gates on `net_pnl != null` (`supabase/.../pairLabSimulator.ts:361` and `src/lib/pairLabSimulator.ts:707-710`). `buildBuckets` deliberately removed that gate (S2.1). Fix: apply the same gate in `buildBuckets` OR drop it from the simulator — pick one and document. Recommendation: keep it in simulator (needs realised $ for equity curves), drop it from bucket stats (already the case), but log an `unrealizedExcluded`-style counter for the simulator so UI can display the split honestly.

### M2 · OOS panel scope drift
`src/components/pair-lab/tabs/StrategyTab.tsx:153` passes full `data.trades` to `OutOfSamplePanel` while Ranker/Lab get `scopedTrades`. When a bucket cell is selected the OOS panel silently answers a different question. Fix: pass `scopedTrades` (or add a visible "portfolio-wide" label + selector).

### M3 · OOS tooltip stale
`src/components/pair-lab/OutOfSamplePanel.tsx:251` says "≥5 trades each side"; the worker gates at 10 (`src/workers/oosSplit.worker.ts:78`). Fix: update copy to "≥10".

### M4 · `StrategyRanker` runs three synchronous bootstrap passes on the main thread
`src/components/pair-lab/StrategyRanker.tsx:309-333`. Blocks the event loop on walk-forward slider drags. Fix: offload the `replayMode` × 3 sweep to the existing worker (or a new `strategyRanker.worker.ts`), keeping the main-thread path as a fallback. This is a real UX defect but a bigger change — flag it as a self-contained PR-5b if scope is a concern.

### M5 · `IdealWindowHeatmap` `bucketTrades` missing `is_open` guard
`src/lib/idealWindowMath.ts:239` and `:382`. Currently safe because callers pre-filter, but the math function isn't defensive. Fix: add `if (t.is_open) continue;` in both spots — one-line defensive change.

### M6 · `extractRSample` missing `isUnrealized` guard
`src/lib/propFirmMonteCarlo.ts:379-392`. Same defensive gap — safe today because `usePairLab` pre-filters, but breaks if a caller ever passes raw trades. Fix: add the guard.

### M7 · Server `ReplayOutcome` drops `slPips`/`slScale`
`supabase/functions/_shared/quant/pairLabSimulator.ts:124`. Server AI note loses "median applied SL distance" datum. Fix: extend server `ReplayOutcome` to `{ r, slPips, slScale, slProxy }` and thread through `PresetReplayResult` like the client does.

### M8 · Server per-fold trail-capture look-ahead
`supabase/.../pairLabSimulator.ts:125-133` bakes trail capture into `BucketConstants` at the outer scope; client re-estimates per fold on IS-only. Fix: move server trail-capture estimation into `replayBucket`/per-fold context, matching client `ctxFor`.

### M9 · Test-coverage gap for server `tighten_to_ideal` path and for the bridge-blend blocker
`serverReplayParity.test.ts` covers only P0-A / P0-B; PR-4 Fix 2/3/7 have no server parity test. Fix: add server parity tests for MAE-proxy, BE-runner floor, adaptive-TP bucket-N guard, and the B1 bridge case above.

### M10 · `bootstrapKellyCi`/`BCa` skip degenerate draws without accounting
`shared/quant/stats.ts:318-319`. `continue` on `w=0`/`w=n` shrinks effective iters silently. Not a blocker but the reported CI is slightly wider than the code claims. Fix: draw-until-non-degenerate with a max-retry cap, or record and report the effective `iters`.

## Low (cleanup — batch into one commit)

### L1 · Delete deprecated aliases after H1
`src/lib/pairLabMath.ts:140-146, 812-814` — remove `idealSlMedian`/`slInitialMedian` from the type and payload. Only safe once H1 lands.

### L2 · De-duplicate `estimateTrailCapture` / `estimateTrailCaptureLocal`
`src/lib/pairLabMath.ts:1270-1292` vs `src/lib/pairLabSimulator.ts:887-903` — byte-identical. Delete the local copy, import the public one.

### L3 · Delete dead exports
- `walkForwardEvaluate` in `src/lib/pairLabSimulator.ts:1058-1133` — no external callers.
- Unused server-side `bootstrapKellyCi` export path if H2b lands (server switches to BCa).

### L4 · `pairLabPresets.ts:121` — `atR: 1` placeholder on `adaptive-mfe-p60` is unreachable
Runtime overrides it via `resolvePartialAtR`; unresolved → ineligible. Either delete the placeholder (nullable) or add a comment. Recommend delete + type nullable to prevent misuse.

### L5 · Server preset "current" carries a ghost partial
`supabase/.../pairLabSimulator.ts:43-44` — `[{ atR: 1, fraction: 1 }]`. Overridden by `useActualOutcome: true` but AI note builder reads it. Fix: `partials: []` to match client.

### L6 · `computeBucket` redundant sort in `longestLossStreak`
`src/lib/pairLabMath.ts:500-517` re-sorts an already-sorted slice. Pass the sorted `events`.

### L7 · Copy honesty
- `OverviewTab.tsx:381-385` — add "closed, realised" qualifier next to baseline `N`.
- `OutOfSamplePanel.tsx:251` — see M3.

## Performance (measure first, then fix)

### P1 · `buildBuckets` recomputes bootstraps per cell (n cells × 1000 iters)
`src/lib/pairLabMath.ts:459-479`. On 10 symbols × 4 sessions, 41 passes per render. Fix candidates: memoize per `(scope, filterKey)`; move `buildBuckets` behind the existing `usePairLab` cache with a stable key; run the whole call in the OOS worker on large datasets. Instrument first with `performance.mark` before choosing.

### P2 · `pickBestTp` recomputes for baseline + walk-forward IS slice
`src/lib/pairLabMath.ts:946-999`. Cache result by `(rows-hash, tpGrid-hash)` within a single `computeBucket` chain.

### P3 · `buildBucketConstants` called `k × |strategies|` times in `rankStrategies`
`src/lib/pairLabSimulator.ts:936`. Memoize by fold slice hash.

## Not touching (deferred with reason)

- **Finding 6 (BH-FDR on one-sided bootstrap p)** — the concern is theoretical; empirically the floor at `1/iters` matches how the recommendation UI treats "strong effect" buckets. Leaving alone until we have a reproducible false-positive.
- **Finding 11 (trail-capture middle-band bias)** — impossible to correct without tick data; already documented as a proxy. No change beyond adding a note in the tooltip if it isn't there.
- **Finding 5 (`walkForwardEvaluate` 5-trade minimum)** — deleting via L3 removes the inconsistency without a math change.

## Verification

- `bunx vitest run src/lib/__tests__/pairLabRobust.test.ts src/lib/__tests__/serverReplayParity.test.ts` green after each fix cluster.
- `tsgo --noEmit` clean.
- Playwright: open `/pair-lab?tab=strategy`, screenshot Ranker + OOS after selecting a bucket cell to confirm M2 fix.
- Manual: send one QuantNote request post-H1, confirm the edge function receives non-null `ideal_sl_median_pips` (add a log line during verification, revert after).

## Order of execution

1. **B1 + H4** (simulator correctness) with tests — biggest single expectancy correction.
2. **H1 + L1** (payload + alias deletion) — one PR, unblocks server AI note.
3. **H2a/b/c + H3 + M7 + M8 + M9** (parity + server tests) — one PR, brings server twin back to spec.
4. **M1, M2, M3, M5, M6, M10** (data-honesty + defensive) — small PR.
5. **L2-L7** (cleanup) — one PR.
6. **M4** (worker offload) — separate PR after 1-5.
7. **P1-P3** — only after instrumenting; may be deferred if perf is acceptable.

## Not in scope

No new features. No changes to preset library semantics beyond L4/L5 hygiene. No schema changes. No changes to `usePairLab`'s filter contract.
