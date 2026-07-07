# Pair Lab Audit

Compiled from three parallel read-only investigations. Every finding cites `file:line` and quotes code where relevant. Nothing has been changed based on these findings — this is a decision doc. Review, mark accepted/rejected, and we'll open a targeted fix plan.

Sections:
1. Data ingress vs. Journal — **complete**
2. Math core — **complete**
3. UI shell + dead code — **complete**

---

## 1. Data ingress vs. Journal

### 1.1 Trade-universe parity

Both surfaces call `useTrades()` with the same shape:

| Scenario | Journal (`src/pages/Journal.tsx:65-69`) | Pair Lab (`src/hooks/usePairLab.tsx:147-150`) |
|---|---|---|
| All accounts | `useTrades(undefined)` | `useTrades(undefined)` |
| Account selected | `{ accountId, includeUnassigned: true }` | `{ accountId, includeUnassigned }` |

`useTrades` defaults `is_archived = false` at `src/hooks/useTrades.tsx:49`, so neither surface sees archived rows.

**Divergence 1 — Orphan rows (account_id IS NULL). CONFIRMED BUG.**
Journal hardcodes `includeUnassigned: true` (`Journal.tsx:67`). Pair Lab evaluates `filters.includeUnassigned === true` (`usePairLab.tsx:146`), defaulting to **false** when the caller omits it. Result: with an account selected, Journal shows legacy imports with NULL account_id; Pair Lab silently drops them → different row counts for the same DB snapshot. Note: the OverviewTab toggle defaults `orphans=on` in the URL (`PairLab.tsx`), so in practice most users don't see this — but a caller of `usePairLab` without setting the flag would.

**Divergence 2 — Open positions.** Intentional. Pair Lab excludes at `usePairLab.tsx:271`. Journal counts include open trades. Not a bug; document if `totalTrades` numbers are ever compared.

**Divergence 3 — Unrealized (idea/paper/missed).** Intentional. Pair Lab defaults `includeUnrealized = false`; Journal shows all types. Not a bug.

**Divergence 4 — Profile filter.** Pair Lab only. Correctly mirrored between `buildBuckets` and `matchesScope` (`usePairLab.tsx:272`).

**Divergence 5 — Walk-forward window.** Pair Lab only. See §1.2 for TZ risk.

### 1.2 Timezone / timestamp handling

- Walk-forward window generation is UTC-clean. `resolveWindow` (`WalkForwardControls.tsx:41-44`) emits ISO `Z` strings; Pair Lab compares via `ensureUtcMs` (`usePairLab.tsx:279-288`).
- `ensureUtcMs` (`shared/quant/stats.ts:706-722`) treats naive strings as UTC midnight.
- **Known semantic divergence:** Journal's period filter (`Journal.tsx:134`) uses `parseISO` + `isWithinInterval`, which interpret naive strings as *local* time. A trade with `entry_time = "2024-01-15 23:30:00"` lands on different calendar days in the two views for a user east of UTC. No fix without changing Journal semantics.

### 1.3 Loading & memoization

- **`isLoading` misses queries — CONFIRMED BUG.** `usePairLab.tsx:317-322` OR-s only `tradesQuery / defsQuery / aliasesQuery / profileQuery`. Missing: `rulesQuery`, `accountQuery`, `groupsQuery`. In prop-firm mode, `propFirm` is briefly built from an empty rules array with zero balance during initial mount → transient wrong daily-loss / max-DD constraints.
- **`groupsQuery.groups` reference stability — needs verification.** Listed as a memo dep at `usePairLab.tsx:362`. If `useSymbolGroups` returns a new array on every render, this fires the expensive memo unnecessarily.

### 1.4 Additional findings

- **`usePairLabTradeBounds` orphan mismatch — CONFIRMED BUG.** `src/hooks/usePairLabTradeBounds.ts:21` calls `useTrades({ accountId })` with no `includeUnassigned`, defaulting to `true` inside `useTrades`. When Pair Lab runs with `includeUnassigned=false`, slider bounds are drawn from a wider universe than the analytics window. Cosmetic only — no math depends on the bounds.
- **`naiveTimestampCount` scope — semantic ambiguity.** `usePairLab.tsx:315` counts across the *full* fetch, not the scoped window. Comment at line 312 says this is intentional ("across the whole user trade set"), but the chip label doesn't convey that. Either scope down or clarify the tooltip.

