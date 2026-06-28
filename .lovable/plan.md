
# Pair Lab Audit — Remediation Plan (Phases N–Q)

Three parallel audits (math/methodology, UI/state/perf, data parity) returned **69 findings**. Critical and high-severity items cluster into four executable phases. Lower-severity items are folded into the phase whose theme they share to avoid a separate cleanup pass.

## Severity snapshot

| Severity | Math | UI | Data |
|---|---|---|---|
| Critical | 0 | 0 | 0 |
| High | 5 | 7 | 3 |
| Medium | 8 | 17 | 4 |
| Low | 8 | 10 | 3 |

Cross-cutting themes that drive phase grouping:
- **Correctness silently wrong** (Kelly CI, FDR, crypto/index ticks, naive timestamps) → Phase N
- **Parity & filter alignment** (Journal vs Pair Lab, unrealized handling, walk-forward leakage) → Phase O
- **State, IA, distance-unit coverage** (URL params, re-renders, hardcoded "pips") → Phase P
- **Performance, accessibility, dead code** → Phase Q

---

## Phase N — Critical correctness (10 items)

Pure bug-fixes. No UX change. Numbers users currently trust are wrong.

1. **N1 · A-1 · Kelly CI bootstrap independence** — `shared/quant/stats.ts`: re-draw `w` wins from the wins pool each iteration and use `w` as denominator. Current CI is artificially narrow.
2. **N2 · B-1 · BH-FDR on Ideal-Windows heatmap** — `idealWindowMath.ts`: collect all cell p-values, run `bhSignificant(pvals)` once, write back. Currently ≈2.4 false-positive cells per scan.
3. **N3 · C-1 · Crypto/index tick override guard** — `symbolMapping.ts` + `usePairLab.tsx`: when `classifySymbol ∈ {crypto, index}` and no override is registered, surface a red diagnostic chip ("BTCUSD missing tick size — values may be 10–100× off") and skip the cell from ranking. Pre-seed defaults for BTCUSD=1, ETHUSD=0.1, NAS100=0.25, US30=1, DAX=0.25, XAUUSD=0.01.
4. **N4 · F-1 · Move `buildBuckets` to a web worker** — `src/workers/pairLabBuckets.worker.ts` (new). Move bootstrap + walk-forward off the main thread. Hook returns `isComputing` so tabs can show a Skeleton instead of freezing the UI.
5. **N5 · A-2 · Edge RNG parity** — edge `pairLabMath.ts`: import `makeSeededRng` instead of inline xorshift. Future-proofs against drift.
6. **N6 · A-4 · `normalizeSession` orphan bucket fallback** — `shared/quant/stats.ts`: final fallback to `"Unknown"` for unrecognised non-empty session strings.
7. **N7 · D-3 (parity) · Finding #3 Journal naive-timestamp** — call `brokerLocalToUtc()` inside `transformTrade()` and write `entry_time_utc`; all bucketing and filtering reads that field. Surface a small chip when conversion was applied.
8. **N8 · Data Finding #2 · Period boundary parity** — `Journal.tsx`: convert `startOfMonth/endOfMonth` to UTC ISO strings and switch to lexicographic comparison (same as Pair Lab). Eliminates near-midnight UTC drift.
9. **N9 · Data Finding #1 · `includeUnassigned` hook default** — `usePairLab.tsx:140`: change to `filters.includeUnassigned !== false`. Matches page-level URL default and Journal.
10. **N10 · F-2 · `longestLossStreak` double-call** — compute once in edge `computeBucket`.

## Phase O — Math & filter parity (8 items)

1. **O1 · B-2 · Walk-forward unrealized leak** — gate `runWalkForward`'s `closed` filter on `!isUnrealized(t)` even when `includeUnrealized=true`.
2. **O2 · D-2 · `subGridFifteenMin` unrealized filter** — add `isUnrealized` guard.
3. **O3 · B-3 · OOS minimum sample** — replace `n<5` with `DATA_TIER_INSUFFICIENT_N=10` in `oosSplit.worker.ts`.
4. **O4 · B-4 · TP1★ minimum gate** — raise to `n≥10` (client + edge) and suppress display when Wilson half-width > 0.25.
5. **O5 · C-2 / Data #7 · Flat-fill tolerance** — replace `ep === xp` with `Math.abs(ep-xp) < tickSize × 0.5`.
6. **O6 · Data #4 · Win/loss classification parity** — Journal's win filter mirrors `sideOf`: prefer `r_multiple_actual` sign, fall back to `net_pnl`. Eliminates W/L flipping between surfaces.
7. **O7 · Data #5 · Journal trade-count diagnostic** — split count badge into `"48 trades · 7 unrealized excluded in Pair Lab"` so users can reconcile the two surfaces at a glance.
8. **O8 · Data #6 · SL denominator** — document `sl_initial` choice with a code-comment block and add an optional `useSlFinal` analyst toggle (Setup tab) for traders who want post-move risk.

## Phase P — State, IA, distance-unit coverage (12 items)

