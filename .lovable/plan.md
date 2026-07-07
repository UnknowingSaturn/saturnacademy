# Pair Lab — Remaining Cleanup (Post-Audit)

Two parallel read-only audits (math/simulator + UI/data-flow) confirmed all prior remediations (B1–B3, P1, E1–E3, M-series, J-series) landed correctly and surfaced **10 remaining root-cause items**: 5 real bugs, 2 parity gaps, 2 efficiency wins, plus test-coverage gaps for the M3 and edge-Kelly paths. No speculative rewrites — every item is anchored to a specific file:line.

## Section 1 — Real Bugs (wrong numbers, silent failures)

**B4. `tradeMath.ts:78` — partial-fill sort uses naive `new Date()`**
`getAllCloseFills` sorts fills with `new Date(a.time).getTime()`, which is locale-dependent for the naive `partial_closes[*].time` strings on CSV-imported trades. Wrong fill order → wrong VWAP exit price and wrong per-fill P&L split in the equity curve. Replace with `ensureUtcMs(a.time)` (already imported at line 3).

**B5. `pairLabSimulator.ts:898–908` — ranker eligibility missing `isUnrealized` guard**
The M-B1 fix guarded `preparedTrades` but not `isRankerEligible` / `rankerEligibleTrades`. Idea/paper/missed trades that happen to carry MFE + MAE + SL custom fields inflate `ExclusionBreakdown.eligible`, misleading the "why excluded" panel. Add `if (isUnrealized(t as any)) return false;` at the top of `isRankerEligible`.

**B6. `pairLabSimulator.ts:683` — daily-loss key uses raw ISO prefix**
Prop-firm daily-loss grouping keys are `(trade.entry_time ?? "").slice(0, 10)`. For offset-bearing timestamps (`+05:30` etc.) this returns local calendar date, splitting or merging broker-days incorrectly and producing false `bust_daily` verdicts. Normalize via `new Date(ensureUtcMs(trade.entry_time)!).toISOString().slice(0,10)`, skipping rows where `ensureUtcMs` returns null.

**B7. `usePairLab.tsx` — query errors never surfaced**
`tradesQuery.error` / `defsQuery.error` are swallowed; a failed fetch presents an empty grid with no error state. Add `isError: tradesQuery.isError || defsQuery.isError || ...` to the returned object and render a recoverable error card in `PairLab.tsx` when set.

**B8. `Journal.tsx:264–267` — navigatePeriod arithmetic is local-tz**
B2 fixed the boundary calculation but `addWeeks`/`addMonths` on `currentDate` still shift in local tz; on DST boundaries the displayed label drifts ±1 day from the actual UTC filter window. Replace with `new Date(Date.UTC(y, m, d ± 7))` / `Date.UTC(y, m ± 1, d)` derived from the UTC parts of `currentDate`.

## Section 2 — Parity & Robustness

**P3. `pairLabMath.ts:686` — `slInitials` iterates `rows` instead of `closed`**
Every sibling accumulator (`mfes`, `maesR`, `idealSls`) iterates `closed`; `slInitials` iterates raw `rows`. With `closedOnly:false` this makes `slDrift` an apples-to-oranges ratio (denominator counts open trades the numerator excludes), producing spurious "too_wide/too_tight" flags. Change to `for (const t of closed)`.

**P4. `pairLabMath.ts:625` — `mfeRPairsForTp1` missing `is_open` guard**
Open live positions with a logged MFE enter the TP1\* denominator with `rActual: null` (never a hit), biasing the recommendation downward. Add `if (t.is_open) continue;` inside the loop.

**P5. Complete plan.md P2 — extract `SharedReplayResult`**
Still not applied. Add `SharedReplayResult` to `shared/quant/types.ts`; extend both client and edge `ReplayResult` from it, gate client-only fields (`appliedSlBySymbol`, `expectancyRCiBCa`, `compositeScore`) on a `ClientOnlyReplayFields` extension so future edge drift is a compile-time error.

## Section 3 — Efficiency