### 1.5 Needs your call

1. **Orphan default.** Change `usePairLab.filters.includeUnassigned` default from `false` to `true` to match Journal? Would fold NULL-account rows into every caller of `usePairLab` that doesn't set the flag — not just the Pair Lab page (which explicitly wires the toggle already).
2. **Journal's local-time period vs. Pair Lab's UTC lens.** Fixing Journal to use UTC would shift what "This week" means for users east of UTC. Accept the divergence, or unify?
3. **`naiveTimestampCount`** — chip counts all trades or only in-scope?
4. **`isLoading`** — hold the spinner until rules/account/groups resolve, or accept the transient render?

---

## 2. Math core

_Files audited: `src/lib/pairLabMath.ts`, `src/lib/pairLabSimulator.ts`, `src/lib/propFirmMonteCarlo.ts`, `shared/quant/stats.ts`, `shared/quant/config.ts`, `src/lib/idealWindowMath.ts`, `src/lib/symbolMapping.ts`, `src/workers/rankerRiskMC.worker.ts`._

### 2.1 Quantile methodology

NIST Type-7 linear interpolation throughout (`shared/quant/stats.ts:22-31`). Empty → `null`, single sample → `xs[0]`, NaN pre-filtered via `Number.isFinite`. Bootstrap CI uses the identical helper. ✅ No issues.

### 2.2 R-multiple derivation

Two fallbacks with different semantics when `r_multiple_actual` is null:

- **Event timeline** (`pairLabMath.ts:763-765`) — sign-inferred ±1 from `net_pnl`. Matches Journal. `eventsRFallbackCount` badge surfaces the fallback. Loses magnitude on partial exits (a −0.3R exit becomes −1R), acceptable as a drift signal only.
- **Simulator proof** (`pairLabSimulator.ts:362`) — `rActual: rActual ?? 0`. Trade admitted with `reachedR = 0`, then downstream `isRankerEligible` requires MFE+SL and filters it out. Harmless today; brittle if the guard is ever relaxed.

### 2.3 MFE / MAE unit conversion

- Contract: MAE + ideal-SL in **broker ticks**, MFE in **R**. Documented and consistent.
- `ticksToPips` correctly applies `(ticks × tickSize) / pipSize`. S2.12 fix aligned.
- SL denominator uses `sl_final` (not `sl_initial`) — correct per S1.3 (avoids BE-tighten bias).
- Missing `sl_initial` / `entry_price` → `null`, drops from `maesR`, counted in `slMissingCount`.
- **⚠️ `ticksToPips` fallback** returns ticks unscaled if `tickSize`/`pipSize` are unknown. Needs verification that every symbol the user actually trades is covered by `TICK_OVERRIDES` / `classifySymbol`; an unrecognized symbol silently produces wrong SL distances.

### 2.4 Expectancy, Kelly, hard-cap order

- Kelly formula (`stats.ts:481-490`) is standard `p − q/b`, expressed as `(bp − q)/b`. `KELLY_SCALE = 0.25` (¼-Kelly). ✅
- Application order (`pairLabMath.ts:1155-1158`): Kelly first, then `Math.min(KELLY_CEILING_PCT=1.5, raw)`. `rawKellyClipped` flag fires correctly.
- `rWinRate` is recomputed on the R-subsample only (S4.4 fix). ✅
- **⚠️ Edge case — all wins with full R-coverage.** `avgLossR` defaults to `1` when `lossR = []`, producing Kelly = 25% (clipped by ceiling to 1.5%). `rCoverageWarning` doesn't fire because R-coverage is 100%. Ceiling saves the trader but the underlying estimate is degenerate. Suggested guard: suppress Kelly when `lossR.length < 3`.

### 2.5 Monte Carlo

