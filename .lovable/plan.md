# Pair Lab Audit Findings & Remediation Plan (Phases P, Q, R)

Three parallel audits (Math, UI/State, Data Pipeline) surfaced ~30 issues. They split cleanly into three execution phases. Critical items first.

---

## Phase P — Critical Correctness (fix the numbers users see)

These all change values currently rendered in the UI.

**P1 · Drift unit mismatch** (`src/lib/idealWindowMath.ts:304`)
- `idealWindowMath` stores drift as a raw fraction (−0.125); `pairLabMath.ts:688` stores it as percentage points (−12.5). The 15pp drift-arrow threshold therefore fires ~100× too aggressively (or never) depending on which surface reads it.
- Fix: multiply by 100 in `idealWindowMath` so `BucketStats.drift` is always pp.

**P2 · `mean([])` returns 0 → false "0.00R" cells** (`shared/quant/stats.ts:39`, edge `pairLabMath.ts:556`)
- `expectedR = mean(rActuals)` returns `0` when a bucket has trades but zero R coverage, indistinguishable from a true zero-edge bucket. `median` correctly returns `null`.
- Fix: change `mean` to return `null` on empty input (typed as `number | null`); edge `expectedRMedian ?? 0` becomes `?? null`; grid renders `—` when null.

**P3 · Trail-capture fallback divergence 0.7 vs 0.8** (`pairLabMath.ts:764`, `usePairLab.tsx:271`)
- TP grid uses 0.7 fallback; simulator uses 0.8 (`TRAIL_CAPTURE_FRAC`). Same data → different implied capture across surfaces.
- Fix: single source of truth in `shared/quant/config.ts` → `TRAIL_CAPTURE_FALLBACK = 0.7`; both call sites import it; delete `TRAIL_CAPTURE_FRAC`.

**P4 · Crypto/index tick-size defaults wrong for major brokers** (`shared/quant/symbolMapping.ts:35,67`)
- `BTCUSD`/`ETHUSD` get crypto-default 0.01 (most brokers: 1.0 or 0.10). `NAS100`/`SPX500` get 1.0 (CME-quoted: 0.25). DOGE/MATIC/BNB/AVAX fall through the crypto regex and hit fx5 (0.00001) → MAE→pips off by 10–100×.
- Fix: (a) extend crypto regex to include DOGE/MATIC/POL/AVAX/BNB/LINK/UNI/SHIB; (b) per-symbol factory defaults inside `defaultTickSize()` for BTC/ETH and US indices; (c) Overview chip "tick size unconfigured" when in-scope symbol has neither override nor factory default.

**P5 · Loading gate destroys all local state** (`src/pages/PairLab.tsx:133`)
- Spinner returns before `PairLabWalkForwardProvider` mounts → every refetch unmounts all 5 tabs, losing selected hours, scope, regime, slider positions.
- Fix: move spinner inside each tab body (or wrap children in Suspense); provider stays mounted across data refetches.

---

## Phase Q — Math Parity, Statistical Rigor, Walk-Forward Hygiene

**Q1 · `bhSignificant` exported but never applied to per-bucket p-values** (`src/lib/pairLabMath.ts:64`)
- `expectancyPValue` is raw bootstrap p with no multiple-test correction. Heatmap fixed this; grid did not.
- Fix: apply BH-FDR across all in-scope buckets and expose `expectancyBhSignificant` for the grid significance badges.

**Q2 · `overfit` flag has no CI-overlap check** (`src/workers/oosSplit.worker.ts:89`)
- `tr.expectedR > 0 && te.expectedR <= 0` fires on any noise crossing zero.
- Fix: require non-overlapping `expectedRCi` between train and test (or |Δ| > 0.25R) before flagging.

**Q3 · OOS worker drops `recentN`** (`src/workers/oosSplit.worker.ts:59`)
- Drift always computed with window=10 in OOS bucket build regardless of grid setting.
- Fix: forward `recentN` through OOS worker params to both train and test `buildBuckets`.

**Q4 · Walk-forward OOS threshold inconsistency** (`pairLabMath.ts:885`)
- `oosRows.length < 9` vs canonical `DATA_TIER_INSUFFICIENT_N = 10` elsewhere.
- Fix: standardize on 10.

**Q5 · TP grid hard-caps at 4R** (`pairLabMath.ts:833`, edge :306)
- High-R strategies (scalps, crypto runners) silently get truncated.
- Fix: extend grid to dynamic max = `ceil(quantile(mfeR, 0.9))`, capped at 8R; warn when argmax lands on the boundary.

**Q6 · Edge/client field-name split: `idealSlMedian` vs `idealSlMedianPips`** (`pairLabMath.ts:133`, edge :134)
- Same quantity, two names; any consumer of edge `BucketReport` reading `.idealSlMedian` gets `undefined`.
- Fix: unify on `idealSlMedianPips` and `slInitialMedianPips` everywhere; bump the edge contract.

**Q7 · `eventsRFallbackCount` missing from edge `BucketReport`** (`usePairLab.tsx:279`)
- Fix: add to edge type and computation so R-inferred coverage is honest if edge ever feeds baseline.

**Q8 · Timestamp sort uses `localeCompare`** (`pairLabMath.ts:455`, edge :203)
- Locale-dependent; use `Date.parse(a) - Date.parse(b)`.

