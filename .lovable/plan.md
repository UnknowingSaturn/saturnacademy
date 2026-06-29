
# Phase S4 — Pair Lab Root-Cause Remediation

Audit found **18 cited issues** (2 critical, 6 high, 7 medium, 3 low). Plan groups them into 10 atomic, low-risk changes. Every fix is a minimal surgical edit — no architecture changes, no regressions to Phases R/S1/S2/S3.

---

## Critical

### S4.1 · Trade-fetch silent truncation at 1,000 rows
`src/hooks/useTrades.tsx:27`

PostgREST caps unbounded selects at 1,000 rows; ordered DESC, this drops the oldest trades. Every Pair Lab metric (buckets, Kelly, OOS, walk-forward) silently misses history once a user crosses 1,000 closed trades.

**Fix:** Loop with `.range(offset, offset+999)` until short page, cap at 25,000 to bound memory. Expose `truncated: boolean` from the hook and show a header chip "Loaded N of M trades" when hit.

### S4.2 · Sweep all remaining `Date.parse` / `new Date(string)` on trade timestamps
`pairLabMath.ts:969`, `idealWindowMath.ts:120, 210, 242, 362, 371`, `usePairLabTradeBounds.ts:29`, `propFirmMonteCarlo.ts:400`

`Date.parse("2024-03-15 09:30:00")` is host-locale-dependent (Chrome=local, Safari/Node=UTC). Causes OOS split drift, wrong hour-bucket assignment in heatmap, wrong slider bounds, and locale-dependent block-bootstrap order for Monte Carlo.

**Fix:** One sweep replacing each call site with `ensureUtcMs(...)` (already exported from `shared/quant/stats`). Edge already uses `ensureUtcMs` — this brings client to parity.

---

## High

### S4.3 · `matchesScope` string-compare date filter
`src/hooks/usePairLab.tsx:270-273`

Compares naive timestamp strings against ISO `dateFrom/dateTo`. Space < `T` in ASCII, so naive strings incorrectly fall outside the window. `scopedTrades` returned to StrategyLab and drill-downs diverge from `buildBuckets` (which uses `ensureUtcMs`).

**Fix:** Convert `ts`, `dateFrom`, `dateTo` via `ensureUtcMs` and compare epoch ms with `Number.isFinite` guards.

### S4.4 · Kelly mixes population win-rate with R-subsample payoff
`src/lib/pairLabMath.ts:1099-1101` (mirror in edge)

`s.winRate` uses all closed trades; `avgWinR`/`avgLossR` use only trades with explicit `r_multiple_actual`. When R-coverage is partial, Kelly is biased. `avgLossR` silently defaults to 1 when no losing R exists.

**Fix:** Compute `rWinRate = winR.length / (winR.length + lossR.length)` and pass it to `rawQuarterKellyPct`. Add `rCoverageWarning` flag when coverage < 50%. Mirror in `supabase/functions/_shared/quant/pairLabMath.ts`.

### S4.5 · Edge AI prompt reads deprecated field names → null SL commentary
`supabase/functions/pair-lab-report/index.ts:163-165`

Client sends `idealSlMedianPips`/`slInitialMedianPips` (S2.2 rename) but handler destructures `b.idealSlMedian`/`b.slInitialMedian` → `undefined`. AI omits SL drift commentary.

**Fix:** Rename `BucketInput` fields + destructuring to the new names.

---

## Medium

### S4.6 · `all_out_at_last_partial` runner books TP price instead of SL
`src/lib/pairLabSimulator.ts:383-384`

When stopped after a partial fill, runner books `lastFilledAtR * remainingFrac` — economically the runner exited at the SL, not the previous TP. Overstates expectancy.

**Fix:** Change to `booked += -slScale * remainingFrac` inside the `stoppedUnderNewSl && anyFilled` branch.

### S4.7 · TP-grid ceiling uses floor-indexed p95, biased high for small n
`src/lib/pairLabMath.ts:916` + edge mirror

For n≤20, `Math.floor(0.95 × n)` returns the array max — TP grid overfits to a single outlier MFE.

**Fix:** Replace with already-imported `quantile(sortedMfe, 0.95) ?? 4`. Apply same fix on edge.

### S4.8 · Verifier filter misses `isUnrealized` predicate
`scripts/verify_pair_lab_math.ts:96`

Verifier passes idea/paper/missed/manual-dismiss trades through while `buildBuckets` excludes them → spurious n divergences, masked real divergences.

**Fix:** Import `isUnrealized` and add `&& !isUnrealized(t)` to the predicate.

### S4.9 · Duplicate `wilsonCI95` in Monte Carlo module
`src/lib/propFirmMonteCarlo.ts:363-371`

Local copy of `wilsonCi` from `shared/quant/stats`. Drift risk on z-value changes.

**Fix:** Delete local fn, import + call `wilsonCi(...)` from shared.

### S4.10 · Cleanup: dead `exitRule` on "current" preset + stale JSDoc
`src/lib/pairLabPresets.ts:10-14`, `src/hooks/usePairLab.tsx:89`

"current" preset's `exitRule` is dead under `useActualOutcome:true`. JSDoc claims trail-capture default 0.8; actual constant `TRAIL_CAPTURE_FALLBACK = 0.7`.

**Fix:** Set `exitRule: { partials: [], runner: "be_after_first_tp" }` with comment, and update JSDoc to reference `TRAIL_CAPTURE_FALLBACK` symbolically.

---

## Low (deferred — flagged for future, no code changes this phase unless trivial)

- **L1** — Edge `BucketReport` missing `slSweep`. Add only when server-side SL sweep consumer lands.
- **L2** — `brokerDst.ts:98` `Math.round` truncates half-hour IANA offsets. Currently no half-hour zone used; leave a TODO.
- **L3** — `WARNED_SESSIONS` Set leaks across Deno isolates. Cosmetic logging only.

---

## Files Touched

```text
src/hooks/useTrades.tsx                              S4.1
src/hooks/usePairLab.tsx                             S4.3, S4.10 (JSDoc)
src/hooks/usePairLabTradeBounds.ts                   S4.2
src/lib/pairLabMath.ts                               S4.2, S4.4, S4.7
src/lib/idealWindowMath.ts                           S4.2
src/lib/propFirmMonteCarlo.ts                       S4.2, S4.9
src/lib/pairLabSimulator.ts                          S4.6
src/lib/pairLabPresets.ts                            S4.10
src/pages/PairLab.tsx                                S4.1 (header chip)
supabase/functions/_shared/quant/pairLabMath.ts      S4.4, S4.7
supabase/functions/pair-lab-report/index.ts          S4.5
scripts/verify_pair_lab_math.ts                      S4.8
```

## Verification

- Typecheck via `tsgo` after each cluster (Critical, High, Medium).
- Run `scripts/verify_pair_lab_math.ts` after S4.4/S4.7/S4.8 to confirm client/edge parity within tolerance.
- Spot-check Pair Lab UI: header trade count, OOS panel split point, heatmap hour buckets match Journal entry times.

## Risk

All changes are localized, replace one helper call with another, or fix a typed field rename. No schema migrations. No worker protocol changes. No UI restructure.