- **RNG:** Mulberry32, deterministic per `(strategyId, riskPct)` in the worker; `Math.random()` seed in the planner. Reproducible in the worker, stochastic in the planner — intentional.
- **Block bootstrap:** block size `max(3, round(N^(1/3)))` (Politis–Romano 1994). Block-end wraps to a uniform random restart — avoids head-of-series oversampling. ✅
- **Compounding:** Per-trade P&L = `r × dollarRisk` (fixed-fraction arithmetic compounding). `geometricMeanGrowthPct` reports true geometric growth separately. Correct for prop-firm rule semantics.
- **Ruin definition:** `riskOfRuin` = fraction of paths where ≥1 account busts. Single-account = per-account bust rate. ✅
- **Trailing DD:** `reference = peak[i]` per trade (not end-of-day). ✅
- **Path count:** 2000 default. p ≈ 5% ruin → SE ≈ 0.5%. Wilson CI returned alongside. ✅
- Minor: `Math.max(50, params.paths ?? 2000)` — a caller passing `paths: 1` gets 50, which may surprise debug callers.

### 2.6 Ranker sort key (BCa lower bound of R)

Composite score (`pairLabSimulator.ts:937-956`):

```ts
const expLower = ci[0];                                       // BCa lower bound
const ddPenalty = 1 / (1 + maxDdR / max(1, riskToleranceR));
const samplePenalty = 1 - 1 / (1 + sqrt(n / MIN_PROVEN_SAMPLE));
return expLower * ddPenalty * samplePenalty;
```

- BCa lower bound correctly penalises lucky-small-sample presets (wider CI at small n). ✅
- Sample penalty curve: 0.50 at n=10, 0.63 at n=30, 0.76 at n=100. A 10-trade preset can't beat a 30-trade one with similar edge. ✅
- **⚠️ Negative scores.** When `expLower < 0`, `compositeScore < 0`. Needs verification that the UI comparator handles null vs. negative correctly (default JS comparators put `null` in an unexpected place).
- **⚠️ DD penalty denominator.** `Math.max(1, riskToleranceR)` with `RISK_TOLERANCE_R_DEFAULT = 10` is a fixed constant. A trader sizing 0.5% risk could tolerate 20R easily, so the penalty is too punishing at low risk %. Should tie to user's comfort-DD.

### 2.7 Client / server parity

- Both client and edge functions import `shared/quant/stats.ts` and `shared/quant/config.ts` directly — no copy-paste divergence for primitives.
- `serverReplayParity.test.ts` asserts P0-A (survivorship) and P0-B (Brownian-bridge) fixes on the server twin.
- **⚠️ No parity tests for `pickBestTp`, `computeTp1Star`, or `rawQuarterKellyPct`.** A regression in the edge function for any of those would only surface via a divergent report.

### 2.8 Bugs / correctness findings

| # | File:line | Current behaviour | Expected / fix | Risk |
|---|---|---|---|---|
| **M-B1** | `pairLabSimulator.ts:800` | `preparedTrades` filter doesn't call `isUnrealized()`. Zero-PnL dismissed rows and paper trades with non-null `net_pnl` enter `walkForwardEvaluate`. | Add `&& !isUnrealized(t as any)` to match `rankerEligibleTrades`. | Medium — distorts IS vs OOS expectancy. |
| **M-B2** | `pairLabSimulator.ts:695-712` | `buildResult` prop-firm verdict is checked *post-hoc* over the full tape. Bust is detected but trading continues in the retrospective view. | Either apply the bust flag intra-replay (skip subsequent trades) or document that this verdict is display-only and MC is the source of truth. | Low — MC engine is correct; this is display-only. |
| **M-B3** | `pairLabSimulator.ts:493` | Error message says "missing SL/entry — can't convert MAE ticks to R" but fires on ambiguous stop/TP ordering, not missing SL. | Change to `"ambiguous stop/TP ordering — MAE present but direction unknown"`. | Cosmetic. |
| **M-B4** | `pairLabSimulator.ts:595-596` | When `loggedMfe` is null and `reachedR` was inferred from positive `rActual`, MFE is underestimated in the Brownian-bridge branch → conservative bias toward SL-first. | Enter this branch only when `proof.loggedMfe != null`; otherwise mark ineligible. | Low-medium — underestimates early-TP presets. |
| **M-B5** | `propFirmMonteCarlo.ts:190` | Trailing bust uses `peak[i]` before it's updated for the current trade — slightly over-generous vs. an intra-trade trailing check. | Update peak before bust check, or accept (bounded by `riskPerTradeFrac`). | Very low. |

