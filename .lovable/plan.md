# Pair Lab Audit — Fix All Findings

Address every finding in `.lovable/pair-lab-audit.md` with the recommended fix. For each "needs your call" item I pick a default (rationale inline); flag anything you want reversed before I build.

---

## Part 1 — Data ingress (`src/hooks/usePairLab.tsx`, `usePairLabTradeBounds.ts`)

1. **Bug A — Orphan default.** Change `filters.includeUnassigned` default from `false` to `true` so callers without the flag match Journal. Pair Lab page still wires the toggle explicitly, so behaviour there is unchanged; only silent-drop for other consumers is fixed.
2. **Bug C — `isLoading` gating.** Add `rulesQuery.isLoading || accountQuery.isLoading || groupsQuery.isLoading` to the OR at `usePairLab.tsx:317`. Prevents transient wrong prop-firm constraints.
3. **`usePairLabTradeBounds` orphan mismatch.** Pass `includeUnassigned` through from caller (default `true`) so slider bounds match analytics window.
4. **`naiveTimestampCount` scope.** Keep the "whole set" semantic (matches the comment's intent) but update the chip tooltip in `OverviewTab` to say "across all your trades, not just this window."
5. **`groupsQuery.groups` stability.** Wrap the returned array in `useMemo` inside `useSymbolGroups` so downstream memo deps are stable.
6. **Journal vs. Pair Lab local-time period.** Leave Journal semantics alone (call-out item, not a bug). Document in the audit doc footer only — no code change.

## Part 2 — Math core

7. **M-B1** — Add `&& !isUnrealized(t as any)` to `preparedTrades` filter in `pairLabSimulator.ts:800`.
8. **M-B2** — Add a code comment above `buildResult`'s prop-firm verdict block clarifying "display-only, MC engine is source of truth." (No behavioural change; intra-replay bust would break the retrospective tape view.)
9. **M-B3** — Fix error message at `pairLabSimulator.ts:493` to `"ambiguous stop/TP ordering — MAE present but direction unknown"`.
10. **M-B4** — Guard Brownian-bridge branch on `proof.loggedMfe != null`; otherwise mark ineligible.
11. **M-B5** — Update `peak[i]` before the trailing-bust check in `propFirmMonteCarlo.ts:190`.
12. **Kelly with zero losses (§2.4 edge case + §2.9 #2).** Suppress Kelly (return `null` + `rCoverageWarning: 'insufficient-losses'`) when `lossR.length < 3`.
13. **DD-penalty denominator (§2.6 + §2.9 #4).** Replace `Math.max(1, RISK_TOLERANCE_R_DEFAULT)` with `Math.max(1, comfortDdPct / riskPct)` derived from user's `ranker_comfort_dd_pct` and current `riskPct`. Keep 10R as fallback when either is missing.
14. **Composite negative-score sort (§2.9 #3).** Add explicit comparator: `nulls last, then numeric desc` in the ranker sort site. Add unit test.
15. **`Math.max(50, params.paths)` surprise (§2.5).** Change to honour explicit small values (`params.paths ?? 2000`) but keep 50 as the floor only when the caller omitted the field.
16. **`ticksToPips` fallback safety (§2.3).** When `tickSize`/`pipSize` unknown, return `null` (drop the trade + increment `slMissingCount`) instead of returning ticks unscaled. Prevents silent wrong SL distances.
17. **`TP1_STAR_MIN_HIT_RATE` (§2.9 #5).** Lower to `0.30`. (Keeping full CI-lower-bound replacement out of scope — a constant change is the minimal safe fix.)
18. **Trail-capture 0.7 fallback (§2.9 #1).** Keep as-is, add a `// TODO(empirical): derive per-asset-class prior` comment. No behavioural change without data.
19. **Parity tests (§2.7 + §2.9 #6).** Add `pickBestTp`, `computeTp1Star`, `rawQuarterKellyPct` cases to `serverReplayParity.test.ts`.

## Part 3 — UI shell + dead code

20. **U-B1** — Migrate `heatmapPair` to `useSearchParams` (lift state to `PairLab.tsx` alongside `selected`), remove the `window.history.replaceState` call.
21. **U-B2** — Add `key={selectedBucket.key.symbol + ":" + selectedBucket.key.session}` to `QuantNotePanel` at `PairGridTab.tsx:107`.
22. **U-B3** — Add `setSelected` to Escape effect deps.
23. **U-B4** — Add `scope` to `IdealWindowHeatmap` reset-effect deps.
24. **U-B5** — URL-persist Setup sub-tab as `?setupTab=`, plumbed through existing `patchParams`.
25. **U-B6** — Move `cursor-help` off the orphan `<Switch>` wrapper onto the `<Label>` only.
26. **`patchParams` stale-closure (§3.1).** Migrate to `setSearchParams(prev => …)` functional form.
27. **`IdealWindowHeatmap.setScope` inline (§3.3).** Wrap in `useCallback`.
28. **A11y batch (§3.4):** add `role="group"` + `aria-label="Analysis lens"` on lens button group; add visible `focus-visible:ring` on lens buttons; add `aria-busy={loading}` to `QuantNotePanel` generate button; move `cursor-help` off the distance-unit `TooltipTrigger` wrapper so inner buttons are keyboard-reachable; add `aria-live="polite"` announcement on `PairGridTab` selection change.
29. **Dead code (§3.5):** delete `useOptionalPairLabWalkForward`, `WINDOW_PRESETS` in `StrategyLab.tsx`, `closedTrades` alias in `usePairLab.tsx`, and the double blank lines at `PairLab.tsx:119` and `:184`.

## Out of scope

- No DB migrations, no changes to Journal, no new features.
- Deferred (would need product decisions beyond the audit): unifying Journal ↔ Pair Lab timezone semantics; replacing `TP1_STAR_MIN_HIT_RATE` with Wilson-CI lower bound; deriving per-asset-class trail-capture priors.

## Technical notes

- All math changes get unit-test additions alongside the existing `pairLabRobust.test.ts` and `serverReplayParity.test.ts` suites.
- Grand total: 11 confirmed bugs + 4 UX bugs fixed; 5 verification items resolved (either fixed or explicitly kept); 10 of 16 "needs your call" items resolved with defaults above (6 semantic ones deferred as out-of-scope); 4 dead-code deletions.
- Verification: run `bunx vitest run` after each part; if any assertion around composite ordering / walk-forward expectancy changes, update snapshots deliberately, not blindly.
