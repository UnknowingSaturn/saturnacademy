# Backtest Lab — Prompt 4: taught configs, frequency, verification

Goal: make the engine able to express Silver Bullet **as it is actually taught** (5m FVG, 15m liquidity and structure, multiple trades per window, multiple windows per day), and lock those definitions as named configs before any sweep is run.

## What exists today (verified in code)

- `runBacktest` takes exactly one window (`cfg.window`) and stops after `maxTradesPerWindow` (default 1). While a position is open, later setups are skipped and the search resumes after the exit — the sequential behaviour Prompt 4 wants is already half-built.
- Every detector runs on the raw 1-minute series only. There is no timeframe aggregation anywhere in `shared/quant` — no 5m FVG, no 15m swings.
- Sweeps can only reference `priorSessionLevels` (prior session H/L, prior RTH H/L). There is no pre-window H/L, no swing-based liquidity, no "K nearest levels", and `minPenetration` is hardcoded to 0 by the engine.
- `targetMode: "liquidity"` draws from the same prior-session level list, not from a configurable universe.
- Presets live in `src/components/pair-lab/backtest/presets.ts` as UI patches. There is no `configs/grid.json` and no shared, versioned config registry.
- Stop modes are `gap` (FVG distal) and `swing` (last confirmed 1m fractal). There is no "beyond the displacement swing" stop.

## Plan

### 1. Timeframe aggregation (new foundation)
Add `resample(series, minutes)` to `shared/quant/bars.ts`: builds M5/M15 bars from 1m with an index map back to the 1m series, so any HTF feature can be stamped with the **1m bar at which it becomes known** (HTF bar close). This keeps the existing no-look-ahead guarantee and the truncation test applies unchanged.

### 2. Detectors
- 5m (and generally N-minute) FVG detection via the resampler, projected onto 1m confirmation indices.
- 15m fractal swings + a 15m swing-structure trend bias (`biasMode: "structure_15m"`: higher highs/lows = long, lower = short).
- Liquidity universes, selectable by preset:
  - `session_refs` — prior-session H/L + pre-window H/L (pre-window H/L is new)
  - `session_refs_plus_swings` — the above plus 1m N-bar swings
  - `bsl_ssl_15m` — session refs plus 15m swing highs/lows (the taught definition)
  - `swings_only`
- Sweep scan gains `K` (only the K nearest unswept levels to price are eligible) and a penetration threshold expressed in **ticks** (default 1 tick).
- Cache the 15m swing/sweep passes per series+params, same incremental pattern as the existing detector precompute.

### 3. Engine
- `window` becomes `windows: TradeWindow[]`; each listed window is scanned independently within its session, daily PnL aggregates across them. Trades carry their own `windowKey` (already true).
- `maxTradesPerWindow`: 1 (current) or unlimited with a hard cap of 10. One open position at a time; setups during an open position are skipped; the search resumes at `exitIndex + 1`. Signals are emitted for **every** qualifying FVG in the window, not just the first.
- New `stopMode: "displacement_swing"` — stop beyond the swing that produced the qualifying displacement leg.
- `targetMode: "liquidity"` draws from the same universe the sweep used; falls back to `targetR` (2R) when no unswept opposing level exists.
- No-trade funnel records per (session, window) and gains `no_liquidity_target` where relevant.

### 4. Named configs
Add `shared/quant/ict/configs/grid.json` as the single source of truth for named definitions, loaded by both the UI preset list and the sweep runner (replacing the ad-hoc presets array). First entry, locked before any sweep:

```text
as_taught_5m
  fvg           5m, no minimum size
  bias          15m swing-structure trend
  sweep         required, universe bsl_ssl_15m, K=3, 1 tick penetration
  displacement  1.5x ATR(14)
  mss           not required
  entry         50% of the gap
  stop          beyond the displacement swing
  target        next opposing liquidity level; 2R if none unswept
```

Existing presets (Silver Bullet, London, NY AM continuation) migrate into the same file so nothing is defined in two places.

### 5. Verification (before any performance sweep)
- Extend the truncation/no-look-ahead property test to the resampler, 5m FVGs, 15m swings and the new sweep universes.
- Frequency check: for `as_taught_5m`, report setups per window per day and the no-trade funnel, so the definition can be sanity-checked against the taught frequency before results are trusted.
- Cross-check a sample of engine signals against journal screenshot descriptions for the same dates (HVN/order-flow-leg language) to confirm the detectors fire where you actually traded.
- Run the full test suite and typecheck; no results are quoted until the definitions are locked.

## Technical notes
- Files touched: `shared/quant/bars.ts`, `shared/quant/ict/detectors.ts`, `shared/quant/ict/engine.ts`, new `shared/quant/ict/configs/grid.json`, `src/components/pair-lab/backtest/{config.ts,presets.ts,StrategyPanel.tsx,RunPanel.tsx,BacktestResults.tsx}`, `src/workers/ictBacktest.worker.ts`, tests.
- Vendored copies under `supabase/functions` refresh via `npm run quant:sync`.
- `EngineConfig.window` → `windows` is a breaking field rename; presets, worker payloads and stored run history get a small migration shim so old saved runs still render.