**Q9 · `normalizeSession` passes unknown strings as new buckets** (`shared/quant/stats.ts:298`)
- Phantom cells like "Pre-Market" can never merge. Fall back to `"Other"` with a console warn.

**Q10 · `bootstrapKellyCi` seed only uses `wins[0]`** (`shared/quant/stats.ts:183`)
- Same n + same first-win value → identical CI widths. Hash full distribution like `bootstrapMeanCi`.

**Q11 · `strategyLabMC.worker` no try/catch** (`src/workers/strategyLabMC.worker.ts:47`)
- Throw → permanent loading state. Wrap and `postMessage({error})`.

**Q12 · Legacy "mixed" hour-setup decode is arbitrary** (`src/lib/hourSetup.ts:90`)
- Picks `first_worked_second_failed` out of 4 possible meanings. Fix: decode "mixed" → confidence-null + flagged, not a specific outcome.

**Q13 · Remove dead `_trail` parameter in `pickBestTp`** (client + edge); fix stale comment at `pairLabMath.ts:962–965` that contradicts the implementation.

---

## Phase R — UI/State, A11y, Data Completeness

**R1 · Distance-unit hardcode in StrategyRanker** (`StrategyRanker.tsx:104–106`)
- `{sl.toFixed(1)} pips/pts` ignores `useDistanceUnit`. Route through `formatDistance(value, nativeUnitForSymbol(symbol))`.

**R2 · Accessibility on grid cells** (`BucketGrid.tsx:311`, `IdealWindowHeatmap.tsx:471`, `WalkForwardControls.tsx:61`)
- Add `aria-label` (symbol + session + N + expR), `aria-pressed` for selection state, and `aria-pressed` on lens buttons.

**R3 · Memoize chart math**
- `CumulativeExpectancyChart.tsx:44` — wrap math in `useMemo([events, rollingN])` + `React.memo` the component.
- `IdealWindowHeatmap.tsx:584` drill-down — add canvas-scatter fallback when events > 100 (mirror `CumulativeExpectancyChart` pattern).
- `EquityCurveOverlay.tsx:19` — memoize `data`/`underData`; canvas fallback above 200 pts.
- `OverviewTab.tsx:79` — wrap `closed` in `useMemo` so `tickSizeOffenders` dep is stable.

**R4 · `tooFewSamples` misnomer** (`QuantNotePanel.tsx:128,157`)
- Rename to `lowConfidence`; tooltip should describe CI/variance gate, not count.

**R5 · `StrategyRanker` badge overstates guarantee** (`QuantNotePanel.tsx:257`)
- `"validated · OOS-tested"` displayed when `validated` tier only requires CI lower bound > 0. Split into two badges; only show "OOS-tested" when `walkForward != null`.

**R6 · Cleanup**
- Delete `const filteredTrades = trades;` no-op in `StrategyLab.tsx:102`.
- `OutOfSamplePanel.tsx:63` — read `minMs/maxMs` from `usePairLabWalkForward()` (already exposed) instead of re-subscribing.
- Thread `groups` through `PairLabWalkForwardContext` so `IdealWindowHeatmap` stops re-subscribing.
- Wrap `setSelected`/`patchParams` in `useCallback` to stop `PairGridTab` keyboard effect re-subscribing on every slider drag.

**R7 · R-inferred badge missing from grid + ranker** (`BucketGrid.tsx`, `StrategyRanker.tsx`)
- Surface `eventsRFallbackCount / n` as an inline chip wherever expectedR is shown, matching the existing `QuantNotePanel` treatment.

**R8 · Missing-SL coverage chip**
- `pairLabMath.ts` returns no `slMissingCount` despite trades silently dropping from MAE-R/sweep. Add count + chip alongside the existing MAE coverage badge.

**R9 · `trade_modifications` never fetched** (`src/hooks/_shared/tradeQueries.ts:11`)
- Live bridge populates this table, but Pair Lab never reads it → SL-sweep rescaling always uses `sl_initial`, overstating R-at-risk on BE-moved trades.
- Fix: include `trade_modifications(occurred_at, field_name, old_value, new_value)` in `TRADE_SELECT`; when present, use SL-at-time-of-MAE (or `sl_final`) as the sweep denominator.

**R10 · Partial fills not used in MAE→R** (`pairLabMath.ts:569`)
- `entry_price` is the first fill; multi-fill index/crypto entries skew R denominators.
- Fix: when `partial_fills?.length > 0`, lot-weighted average entry replaces `entry_price` in the SL-distance denominator.

---

## Execution Order
1. **Phase P** (5 fixes) — visible numeric corrections, ship first.
2. **Phase Q** (13 fixes) — statistical/parity hardening; no UI changes user notices but every chart becomes more trustworthy.
3. **Phase R** (10 fixes) — UI polish, a11y, cleanup, and the two data-completeness wins (R9/R10).

Each phase is independently shippable. After each, I will rebuild and spot-check the affected surfaces in the preview before moving on.

## Out of Scope (intentionally deferred)
- The "unify BucketGrid + IdealWindowHeatmap under one cells hook" architectural redesign (P4-A in UI audit). High value but multi-day; revisit after Phase R lands and the parity gaps are gone.
- Edge-side recomputation of math (currently the edge function explicitly delegates to client). No active bug; keep as-is.

Approve to start with **Phase P**, or tell me to re-order / drop specific items.