# Pair Lab Post-Remediation Cleanup Plan

Two parallel read-only audits (math/simulator + UI/journal parity) verified the previous batch's M1–M7 and U/J fixes landed correctly, and surfaced **7 remaining items** — 2 real bugs producing wrong numbers, 2 parity/robustness gaps, 3 efficiency/hygiene items. This plan fixes root causes only; no speculative rewrites.

## Section 1 — Real Bugs (wrong numbers or hangs)

**B1. `OutOfSamplePanel.tsx:74` — slice bounds use naive `new Date()`**
The U2 fix replaced context-global bounds with slice-local bounds but forgot to route through `ensureUtcMs`. For CSV-imported trades with naive timestamps, the OOS slider min/max shift by the user's UTC offset. Replace `new Date(t.entry_time).getTime()` with `ensureUtcMs(t.entry_time)` (returns `number | null`; skip nulls).

**B2. `Journal.tsx:265–270` — period boundary uses local-tz date-fns**
J1 correctly moved `entry_time` parsing to `ensureUtcMs`, but `periodRange.start/end` still come from `startOfWeek/endOfMonth/etc.`, which anchor to the host local timezone. A trader outside UTC sees week/month boundaries drift; a 00:05 UTC trade can fall outside a local-tz week. Compute period boundaries in UTC (`Date.UTC(y, m, d)` or format-then-`ensureUtcMs`) so period filtering matches the trade-time frame.

**B3. `useRankerRiskMC.ts:57–77` — missing worker error handlers**
R5.1 added `onerror`/`onmessageerror` to `useStrategyLabSweep` and `useOosSplit` but skipped this hook. A worker crash leaves `loading: true` forever and the ranker card sits on a skeleton. Mirror the pattern from `useStrategyLabSweep.ts:67–75`.

## Section 2 — Parity & Robustness

**P1. `pairLabSimulator.ts:493` — misleading ineligibility reason**
When `proof.loggedMae == null` the code emits `"ambiguous stop/TP ordering — MAE present but direction unknown"`. Split the return into two distinct messages so the audit trail is truthful:
- `loggedMae == null` → `"no MAE and r_actual ambiguous near stop"`
- `loggedMae != null` → keep the existing message.

**P2. Edge `_shared/quant/pairLabSimulator.ts` — silent field drift from client**
Edge `ReplayResult` lacks `appliedSlBySymbol`, `expectancyRCiBCa`, `compositeScore`. Documented as "intentionally diverged" but there's no type-level fence — any consumer JSON-diffing client vs edge sees silent missing fields. Fix: extract a `SharedReplayResult` base type in `shared/quant/types.ts`, have both client and edge extend it, and mark client-only fields with a `ClientOnlyReplayFields` extension so the divergence is compile-time visible.

## Section 3 — Efficiency / Hygiene

**E1. `useRankerRiskMC.ts:133–140` — cache-key mid-sample collision**
Current key hashes `(strategyId, riskPct, n, Σr, r[0], r[-1])`. Two R-samples that differ only in the middle (cancelling edits at both ends) skip a legitimate MC re-run. Append `Σ(r²)` — detects any variance change with negligible cost.

**E2. `useSimulatorProfile.tsx:98–113` and `:201` — SELECT-then-write pattern**
Both `useUpdateSimulatorProfile` and `useUpdatePairLabPrefs` do an existence SELECT before INSERT/UPDATE (2 round-trips). Replace with `upsert({ user_id, ... }, { onConflict: 'user_id' })`. Halves latency on every prefs save.

**E3. `IdealWindowHeatmap.tsx:46–60` — `localStorage` read every render**
Wrap `loadStoredHours`/`loadStoredMinN` in `useState(() => loadStoredHours())` lazy initializers so the sync read happens once on mount.

## Section 4 — Test Coverage

`.lovable/plan.md` claims M1–M6 have regression coverage but `src/lib/__tests__/auditBatch.test.ts` only asserts M7 (RNG bias) and M4 (buffer constants). Add:
- `pathProb.test.ts` extension — `pathProbTpFirst` symmetry / bounds (covers M-B4).
- `propFirmMonteCarlo.test.ts` — construct a run where target and daily-cap hit same trade; assert `passed=false` (covers M3).
- `journalTimezone.test.ts` — round-trip a naive `2024-01-31T23:00:00` timestamp through both `Journal` period-window and `Pair Lab` scope-filter; assert same day classification (covers J1 + B2).

## Section 5 — Explicitly NOT in scope (verified clean)

Audit confirmed these previous fixes landed correctly and need no further work:
- M7 RNG (`shared/quant/stats.ts:110`) ✓
- M4 buffer parity (`pairLabMath.ts:846`) ✓
- M3 MC pass/bust order (`propFirmMonteCarlo.ts:203`) ✓
- MFE bridge guard (`pairLabSimulator.ts:599`) ✓
- Kelly three-stream bootstrap (`shared/quant/stats.ts:309`) ✓
- Journal `useSearchParams` migration, ensureUtcMs on `entry_time`, open/closed chip ✓
- Symbol classification anchors ✓

## Section 6 — Execution Order

1. **Correctness first** — B1, B2, B3 in one batch. All small, all root-cause.
2. **Parity fence** — P1, P2 together (P2 touches shared types).
3. **Efficiency + tests** — E1, E2, E3 + Section 4 tests.

No schema migrations. Edge redeploy required for P2 only. No user-visible string changes except P1 (audit ineligibility reason wording).

## Technical notes

- `ensureUtcMs` is already imported in both `OutOfSamplePanel` neighbors and `Journal.tsx`; no new imports needed for B1/B2.
- The `upsert` fix (E2) requires a unique constraint on `user_id`; both tables already have it (verified in prior audits).
- The `SharedReplayResult` extraction (P2) is TS-only — no runtime behavior change on either side.
