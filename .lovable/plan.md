## Verification Sweep: Confirm This Week's Pair Lab + Journal Fixes Landed Correctly

Goal: audit every fix shipped this week (B1–B8, P1/P3/P4/P5, E1–E6, U9/U10, M/J series, test additions) and confirm each is intact, correct, and not silently regressed. No new features — verification only, with targeted repairs if a gap is found.

### Scope (files touched this week)
- `src/lib/tradeMath.ts`, `src/lib/pairLabMath.ts`, `src/lib/pairLabSimulator.ts`, `src/lib/propFirmMonteCarlo.ts`
- `src/hooks/useRankerRiskMC.ts`, `src/hooks/useStrategyLabSweep.ts`, `src/hooks/useSimulatorProfile.tsx`, `src/hooks/usePairLab.tsx`
- `src/pages/Journal.tsx`, `src/pages/PairLab.tsx`
- `src/components/pair-lab/OutOfSamplePanel.tsx`, `IdealWindowHeatmap.tsx`, `StrategyLab.tsx`, `tabs/OverviewTab.tsx`
- `src/contexts/PairLabWalkForwardContext.tsx`, `src/workers/oosSplit.worker.ts`
- `shared/quant/stats.ts`, `shared/quant/symbolMapping.ts`, `shared/quant/types.ts`
- `supabase/functions/_shared/quant/pairLabMath.ts`, `pairLabSimulator.ts`, `supabase/functions/pair-lab-report/index.ts`
- All new/edited tests under `src/lib/__tests__/`

### Verification checklist (per fix)

**Correctness (B-series + P1)**
- B1 OOS trade timestamps → `ensureUtcMs` present in `OutOfSamplePanel.tsx`
- B2 Journal week/month/custom → all boundaries via `Date.UTC()`
- B3 `useRankerRiskMC` → `onerror` + `onmessageerror` clear loading state
- B4 `getAllCloseFills` → uses `ensureUtcMs`, no `new Date(...)` sort
- B5 `isRankerEligible` → `isUnrealized` guard present
- B6 daily-loss grouping → normalized via `ensureUtcMs` → UTC date slice
- B7 `usePairLab` → `isError` surfaced; PairLab renders error card
- B8 Journal `addWeeks`/`addMonths` → UTC-derived
- P1 simulator ineligibility reason distinguishes null vs ambiguous MAE

**Parity (P3/P4/P5 + edge twins)**
- P3 `slInitials` iterates `closed`
- P4 `mfeRPairsForTp1` skips `is_open`
- P5 `SharedAppliedSlSymbolStat` in `shared/quant/types.ts`, consumed on both sides
- Diff `src/lib/pairLabSimulator.ts` vs `supabase/functions/_shared/quant/pairLabSimulator.ts` for drift
- Diff `src/lib/pairLabMath.ts` vs edge twin

**Efficiency (E-series)**
- E1 `useRankerRiskMC` cache key includes Σr²
- E2 `useSimulatorProfile` uses `upsert` on user_id
- E4 `useStrategyLabSweep` cache key includes Σr²
- E5 `IdealWindowHeatmap` uses `useDeferredValue` (or worker); no main-thread stall
- E6 `pair-lab-report` dead `setTickSizeOverrides` block removed

**UX (U9/U10)**
- U9 "Include unassigned/orphan accounts" disabled with tooltip when All accounts
- U10 `IdealWindowHeatmap` hour axis shows timezone label

**Tests**
- Run full vitest suite; expect prior 92 tests green
- Confirm files exist: `auditBatch.test.ts`, `propFirmMonteCarloBreach.test.ts`, `appliedSlBySymbol.test.ts`, `kellyServerParity.test.ts` (extended), `symbolClassification.test.ts`
- Spot-check each asserts the invariant it was written for (not just a smoke test)

### Method
1. Parallel-read all touched files + edge twins.
2. Grep for regression markers (`new Date(`, `addWeeks(`, `addMonths(`, `setTickSizeOverrides`, raw ISO slice on entry_time, missing `isUnrealized` in eligibility paths).
3. Run `bunx vitest run` and `tsgo` for type parity.
4. Produce a pass/fail table per item. For any FAIL, apply the minimum targeted patch in build mode (not now) and re-run tests.

### Deliverable
A per-item PASS/FAIL report. If everything passes, no code changes. If gaps exist, a short follow-up patch list scoped strictly to the regressed item — no new refactors, no scope creep.
