# Backtesting infrastructure: bar-data lab inside the app

## What exists today vs what the prompts describe

The Pair Lab is **not a backtester**. `pairLabSimulator.ts` replays *your already-executed trades* under different SL/TP rules using logged MAE/MFE — it can never discover a trade you didn't take, and it has no price bars. The uploaded prompts describe a genuine bar-level engine. Those are complementary, not competing: the new engine produces trades, the existing stats/Monte-Carlo layer (`shared/quant/`) scores them.

Two parts of the prompts do not fit and should be dropped:

- **Futures plumbing.** Roll files, back-adjusted vs unadjusted series, `is_roll_day` — you trade FX and CFDs (EURUSD 123, GBPUSD 96, NASUSD 51, XAGUSD 36, SPXUSD 32, XAUUSD 28). There is no roll, so there is one price series and the whole adjustment layer disappears.
- **CME session model.** 18:00→17:00 ET with a maintenance break is a futures convention. FX runs Sun 17:00 ET → Fri 17:00 ET; CFD indices have per-broker hours. Session labeling becomes symbol-class-aware.

Everything else in the prompts is worth keeping verbatim: points/ticks/R only (never a % of price), UTC storage with DST-correct ET conversion, no look-ahead with a truncation test, a no-trade log, stop-fills-first on ambiguous bars, and a reserved holdout.

## Your vocabulary vs canonical ICT

Across 348 screenshot captions: "order-flow-leg" 93, range/consolidation 92, volume profile (HVN/LVN/VAL/VAH/POC) 80, prior-week levels 38, sweep/liquidity 23, FVG/imbalance 44, displacement 3, MSS/BOS 0, killzone 0.

You are trading a different sequence than Silver Bullet. Canonical ICT gets built first (your choice), but the detector library is designed so your sequence is a config of the same engine, not a rewrite:

| Your term | Canonical ICT equivalent | Detector |
|---|---|---|
| 1min order-flow-leg | displacement + market structure shift on 1m | `displacement` + `mss`, timeframe=1m |
| "swept the low of the range" | liquidity sweep of session/range extreme | `sweep` over range-extreme level type |
| "previous week's VAL / HVN / high" | external liquidity / PD array | new `volume_profile` + `prior_period` level sources |
| "price was in a clear range" | consolidation / dealing range | `regime` detector (range vs trend) |
| "Continuation" playbooks | HTF-bias-aligned entry | `htf_bias` gate |
| FVG | FVG | `fvg` (identical) |

Volume-profile levels and a range/trend regime detector are additions the canonical spec has no concept of — they are the largest single source of your documented reasoning, so they ship in the same detector library rather than "later".

## Approach

An in-app TypeScript engine with bar data in the backend, results rendered in the Pair Lab beside your journal.

### Layer 1 — Bar data

Source: **Dukascopy** historical feed — free, covers FX majors, XAUUSD/XAGUSD and index CFDs (SPX/NDX), 1-minute back to ~2010. An ingest edge function pulls per-symbol/per-month, normalises symbols through the existing `symbol_aliases` / `symbolMapping` layer, and writes:

- **Storage**, bucket `bars`: one binary chunk per `symbol/timeframe/YYYY-MM`, columnar `Float64Array` (ts, o, h, l, c, v). ~43k bars/month/symbol ≈ 2 MB — small enough to fetch on demand, far cheaper than 10M+ Postgres rows.
- **Postgres** `bar_manifest`: symbol, timeframe, month, bar count, first/last ts, gap count, quality flags. This is what the UI queries; bytes never go through the DB.

Ingest is a bounded, resumable background job (one symbol-month per invocation, progress recorded in the manifest, single-flight lease).

Data-quality report per the prompts — coverage, missing minutes per session per year, duplicate timestamps, zero-volume bars, `high < low`, full days missing — written into the manifest and surfaced as a coverage table.