**E4. `useStrategyLabSweep.ts:37–44` — sample fingerprint collision (mirror of E1)**
`sampleKey` is `"${n}|${first}|${last}|${sum}"`; two samples with cancelling mid-edits collide, skipping legitimate MC re-runs. Append `Σ(r²)` to match the E1 fix already in `useRankerRiskMC.ts:151`.

**E5. `IdealWindowHeatmap.tsx` — `bucketTrades` blocks the main thread**
Runs synchronously in a `useMemo` over `trades.length × 24 × 2`; unlike OOS and StrategyLab, no worker offload. On moderate datasets this stalls the UI on filter changes. Offload via a small worker mirroring `useOosSplit`'s pattern; render a skeleton during recompute.

**E6. `pair-lab-report/index.ts:136–139,332` — dead `setTickSizeOverrides` install**
The handler's own comment (line 103) says tick overrides are "currently unused (this handler only consumes a pre-computed bucket)". The install/clear block runs on every AI-note request for zero effect. Delete the block; leave a TODO comment referencing the future direct-`buildBuckets` path.

## Section 4 — UX Parity (small, honest labels)

**U9. `PairLab.tsx:145` — "Include unassigned accounts" toggle has zero effect when "All accounts" is selected**
`usePairLab` passes `accountFilter: undefined` in that mode; the toggle changes nothing. Disable it (with a tooltip: "Applies only when a specific account is selected") when `isAllAccounts` is true.

**U10. `IdealWindowHeatmap` — hour axis timezone unlabeled**
Buckets use `settings.display_timezone` (default `America/New_York`) while every other Pair Lab surface reads UTC. Add a small "(times in <tz>)" label under the hour axis so cross-tab comparisons aren't misleading.

## Section 5 — Test Coverage (guards new fixes and previously fixed items)

Add three test files:
- **`propFirmMonteCarlo.test.ts`** — construct a path where target and daily-cap hit on the same trade; assert `passed=false`. Guards the M3 fix at `propFirmMonteCarlo.ts:203`.
- **`kellyServerParity.test.ts` extension** — import edge `_shared/quant/pairLabMath.ts` directly; assert `computeTp1Star` and `rawQuarterKellyPct` match their client twins on identical input.
- **`appliedSlBySymbol.test.ts`** — cover the three branches of `computeAppliedSlBySymbol` (`pairLabSimulator.ts:245–291`): all-below-floor→null, tail collapse→"Other" row, `medianScale` "Other" uses median-of-medians.

## Section 6 — Explicitly NOT in scope (verified clean)

- `shared/quant/stats.ts` (quantile, Wilson, BCa, BH-FDR, Kelly bootstrap)
- `propFirmMonteCarlo.ts` peak/bust ordering (M-B5)
- `shared/quant/symbolMapping.ts` and `symbolAliasing.ts`
- `useOosSplit.ts` FNV-1a and boundary shift
- `useSimulatorProfile.tsx` upsert (E2)
- `useRankerRiskMC.ts` handlers + Σr² key (B3, E1)
- `tradeTransform.ts`, `WalkForwardControls`, `BucketGrid`

## Section 7 — Execution Order

1. **Correctness batch** — B4, B5, B6, B7, B8 together (all narrow, all root-cause).
2. **Parity batch** — P3, P4, P5 (P5 touches shared types, no runtime change).
3. **Efficiency batch** — E4, E5, E6.
4. **UX batch** — U9, U10.
5. **Test batch** — the three new spec files.

No schema migrations. Edge redeploy needed for **P5** (types) and **E6** (dead-code removal) only. No user-visible string changes except U9 tooltip and U10 axis label.

## Technical notes

- `ensureUtcMs` returns `number | null`; every B4/B6 call site must skip nulls, not coerce to 0.
- The new heatmap worker (E5) should reuse the `resolverMap` pattern from `OutOfSamplePanel` to keep the resolver serializable.
- The `SharedReplayResult` extraction is TS-only — no runtime behavior change on either side; verify via `tsgo` and existing parity tests before edge redeploy.
- The `propFirmMonteCarlo.test.ts` fixture must use a fixed seed so simultaneous-breach reproduces deterministically.
