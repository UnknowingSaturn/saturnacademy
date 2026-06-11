
# Pair Lab Audit — Fix Plan

Goal: make the Grid + Simulator quant-grade given the confirmed unit conventions:
- **MFE** = R-multiple (already correct)
- **MAE** = ticks (TradingView position calc)
- **Ideal Stop-Loss** = ticks (same source)

## 1. Unit conversion (root cause)

Add helpers in `src/lib/symbolMapping.ts`:
- `tickSizeForSymbol(symbol)` — FX5 0.00001, FX3 0.001, XAU 0.01, XAG 0.001, indices 1.0, crypto 0.01
- `pipSizeForSymbol(symbol)` — for legacy callers

Add helpers in `src/lib/pairLabSimulator.ts`:
- `slDistanceTicks(trade)` = `|entry_price − sl_initial| / tickSize(symbol)`
- `tradeMaeR(trade)` = `maeTicks / slDistanceTicks`  (null if SL or entry missing)
- `idealSlScale(trade)` = `idealSlTicks / slDistanceTicks`

When either `sl_initial` or `entry_price` is missing the trade becomes ineligible for MAE/ideal-SL-dependent presets, with reason `"missing SL/entry — can't convert ticks to R"`. No silent zeros.

## 2. Bug fixes

| ID | File | Fix |
|----|------|-----|
| B1 | `pairLabSimulator.ts` `extractProof`, `buildBucketConstants` | Convert MAE ticks→R before any compare; convert ideal-SL ticks→scale before drift math; `maeP75` in R after conversion |
| B2 | `pairLabMath.ts` | Replace hard-coded pip multiplier with `tickSizeForSymbol`; align `slInitialMedian` + `idealSlMedian` to same unit (R) |
| B3 | `pairLabMath.ts` `mostCommonTpHit` | Reuse simulator's `parseTpLabel` (handles `1:X`, `TP1`, `TP2`, etc.) |
| B4 | `pairLabSimulator.ts` stop-out heuristic | When `loggedMae == null` AND `-1.05 ≤ rActual ≤ -0.95`, return `stoppedOut: null` with reason. Outside band: unambiguous. Don't use `rActual` when MAE is present |
| B5 | `pairLabPresets.ts` + `pairLabSimulator.ts` `trail_to_mfe` | Keep `0.8 ×` MFE but expose as documented **trail capture %** (default 80%); UI label result as estimate, not proof |
| B6 | `pairLabMath.ts` `computeBucket` vs `pairLabSimulator.ts` `buildResult` | Normalize win/loss to `r_multiple_actual > 0`; fall back to `sign(net_pnl)` only when `r_actual == null` |

## 3. Grid UX (`BucketGrid.tsx`)

- Show MAE as **R** (e.g. `MAE p75 0.45R`) instead of raw ticks
- Add a second coverage line `X/N MAE` with same color thresholds as MFE coverage
- Tooltip: explain ineligibility when SL/entry missing

## 4. Simulator UX

- `StrategyRanker.tsx`: add **Strict toggle** (off by default). When on, samples the intersection of trades eligible for every preset (calls `replayBucketMatched` over `STRATEGY_PRESETS`). Warn when intersection n < 10.
- Add **`Mean reachedR`** column to expose self-selection bias between presets in native mode.
- `StrategyCompare.tsx`: footnote already lists ineligibility reasons; extend with the new `"missing SL/entry"` reason.
- `trail_to_mfe` presets: surface "trail capture: 80%" inline with the result; tag as estimate.

## 5. SL coverage sanity banner

One-time check: if among in-scope closed trades `count(has sl_initial AND entry_price) / total < 0.7`, render a Card on the Grid tab explaining how many MAE/ideal-SL-dependent rows will be ineligible until SL data is filled in.

## Strict vs Hybrid decision

Stay on **Hybrid + optional Strict toggle**. Rationale: full-strict intersection collapses sample sizes below useful thresholds across 6 presets; hybrid preserves per-preset signal while the toggle gives apples-to-apples leaderboard when wanted. Compare tab is already matched-N — that's the strict surface.

## Files touched

- `src/lib/symbolMapping.ts` — add tick/pip helpers
- `src/lib/pairLabSimulator.ts` — conversion helpers, proof fixes, stop-out tightening, trail-capture %
- `src/lib/pairLabMath.ts` — pip fix, MAE-in-R, win/loss normalize, TP parse
- `src/lib/pairLabPresets.ts` — expose trail capture parameter
- `src/components/pair-lab/BucketGrid.tsx` — R-display, MAE coverage line
- `src/components/pair-lab/StrategyRanker.tsx` — Strict toggle, reachedR column
- `src/components/pair-lab/StrategyCompare.tsx` — ineligibility reason copy
- `src/pages/PairLab.tsx` — SL coverage banner

## Out of scope

- Backfilling historical trades with SL/entry — surface as ineligibility, not auto-guess
- Changing Journal field semantics — units stay as user logs them