Sessions: timestamps stored UTC, converted to America/New_York via `Intl` (no hardcoded offsets). Killzone flags: London 03:00-04:00, NY AM 10:00-11:00, NY PM 14:00-15:00 ET, plus RTH for indices. Your existing `session_definitions` rows drive the session labels so backtest sessions and journal sessions are the same thing.

### Layer 2 — Detectors

`shared/quant/ict/` — pure, dependency-free, fully parameterised, shared by browser and edge:

`fvg`, `liquidity_levels` (prior session/day/week H/L, pre-window H/L, N-bar fractal swings), `sweep`, `displacement`, `mss`, `htf_bias` (none / prior-day / swing-structure / MA-slope / "perfect" flagged look-ahead), plus `volume_profile` (HVN/LVN/VAL/VAH/POC from the bar distribution) and `regime` (range vs trend).

All thresholds in points/ticks/ATR multiples. Tick sizes come from the existing `symbolMapping.ts` (already fixed for SP500/NAS). Two enforced tests: a lint test that fails if any detector divides by open/high/low/close, and a truncation test that runs each detector on full vs truncated data and asserts identical output up to bar N.

### Layer 3 — Execution engine

One trade per killzone window, no re-entries. Limit entry at proximal/50%/distal of the FVG, fills only on trade-through, cancelled at window end. Stops: swing / gap distal / fixed points. Targets: fixed R, next opposing liquidity level, or time. Hard exit at window or RTH end.

Fill rules as specified: **stop wins ambiguous bars**, `ambiguous_bar` logged so you can count how much of the result rests on that assumption; stops slip, limits don't; fills snap to the tick grid. Costs per symbol class: index CFD spread + commission, FX spread in pips; every result gross and net.

Trade log holds session date, symbol, window, direction, timestamps, prices, exit reason, R, MAE, MFE, `ambiguous_bar`, and the full config hash. No-trade log records the first failing condition per eligible session, so you can see which filter is binding.

Runs execute in a Web Worker over the fetched chunks (the app already uses workers for `oosSplit` and `rankerRiskMC`).

### Layer 4 — Results, storage and journal comparison

`backtest_runs` (config JSON, hash, symbol set, date range, aggregate metrics) and `backtest_trades` (one row per simulated trade), both RLS-scoped to you. A new **Backtest** tab in the Pair Lab lists runs, renders the equity curve and the no-trade breakdown, and feeds the trade set straight into the existing `shared/quant` machinery — bootstrap CIs, walk-forward, prop-firm Monte Carlo — so a backtested config is scored by exactly the same math as your live trades.

The payoff for staying in-app: a **journal overlay** that compares a config's simulated trades against your real trades on the same symbol/session/date, showing where the mechanical rule fired and you didn't, and vice versa.

**Holdout:** the prompts reserve 2 years; your journal starts Dec 2025, so the default cutoff is instead the most recent 12 months, excluded from every load unless explicitly overridden, with the flag stored on the run.

## Build order

1. Data layer: Dukascopy ingest job, `bars` bucket, `bar_manifest`, session/killzone labeling, quality report, coverage UI. Nothing else works without this.
2. Detector library + no-look-ahead and no-percent tests.
3. Execution engine + trade/no-trade logs, verified on one month of NASUSD with the consensus config, printed trade-by-trade.
4. Backtest tab, run storage, wiring into existing stats/MC, journal overlay.
5. Your sequence as a second config: volume-profile and prior-week level sources, regime gate, order-flow-leg entry.

## Notes

- No Python, no parquet — the engine is TypeScript in `shared/quant/ict/`, reachable from both the browser worker and edge functions, following the existing vendoring rule (`npm run quant:sync`).
- Grid search across many configs runs as a bounded queue on the server rather than in the browser, once single-config runs are proven correct.
- Dukascopy prices are its own liquidity pool, not your broker's; expect small divergence from your fills. Spread/commission defaults are per-symbol and configurable.