### 2.9 Needs your call

1. **Trail-capture fallback = 0.7.** No empirical basis given. Keep as conservative FX default, derive per-asset-class priors, or expose per-user.
2. **Kelly with zero losses.** Suppress Kelly when `lossR.length < 3` or show a "no-loss history" warning.
3. **Composite score negative-value sort order.** Confirm UI comparator handles `null` vs. negative uniformly.
4. **`RISK_TOLERANCE_R_DEFAULT = 10` DD penalty tuning.** Tie to `comfortDdPct / riskPct` instead of a fixed 10R.
5. **`TP1_STAR_MIN_HIT_RATE = 0.4` gate.** Filters legit low-hit-rate trend-following edges. Lower to 0.25–0.30 or replace with Wilson-CI lower bound?
6. **Add parity tests** for Kelly and TP grid on the server twin — currently only the replay loop is asserted.

---

## 3. UI shell + dead code

_Files audited: `src/pages/PairLab.tsx`, `src/components/pair-lab/tabs/*`, `src/components/pair-lab/*`, `src/contexts/PairLabWalkForwardContext.tsx`._

### 3.1 URL ↔ state contract

| Param | Read | Written | Refresh-safe | Notes |
|---|---|---|---|---|
| `profile`, `pf`, `unreal`, `orphans`, `scope`, `tab` | ✅ | ✅ | ✅ | |
| `symbol`, `session` | ✅ | ✅ | ✅ | |
| `lens`, `asOf` | ✅ | ✅ via `setWf` | ✅ | |
| `heatmapPair` | ⚠️ bypasses React Router | ⚠️ bypasses React Router | ❌ | Bug U-B1 |
| Setup sub-tab | n/a | ❌ not written | ❌ | Bug U-B5 |

**`patchParams` stale-closure race** (`PairLab.tsx:66-73`) — two writes in the same tick both snapshot the same `searchParams`; second write silently discards the first. Low risk today, higher if callers ever compose. Fix: use `setSearchParams(prev => …)` functional form.

### 3.2 Re-mount / lost-state issues

- **`QuantNotePanel` stale note** (`PairGridTab.tsx:107`) — no `key` prop. When the user clicks a different cell, `bucket` changes but the component's `note` / `loading` / `error` state carries over from the previous cell → user sees the wrong AI analysis. Add `key={selectedBucket.key.symbol + ":" + selectedBucket.key.session}`.
- **`IdealWindowHeatmap` drill-down persists across scope changes** (`IdealWindowHeatmap.tsx:142`) — reset effect depends only on `wf.lens` / `wf.asOfMs`; missing `scope`. Add it to the dep array.
- **`SetupTab` inner tabs uncontrolled** (`SetupTab.tsx:19`) — `defaultValue="simulator"` resets on every visit even if user was on Aliases.

### 3.3 Memoization boundaries

- **`patchParams` identity chain** — every URL write invalidates all six child callbacks. By design (S1.7 comment), but confirms the pattern.
- **`IdealWindowHeatmap.setScope` inline** (`IdealWindowHeatmap.tsx:126-134`) — plain arrow, new reference every render.
- **Context M1 fix incomplete** (`PairLabWalkForwardContext.tsx:47-63`) — `merged` memo lists `value.groups` as a dep. If `useSymbolGroups` returns a new array reference each render, the context value churns regardless. Needs verification of the hook's return stability (also called out in §1.3).
- **`StrategyTab.scopedTrades`** (`StrategyTab.tsx:68-79`) deps include `data.symbolResolver` — inline function inside `usePairLab`'s memo. Safe today but fragile: any query refetch recreates it.

### 3.4 Accessibility

- Lens `<button>`s in `WalkForwardControls.tsx:65` have `aria-pressed` but no visible focus ring beyond `transition-colors`.
- Lens group has no `role="group"` / `aria-label` (`WalkForwardControls.tsx:60`).
- Distance-unit toggle wrapper `<div>` at `OverviewTab.tsx:541` has `cursor-help` from a `TooltipTrigger` — keyboard focus lands on the tooltip wrapper, not the inner buttons.
- `QuantNotePanel` generate button lacks `aria-busy` when `loading=true`.
- `PairGridTab.tsx:83` sticky header: Escape-driven selection changes aren't announced (`aria-live` missing, focus not moved).

