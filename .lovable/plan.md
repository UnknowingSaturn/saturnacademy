## PR-3 — Pair Lab Accuracy Pass (build)

Skipped the "off-edge lens" (mistake-tag filter) — audit concluded hindsight-labelling bias plus a per-preset cherry-pick surface would make numbers less trustworthy, not more. Shipped the five audit-prioritised fixes instead.

### Landed
- **P0-A · server survivorship-bias fix.** `supabase/functions/_shared/quant/pairLabSimulator.ts` no longer returns early with `ineligible: "unproven target"` inside the partial loop. Trades that hit some rungs but not all now fall into the runner block and book their honest outcome — matching the client. The AI quant note stops inflating WR/expectancy on multi-TP presets (10–40% depending on ladder shape).
- **P0-B · server Brownian-bridge ordering mixture.** Ported `pathProbTpFirst` + `resolveTpFirstProb` from `shared/quant/stats.ts` into the server twin. Ambiguous "both TP and SL breached" trades are now blended per the same bridge probability the client uses. `replayAllPresets` accepts `opts.replayMode` (expected · optimistic · pessimistic), default expected.
- **P1-A · fold-sort chronology fix.** `preparedTrades` (`src/lib/pairLabSimulator.ts:662`) and `rankerEligibleTrades` (`:753`) now sort by `ensureUtcMs(entry_time)` instead of `String.localeCompare`. Mixed CSV+ISO timestamp datasets no longer scramble fold boundaries.
- **P1-B · OOS panel: disable embedded walk-forward.** `BuildBucketsOpts` gained `disableWalkForward?: boolean`; threaded through `buildBuckets` → `computeBucket`. `oosSplit.worker.ts` passes `true` on the test half so "Test E[R]" is the true naive OOS expectancy, not a 70/30 split within the test slice.
- **P2-A · BucketGrid FDR transparency.** `fdrFor` no longer hides `ns` on negative-E cells. Users see the correction denominator honestly; positive winners no longer appear to have passed a smaller family than they actually did.

### Tests
- New `src/lib/__tests__/serverReplayParity.test.ts` — six cases covering: eligibility on TP1-only winners under scale-out and runner presets (P0-A guard), quick-flip on both-breached trades stays near 0 in expected mode (P0-B), and optimistic/pessimistic modes reproduce +1R/−1R at the barrier symmetric case (P0-B mode plumbing).
- All 18 tests green (`bunx vitest run`).

### Not touched
- `QuantNotePanel` UI, Kelly / CVaR / BCa math, Šidák TP-grid width, IdealWindow BH families, trail-capture estimator — audit confirmed these are already correct.
- No new UI toggles, no lens, no per-preset overrides. Every change tightens a number the user already sees.
