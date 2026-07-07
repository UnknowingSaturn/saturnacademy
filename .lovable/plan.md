
# Pair Lab + Journal Remediation Plan

Two parallel deep audits (math core + data/UI + Journal) surfaced 12 confirmed bugs, 6 items requiring verification, 6 client/edge parity risks, and several stale-code cleanups. This plan groups them by risk so the highest-impact fixes land first and each change is verified before moving on.

## Section 1 — Math / Simulator Correctness (highest impact)

**M1. Edge Brownian-bridge guard mismatch** (`supabase/functions/_shared/quant/pairLabSimulator.ts:325`)
Add the missing `proof.loggedMfe != null` guard so edge matches client. Currently the edge falls back to `reachedR` as an MFE proxy, biasing expectancy pessimistically for early-TP presets.

**M2. Edge `buildBuckets` drops `recentN`** (`supabase/functions/_shared/quant/pairLabMath.ts:825, 842`)
Forward `opts.recentN` into both `computeBucket` calls. Every edge-generated report with a non-default drift window is currently computing recent-win-rate / drift over the wrong window.

**M3. Prop-firm MC: target-hit fires before daily-bust check** (`src/lib/propFirmMonteCarlo.ts:198–210`)
Reorder so the daily-loss cap is evaluated at end-of-day before returning `passed: true`. Otherwise a single trade that simultaneously hits both target and daily cap silently inflates `passProb` for simultaneous-account configs.

**M4. `idealSlDataDrivenPips` uses wrong buffer** (`src/lib/pairLabMath.ts:834`, `supabase/functions/_shared/quant/pairLabMath.ts:711`)
Change `MAE_P75_WIDEN_BUFFER` (1.15) → `WINNERS_MAE_SL_BUFFER` (1.10) so the *display* value matches what the recommendation pipeline actually suggests. Prevents a phantom 5% "drift" signal in the QuantNotePanel.

**M5. `oosSplit.worker.ts` naive-`Date.parse`** (`src/workers/oosSplit.worker.ts:77`)
Replace `Date.parse(params.splitIso)` with `ensureUtcMs`. Same class of TZ bug as M6 / J1 below.

**M6. Edge `resolveSlAtMaePrice` naive-`Date.parse`** (`supabase/functions/_shared/quant/pairLabMath.ts:285, 289`)
Route `exit_time` and modification `occurred_at` through `ensureUtcMs` for engine-independent behavior.

**M7. `makeSeededRng` modulo bias** (`shared/quant/stats.ts:100`)
Replace `((seed >>> 0) % 1_000_000) / 1_000_000` with `(seed >>> 0) / 0x1_0000_0000`. Removes bootstrap bias.

## Section 2 — Data / UI Correctness

**U1. `setWf` recreates on every `maxMs` change → context thrash** (`src/pages/PairLab.tsx:206–219`)
Drop `maxMs` from the `setWf` `useCallback` deps by reading `maxMs` inside `patchParams` via a ref, or by removing the clamp there and clamping inside context. Six consumers currently re-render on every bounds refetch.

**U2. `OutOfSamplePanel` slider bounded to full history, not active window** (`src/components/pair-lab/OutOfSamplePanel.tsx:68, 197–208`)
Compute `min`/`max` from the panel's already-filtered `trades` (or from the active `dateFrom` / `dateTo`), not from context `minMs` / `maxMs`.

**U3. `VALID_SETUP_TABS` inside component body** (`src/pages/PairLab.tsx:72`)
Hoist to module scope alongside `VALID_TABS`. Removes latent stale-closure and the per-render Set allocation.

**U4. `StrategyLab` local state stales when simulator profile updates** (`src/components/pair-lab/StrategyLab.tsx:146, 149`)
Move `accountSize` / `tradesPerDay` to controlled state derived from prefs (or `useEffect` sync on defaults change), so navigating Setup → Strategy reflects the newly-saved balance and detected TPD.