1. **P1 · UI #7 · `useCallback` PairLab setters** — wrap all ~10 setters in `useCallback([searchParams])` to stabilise child memoisation.
2. **P2 · UI #3 · Lens + asOf URL params** (`lens`, `asof`) — shareable links + refresh persistence.
3. **P3 · UI #2 · `idw_scope` URL param** on Ideal Windows.
4. **P4 · UI #4 · `setup_tab` URL param** on Setup tab.
5. **P5 · UI #9 · `QuantNotePanel` stale note bug** — reset `note`/`error` on `bucket.key.{symbol,session}` change.
6. **P6 · UI #10 · OOS split clamp instead of reset** on lens change.
7. **P7 · UI #11 · Drop `includeUnrealized` prop drilling** — read from `PairLabWalkForwardContext` in `OutOfSamplePanel`.
8. **P8 · UI #12 · Hoist `useDistanceUnit` out of `CellInner`** — eliminates 120× listener/state duplication on `BucketGrid`.
9. **P9 · UI #22 · `StrategyRanker` distance-unit support** — wire `useDistanceUnit` + `formatDistance`; replace hardcoded "pips/pts".
10. **P10 · UI #23 · `BucketGrid` MAE p75 unit support** — convert ticks → display unit via `formatDistance`.
11. **P11 · UI #24 · Dynamic MAE unit label string** in `StrategyRanker` footer.
12. **P12 · UI #5 + #32 · Strategy tab empty-state CTA** — add Setup-navigation button via `setTab` prop.

## Phase Q — Performance, A11y, dead code (cleanup, 14 items)

1. **Q1 · UI #1 · Mobile tab overflow** — wrap `TabsList`, smaller trigger text.
2. **Q2 · UI #16/17/18/19/20 · A11y batch** — `aria-pressed` on lens & hour chips, `aria-label` on heatmap/grid cells, `aria-live`+focus on drill-down modal, distinct `aria-label` on nested tablists.
3. **Q3 · UI #13 · Memoize `closed` array** in `OverviewTab`.
4. **Q4 · UI #14 · Virtualize symbol table** when `symbols.length > 30` (`@tanstack/react-virtual`).
5. **Q5 · UI #30 · Loading gate includes `rulesQuery`** when prop-firm mode active.
6. **Q6 · UI #31 · Per-tab `ErrorBoundary`** in `TabsContent`.
7. **Q7 · UI #33/34 · Per-section skeletons** (drop full-page spinner; actionable empty-state copy).
8. **Q8 · UI #25 · Note provenance stamp** ("Generated for window …" + stale banner on lens change).
9. **Q9 · UI #26 · OOS empty-state copy** when no cells qualify.
10. **Q10 · Data #8 · `useSymbolGroups` at app root** — `App.tsx` so tick overrides apply on Journal-only sessions.
11. **Q11 · Data #9 · Join `trade_modifications`** into `TRADE_SELECT`; surface in detail panel.
12. **Q12 · Data #10 · Symbol resolver in `TradeTable` cell** — display canonical symbol.
13. **Q13 · Dead code · `_trail` param removal** (E-1), unused `BH_FDR_ALPHA` import (E-2), `"mixed"` decode comment (E-3), `(t as any).profile` typing (UI #29), unused `SymbolAliasManager` `isLoading` prop (UI #27).
14. **Q14 · F-3 · `rollingRateSeries` O(n) sliding window** in `idealWindowMath.ts`.

---

## Suggested execution order

```
Phase N (correctness)   →  ~10 edits, ships first
Phase O (parity)        →  ~8 edits
Phase P (state/UX)      →  ~12 edits
Phase Q (cleanup)       →  ~14 edits, parallelisable
```

Phases N and O can run back-to-back as one batch since they are non-overlapping pure logic fixes. Phase P needs visual verification per change. Phase Q is the largest by item count but smallest by risk and best handled as parallel small PRs.

## Technical details (engineer-only)

- New worker file: `src/workers/pairLabBuckets.worker.ts` exposing `{ build(rows, opts) → Bucketed }`. Hook returns `{ data, isComputing }` and renders previous data while recomputing.
- `transformTrade` becomes account-aware: needs the joined `account` (already in `TRADE_SELECT`) to resolve `broker_dst_profile` + `broker_utc_offset`. Stores `entry_time_utc` on the Trade type. All downstream filters and bucketers swap from `entry_time` to `entry_time_utc`.
- `WalkForwardState` URL contract: `lens ∈ {all, 90d, 30d}`, `asof` as `YYYY-MM-DD` (date only, expanded to end-of-day UTC at read).
- Diagnostic chip API (`OverviewTab` header): extend existing `missingFields`/`ambiguousFields` pattern with `missingTickOverrides: string[]` and `naiveTimestampCount: number`.
- BH-FDR application: wrap existing per-cell p-value collection in `bhSignificant(pvals, BH_FDR_ALPHA)` and write the result back onto `cell.significant`. Keep raw `pValue` for tooltips.

## Out of scope

- No new tabs or visual redesign — purely correctness, parity, and quality.
- No schema migrations beyond reading existing `trade_modifications` rows.
- No changes to ingest pipeline (`tradeEventProcessor.ts`).

Approve to start with **Phase N + O** together, or pick the phases you want first.
