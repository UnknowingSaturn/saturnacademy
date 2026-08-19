# Derived-Timeframe Cache for HTF Bias (1m-Only Storage)

## Goal
Let the backtest engine use higher-timeframe bias (H1/H4/D1) for strategies like Silver Bullet while keeping the existing 1-minute bar store as the single source of truth.

## Recommendation
**Do not store M5/M15/H1/H4/D1 natively.** Instead, derive them from 1m on demand and cache them per run. This preserves accuracy, avoids storage bloat, and eliminates DST/broker-offset drift between timeframes.

## Why 1m-only + derivation wins
- **ICT entries need M1 precision**: FVG fills, sweeps, displacement, and stop/target placement all resolve on the 1m tape.
- **HTF bias does not need native bars**: H4 candles built from 1m are exact and align perfectly with session windows.
- **Storage and sync**: One chunk per (symbol, month) keeps the manifest simple. Multiple native timeframes multiply storage and create gap-mismatch bugs.
- **Single source of truth**: A derived H4 bar cannot contradict the 1m bars that built it.

## Plan

### 1. Add timeframe aggregation in `shared/quant/bars.ts`
Implement `aggregateTimeframe(series: BarSeries, tf: "m5" | "m15" | "h1" | "h4" | "d1"): BarSeries`.
- Group 1m bars by the target timeframe boundary.
- Produce OHLCV candles in causal order (no look-ahead).
- Preserve session-aware quality: flag derived bars built from missing 1m minutes.

### 2. Add a per-run HTF cache in the backtest worker
In `src/workers/ictBacktest.worker.ts`:
- After loading 1m chunks, derive the requested HTF series once.
- Cache the derived series for the lifetime of the run so folds and parameter sweeps do not re-aggregate.
- Pass the HTF series into the engine alongside the 1m series.

### 3. Refactor HTF bias detectors to consume derived series
In `shared/quant/ict/detectors.ts`:
- Update `htfBias` and related helpers to optionally accept a pre-derived HTF `BarSeries`.
- Keep the existing 1m fallback path for backward compatibility.
- Ensure the truncation property still holds: a detector output at bar i must be identical whether the series ends at i or continues.

### 4. Expose HTF timeframe selection in the UI
In `src/components/pair-lab/backtest/BacktestControls.tsx`:
- Add a "HTF Bias Timeframe" selector (H1 / H4 / D1 / none).
- Default to H4 for Silver Bullet-style setups.
- Show a quality warning if the derived HTF bars are built from a 1m series with large gaps.

### 5. Tests and verification
- Add `bars.aggregateTimeframe` tests in the existing test suite.
- Add engine tests proving H4-bias results differ from 1m-only results in the expected direction (more selective, fewer counter-trend entries).
- Verify no look-ahead: derived HTF bar N must only use 1m bars up to the end of that HTF period.

## Out of scope
- Storing higher timeframes in the `bars` bucket or `bar_manifest`.
- Changing the MT5 import format or Dukascopy ingestion logic.
- Real-time/live HTF streaming.

## Success criteria
- User can select H4 bias and run a Silver Bullet backtest without downloading or uploading H4 data.
- Results remain deterministic and causal-safe.
- Storage cost stays flat: one 1m chunk per symbol/month.