**U5. Journal `clearModelFilter` non-functional `setSearchParams`** (`src/pages/Journal.tsx:91–94`)
Switch to functional form and construct a new `URLSearchParams` (don't mutate the closure snapshot).

**U6. Journal model-filter effect never clears on URL removal** (`src/pages/Journal.tsx:83–88`)
Add the `else setModelFilter(null)` branch so removing `?model=` from the URL clears the badge.

**U7. Dead `selectedAccountId` dep in Journal `filteredTrades` memo** (`src/pages/Journal.tsx:213`)
Remove — account filtering is DB-side; keeping it forces a full re-filter on every account switch.

**U8. `partialFillFlag.groups` == `.trades` reads awkwardly** (`src/hooks/usePairLab.tsx:139–141`, `src/components/pair-lab/tabs/OverviewTab.tsx:320`)
Either drop the `groups` field from the type + banner, or reword the banner to a single count.

## Section 3 — Journal ↔ Pair Lab Parity

**J1. Naive timestamps: local vs UTC** (`src/pages/Journal.tsx:134` vs Pair Lab `ensureUtcMs`)
Replace `parseISO(trade.entry_time)` in Journal with `ensureUtcMs` (and matching helpers in exit-time and modification-time code paths). Ensures the same trade lands on the same calendar day everywhere.

**J2. Default period window mismatch** (`Journal.tsx:55–56` = "month", `PairLab.tsx:193` = "all")
Align Journal's default to match Pair Lab's `lens=all`, OR add a "Sync with Pair Lab" affordance. Recommend defaulting Journal to "all" for consistency and letting the user narrow, since Pair Lab is the analysis surface most linked from.

**J3. Open-trade counting divergence** (`Journal.tsx:325` vs `PairLab.tsx:315`)
Add an `Open: N · Closed: M` breakdown to the Journal header so the difference from Pair Lab's "closed trades in scope" chip is explicit rather than confusing.

**J4. Journal filters not URL-persisted** (`Journal.tsx:42–57`)
Migrate `symbolFilter`, `sessionFilter`, `periodType`, `currentDate`, `customFrom`, `customTo`, `resultFilter`, `tradeTypeFilter` to `useSearchParams` — mirroring the Pair Lab pattern. Enables shareable/deep-linked Journal views and back-button behavior.

## Section 4 — Verification Items (investigate then decide)

**V1.** `numericCf` accepting negatives — add a `numericCfDistance` wrapper that floors at 0, replace scattered `Math.abs` at call sites. (`shared/quant/stats.ts:581`)

**V2.** `computeBucket` uses `rows` (not `closed`) for MFE/MAE/idealSL distributions — confirm intent; if unintentional, switch to `closed` to prevent open-trade excursions from biasing TP grids. (`src/lib/pairLabMath.ts:612, 640, 671`)

**V3.** `downsideStddev` denominator — align to `n` (Bloomberg/Quantopian) OR document `n−1` choice. (`shared/quant/stats.ts:65`)

**V4.** `classifySymbol` substring match — anchor `NQ`/`ES`/`YM`/`RTY` patterns so `XNQUSD` / `ESGOLD` are not mis-classified as indices. (`shared/quant/symbolMapping.ts:41`)

**V5.** Walk-forward OOS guard — add `oosRows.length >= DATA_TIER_INSUFFICIENT_N` check before `oosPairs.length >= 5`. (`src/lib/pairLabMath.ts:1057`, edge twin)

**V6.** `useUpdatePairLabPrefs` optimistic-revert races on rapid successive edits — capture `prev` inside the flush closure, not at call time. (`src/hooks/useSimulatorProfile.tsx:169, 203`)

**V7.** `IdealWindowHeatmap` `hours` / `minN` in localStorage vs URL — decide policy (currently inconsistent with "all filters in URL" contract). (`src/components/pair-lab/IdealWindowHeatmap.tsx:42–62`)

## Section 5 — Parity Contracts (edge ↔ client)

**P1.** Extend edge `BucketReport` type to include `slSweep`, `eventsRFallbackCount`, `entryEfficiencyMedian/P75`, `stopLocationQualityMedian`, `featuresCount`, `rawKellyClipped`, `rawKellyPct`, `bindingConstraint`, `edgeVsBaseline` — mirroring client. Prevents silent-null in AI report consumers.

**P2.** Re-export `bootstrapKellyCiBCa` from edge `_shared/pairLabMath.ts` for parity with `src/lib/pairLabMath.ts:57`.

**P3.** Expose `trailCapture` on `PresetReplayResult` (both twins) so audit consumers can see which fraction was applied.

## Section 6 — Stale Code Cleanup

**C1.** Delete stale `_trail`-parameter comment at `src/lib/pairLabMath.ts:1059–1062`.
**C2.** Add tracking issue reference OR raise `TRAIL_CAPTURE_FALLBACK` per-asset-class TODO in `shared/quant/config.ts:142` (leave code, just add issue link).
**C3.** Delete `useOptionalPairLabWalkForward` tombstone comment at `src/contexts/PairLabWalkForwardContext.tsx:73`.
**C4.** `useRankerRiskMC.ts:127` hash — add a note explaining sum-collision risk (parity with `useStrategyLabSweep`'s S2.8 comment). Optionally strengthen hash to include first/last R values.

## Section 7 — Regression Tests

Add unit tests colocated with the fixed modules:

- `pairLabSimulator.test.ts` — assert edge and client match on `loggedMfe == null && loggedMae != null` (covers M1).
- `pairLabMath.test.ts` — `buildBuckets` with `recentN: 20` propagates to `computeBucket` drift window (covers M2).
- `propFirmMonteCarlo.test.ts` — construct a scenario where target and daily cap hit on the same trade; assert failed=true (covers M3).
- `journalTimezone.test.ts` — assert Journal and Pair Lab classify a `2024-01-31T23:00:00` naive timestamp into the same calendar day for a UTC-5 viewer (covers J1 + M5 + M6).
- `symbolClassification.test.ts` — extend to assert `XNQUSD` is FX, not index (covers V4 once decided).

## Section 8 — Execution Order

Ship in three review-sized batches:

1. **Math correctness** — M1–M7 + tests. Highest impact, no UI churn.
2. **Journal parity + UI** — J1–J4, U1–U8. Ship together because J1 touches paths U5/U6/U7 already edit.
3. **Verification + parity + cleanup** — Section 4 decisions, P1–P3, C1–C4.

Deferred (not in this plan): the .lovable/plan.md doc will be updated after each batch lands so future audits can diff cleanly.

## Notes for the reviewer

- No schema migrations required — all changes are in TS.
- All edge functions changed (`_shared/pairLabMath.ts`, `_shared/pairLabSimulator.ts`) will need redeploy.
- Batch 2 changes the *default* Journal window; users with bookmarked Journal URLs are unaffected because Batch 2 also adds URL-persisted filters.
- No user-visible strings change outside of the Journal open/closed breakdown chip and the QuantNotePanel drift label.
