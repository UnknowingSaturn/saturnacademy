# Backtest Lab: verification result + what to fix next

## Verification of the last build (checked, not assumed)

Working:
- All four layers are on disk and wired: bar codec, MT5 CSV parser (`shared/quant/mt5Csv.ts`), import worker, `ingest-bars` `import` action, detectors, engine, worker, hooks.
- The Backtest tab exists and renders the import panel, coverage panel, controls and results.
- Shared quant is vendored to the edge (`_shared/quant/vendor/`) including `mt5Csv.ts`, so the import function deploys.
- Test suite: 12 files, 137 tests, all passing (including the 13 new MT5 CSV tests).

Confirmed gaps (queried the database):
1. `bar_manifest` = 0 rows, `bar_ingest_jobs` = 1 row, 1 failed. There is still no market data — the lab cannot produce a single backtest until you upload an MT5 export.
2. `backtest_runs` = 0 and `backtest_trades` = 0. No code writes them; every run is discarded on tab switch.
3. Symbol naming is not normalised on import. Your journal holds `EURUSD` (125), `EURUSD+` (56), `NASUSD` (51), `NAS100` (11), `SPXUSD` (32), `SP500` (8). `symbolAliasing.ts` already collapses these families but the bar importer and `bar_manifest` key on the raw string, so an `EURUSD+` export would sit in a bucket the journal never matches.
4. Sizing and costs are unrealistic for your accounts: `cfg.size` is a fixed contract count, so P&L and drawdown are not risk-normalised; there is no spread model (bars are OHLC only, one fixed slippage-in-ticks per instrument); CFD tickValue values in `instruments.ts` are placeholders (NASUSD/SPXUSD tickValue 0.25, FX tickValue 1) rather than your broker's contract specs.
5. No out-of-sample control: one in-sample run over the whole range, no walk-forward, no sweep, no journal comparison.

## Plan

### Step 1 — Make import land correctly (before any data goes in)
- Normalise symbols through `normalizeSymbol` in the import panel and in `ingest-bars`, storing the canonical name in `bar_manifest` while keeping the raw broker symbol in the quality JSON. `EURUSD+` history then feeds `EURUSD` backtests.
- Show real failure reasons in the coverage panel (the failed job's error is currently invisible), and let you delete/retry a month.
- Coverage gate: mark months whose missing-days exceed a threshold and warn on the run button rather than silently backtesting through holes.

### Step 2 — Runs become objects, not throwaway output
- Write each run to `backtest_runs` (config, `config_hash`, symbol, range, metrics, funnel) and its fills to `backtest_trades`.
- Run history list with re-open and two-run comparison; an identical `config_hash` serves the stored result instead of recomputing.

### Step 3 — Real money model (this is what makes it match your accounts)
- Replace fixed `size` with risk-based sizing: risk % or fixed cash risk (your $250-400 per trade) divided by stop distance, using per-instrument contract specs. Equity curve, drawdown and R then line up with the prop-firm simulator.
- Per-instrument spread model with a session multiplier (wider on the Asia/rollover window), charged on entry and exit on top of slippage; defaults conservative and editable.
- Fill the instrument registry from your journal's actual fills: derive tickValue per symbol by regressing realised P&L against price distance on closed trades, and show the derived value so you can override it.

### Step 4 — Is the edge real?
- Walk-forward: rolling train/test folds, optimise on train, report only the concatenated out-of-sample curve alongside in-sample so overfit is visible.
- Bounded parameter sweep (entry edge, stop mode, target R, window) with a deflated expectancy so 200 combinations don't hand you a fake winner.
- Monte Carlo on the OOS trades through the existing `propFirmMonteCarlo` engine, parameterised for 50k / $2k DD / $3k target.
- Journal overlay: for the same symbol and window, chart engine trades against your real journaled trades — hit rate, expectancy, and where execution diverged from the rules.

## Technical notes
- Symbol normalisation lands in `ingest-bars/index.ts` and `Mt5ImportPanel.tsx`; `useIctBacktest` already prefers `source = broker` over vendor, so no change there.
- Sizing and spread changes are inside `shared/quant/ict/engine.ts` and `instruments.ts`, with tests next to `ictEngine.test.ts`; any edit must be re-synced with `npm run quant:sync` or the edge copy goes stale.
- Walk-forward and sweep run in the existing `ictBacktest.worker.ts`; only orchestration and results components change.

## Suggested order
Step 1 now, then upload one month of NASUSD or EURUSD and prove it runs end to end. Steps 3 and 4 are where the lab starts answering the actual question; Step 2 is cheap and unblocks comparison.