### 3.5 Dead code / drift

- **`useOptionalPairLabWalkForward`** (`PairLabWalkForwardContext.tsx:74`) — zero consumers (verified with `rg`). Safe to delete.
- **`WINDOW_PRESETS`** (`StrategyLab.tsx:46`) — the comment says the local toggle was removed; the constant is now unreferenced.
- **`closedTrades` alias** (`usePairLab.tsx:294`) — `const closedTrades = scopedTrades;` with no filtering. Misleading, no behavioural cost.
- Double blank lines at `PairLab.tsx:119` and `:184` — vestigial.

### 3.6 Bugs / findings

| # | File:line | Current | Fix | Risk |
|---|---|---|---|---|
| **U-B1** | `IdealWindowHeatmap.tsx:128-133` | `heatmapPair` written via `window.history.replaceState` — bypasses React Router; back-navigation drops it. | Thread `setSearchParams` in and mutate the param through it. | Medium UX — programmatic navigation + back button desync. |
| **U-B2** | `PairGridTab.tsx:107` | `QuantNotePanel` renders with stale note/loading/error on cell switch. | Add `key` prop derived from the selected cell. | **High UX** — user sees another cell's AI analysis. |
| **U-B3** | `PairGridTab.tsx:44-50` | Escape effect suppresses `setSelected` from deps; safe today only because `patchParams` stabilises between interactions. | Add `setSelected` to deps, or wrap it in a `useEvent`-style ref. | Low. |
| **U-B4** | `IdealWindowHeatmap.tsx:142` | Drill-down stays open after `scope` change. | Add `scope` to the reset effect deps. | Cosmetic. |
| **U-B5** | `SetupTab.tsx:19` | Setup sub-tab is not URL-persisted; deep-link / share impossible. | Migrate to a `?setupTab=` param. | Low. |
| **U-B6** | `OverviewTab.tsx:165` | Orphan-mode `<Switch>` sits inside a `cursor-help` wrapper — visual affordance is broken and can suppress hit-test on some browsers. | Move `cursor-help` onto the `<Label>` only. | Low UX. |

### 3.7 Needs your call

1. Migrate `heatmapPair` to `useSearchParams` (lift scope up to `PairLab.tsx` like `selected` is)?
2. URL-persist Setup sub-tab (`?setupTab=simulator|groups|aliases`)?
3. Delete `useOptionalPairLabWalkForward`, or is it reserved for a component that may render outside the provider?
4. `QuantNotePanel` key fix (U-B2) — intentional to preserve note across cell hops, or a bug to fix? (Almost certainly a bug.)
5. Migrate `patchParams` to `setSearchParams(prev => …)` to eliminate the same-tick race?
6. Remove `WINDOW_PRESETS` and `closedTrades` alias as part of the next cleanup pass?

---

## Summary — counts by severity

| Severity | Data | Math | UI | Total |
|---|---|---|---|---|
| Confirmed correctness bug | 3 | 5 | 3 (U-B1, U-B2, U-B4) | 11 |
| UX / cosmetic bug | 1 | 0 | 3 (U-B3, U-B5, U-B6) | 4 |
| Needs verification | 1 | 3 | 1 | 5 |
| Semantic "needs your call" | 4 | 6 | 6 | 16 |
| Dead code | 0 | 0 | 4 | 4 |

**Highest-priority items to fix next (my recommendation, for your review):**
1. **U-B2** — `QuantNotePanel` shows the wrong cell's AI note. Highest user-visible severity.
2. **M-B1** — `walkForwardEvaluate` includes unrealized trades → distorted IS/OOS expectancy.
3. **Bug A** (data §1) — Orphan-default mismatch between Journal and Pair Lab; row-count discrepancy erodes trust.
4. **Bug C** (data §1) — `usePairLab.isLoading` misses `rulesQuery` / `accountQuery` / `groupsQuery` → transient wrong prop-firm constraints on initial mount.
5. **U-B1** — `heatmapPair` desync with React Router.

Nothing else is fixed automatically — pick what to tackle and I'll open a targeted plan.

