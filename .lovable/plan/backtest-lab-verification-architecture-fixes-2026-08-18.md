# Backtest Lab: verification + architecture fixes

## What I verified (facts, not guesses)

Built and working:
- All four layers exist in code: bar codec (`shared/quant/bars.ts`), Dukascopy client, `ingest-bars` function, ICT detectors, execution engine, worker, hooks, and the Backtest tab wired into Pair Lab.
- Full test suite passes: 11 files, 124 tests, including detector look-ahead ("truncation") tests and 10 engine tests.

Broken or never finished:
1. **There is no market data at all.** `bar_manifest` has 0 rows. The single queued job (NASUSD 2026-06) has failed twice with `HTTP 503` from Dukascopy and is sitting pending. The whole lab currently cannot produce a single backtest.
2. **Runs are never saved.** `backtest_runs` and `backtest_trades` were created with grants, RLS and indexes, but no code anywhere reads or writes them (0 rows). Every run is thrown away on tab switch — no history, no comparison, no reproducibility.
3. **No walk-forward / holdout.** `backtest_runs.include_holdout` exists but the engine and UI only ever do one in-sample run over the whole range. There is no OOS split, no parameter sweep, and no control for testing many rule combinations against the same data.
4. **No link to your journal.** Nothing compares engine output against your actual traded results, and nothing maps a playbook or a screenshot description ("1min order-flow leg", "reaction from HVN") onto an engine config. So a run can't tell you whether your real edge is real.
5. **Cost model is thin.** Bars are BID-only with a fixed slippage-in-ticks assumption and no spread; FX/CFD spreads widen exactly in the windows you trade. Position size is a fixed `size` (contracts/lots), so cash P&L and drawdown are not risk-normalised and don't line up with the prop-firm simulator.
6. **Data quality is recorded but not enforced.** The manifest stores missing minutes/days, but the engine happily runs on months with holes; a gap-heavy month silently biases results.

## Plan

### Phase 1 — Get data in via MT5 export (nothing else matters until this works)
Your broker's own M1 history is the right primary source: same symbols, same prices, same spreads as the trades in your journal.

- **Upload path**: a drag-and-drop CSV/TSV importer in the Backtest tab. It accepts the standard MT5 M1 export (`date, time, open, high, low, close, tick_volume`), auto-detects delimiter, header row and the file's server-time offset, converts to UTC, splits into months, and writes the same binary chunks + `bar_manifest` rows the Dukascopy path produces — so the worker and engine need no changes. Source tagged `broker` so it never mixes with vendor data.
- **How you get the file**: in MT5, View → Symbols → pick the symbol → Bars → M1 → Export, or Tools → Options → Charts → set "Max bars in chart" high, then File → Save As from an M1 chart. One file per symbol; the importer handles multi-year files.
- **Validation on import**: reject wrong timeframe or non-monotonic timestamps, report duplicate/missing minutes and gap days per month, and show a coverage summary before it commits.
- **Dukascopy stays as an optional fallback** for deep history, but I'll park the queued failing job and stop it hammering a 503 endpoint rather than build more on it now.
- Surface real job/import errors in the coverage panel (the failure reason is currently invisible in the UI).


### Phase 2 — Make runs first-class objects
- Persist each run to `backtest_runs` (config, `config_hash`, symbols, dates, metrics, funnel) and its fills to `backtest_trades`.
- Run history list: re-open, compare two runs side by side, and refuse to re-compute an identical `config_hash` (serve the stored result instead).
- Gate runs on coverage: block or loudly warn when the selected months have missing days above a threshold.

### Phase 3 — Make it answer "is my edge real?"
- **Walk-forward:** split the range into rolling train/test folds; optimise on train, report only the concatenated out-of-sample curve. Report in-sample vs OOS side by side so overfit is visible.
- **Parameter sweep** over a bounded grid (entry edge, stop mode, target R, window) with a deflated/adjusted expectancy so 200 combinations don't hand you a fake winner.
- **Monte Carlo on the OOS trades** using the existing `propFirmMonteCarlo` engine: pass odds for your 50k/2k-DD/3k-target accounts, driven by backtest trades instead of assumptions.
- **Journal overlay:** for the same symbol/window, chart backtested trades against your real journaled trades — hit rate, expectancy, and where your execution diverged from the rule set. This is the piece that turns the lab from a toy into an edge check.

### Phase 4 — Realistic money
- Risk-based sizing: size from a risk-% of account and the stop distance, so equity curve, drawdown and R are consistent with the prop simulator.
- Spread model per instrument and per session window (configurable, defaulting to conservative), applied on entry and exit on top of slippage.

## Technical notes
- Ingestion changes stay inside `supabase/functions/ingest-bars` plus `shared/quant/dukascopy.ts`; the CSV path reuses `makeSeries`/`encodeBarChunk`/`assessBarQuality`, so the worker and engine are unchanged.
- Walk-forward and sweep run in the existing worker; only the orchestration hook and results components change.
- Any change to `shared/quant/**` must be re-synced to the edge vendor copy (`npm run quant:sync`).
- New engine behaviour lands with tests alongside `ictEngine.test.ts` (sizing, spread, fold boundaries).

## Suggested order
Phase 1 first and alone — I'd rather prove one month of NASUSD bars lands and runs end to end before building history, walk-forward or journal overlay on top of an empty bucket.
