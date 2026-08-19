# Prompt 5 — Sweep, nulls, and statistics

Turns the Backtest Lab from "run one config" into a validation harness: a sampled sweep on a discovery symbol, honest null benchmarks, an ablation ladder, and the statistics that say whether an edge survives multiple testing.

## Scope decisions (from your answers)

- Symbols are generic: you choose a **discovery** symbol and a **validation** symbol per run from whatever you've imported (EURUSD today, more later). Validation runs only survivors, the three named configs, the ablation ladder and the nulls — raw, no reselection.
- Sweep size comes from the benchmark: 50 canonical configs run through the full pipeline, then the app shows median sec/config and projected wall clock, and **stops for your go-ahead** before launching. N = min(25000, floor(90min × workers / median_sec)). If N < 10000 it refuses to launch and tells you to optimise instead of silently shrinking.
- Every output file is saved per-run (reopenable from Recent Runs) and downloadable as a zip.

## Part 0 — Canonicalisation, benchmark, sizing

- Extend `grid.json` with the new sweep axes: sweep-universe preset, window list, `maxTradesPerWindow`. `bias=perfect` is excluded from the sweep entirely and exists only as the labelled lookahead rung of the ablation ladder.
- Canonicalise each enumerated config before hashing: null out dead parameters (all sweep axes when `requireSweep=false`, liquidity-target params when `targetMode=r`, displacement params when displacement is off), then dedup on the canonical hash. Report raw vs canonical counts.
- Benchmark stage: 50 random canonical configs through signals → fills → PnL → logging. Report median seconds/config, worker count, projected wall clock. Then wait.
- Sampling: uniform random, one draw, fixed seed, over canonical configs; the three named configs (`as_taught_5m`, `silver_bullet`, `london_killzone`) are always added on top. The sampled set is the test population for the FDR correction.

## Part 1 — The sweep (discovery symbol)

- Worker pool sized to `navigator.hardwareConcurrency`. The decoded bar series and derived feature store are built **once per worker** and treated as read-only; configs stream against it.
- Shard results: each worker writes a completed batch to a shard, a merger dedups by config hash. Shards persist, so a reload resumes and already-hashed configs are skipped.
- One row per config: hash, all canonical params, trade count, trades/year, % of days with a trade, win rate, avg R, total R, gross/net PnL, gross/net Sharpe, max DD in R and dollars, profit factor, % ambiguous-bar trades, first/last trade date.

## Part 2 — Validation on the second symbol

Survivors + the three named configs + ablation ladder + nulls, reported raw. No re-selection, no re-fitting.

## Part 3 — Reference nulls

Reference configs: the two named configs, the best realistic survivor, one median-Sharpe config.

- **(a) Random entry, same windows** — coin-flip direction at a uniform random minute inside the config's window(s), stop distance and target structure copied from the matched config's trades, same trades-per-day count, 1000 iterations.
- **(b) Other hours, same logic** — every non-overlapping 60-minute window in the session (~21), single-window version of the config's logic on each; that set is the distribution.
- **(c) Shuffled direction** — keep the real signal log, flip each trade's direction with p=0.5, re-simulate fills only, 1000 iterations.

(a) and (b) repeat on the validation symbol for `as_taught_5m` and `as_traded`. Each real result is reported as a percentile of its null; if it sits inside the null, the report says so in plain words.

## Part 4 — Ablation ladder

`as_taught_5m` params throughout, both symbols, one table: FVG-only → +sweep (`bsl_ssl_15m`) → +displacement → +window restriction → +15m bias (full config) → +perfect bias (labelled LOOKAHEAD). Columns: trades, win rate, avg R, net Sharpe, max drawdown.

## Part 5 — Discretion premium

From the trade log of `as_taught_5m`, `as_traded`, and the best realistic survivor: result taking every setup; result with hindsight-perfect skipping of all losers; and the minimum fraction of losers a trader must skip **in advance** to (a) break even net and (b) reach 1.0 net Sharpe. Single numbers, one-line captions.

## Part 6 — Statistics and slices

- Deflated Sharpe Ratio (Bailey / López de Prado) for the best realistic config, using the canonical config count tested, cross-config Sharpe variance, and trade-level skew and kurtosis. Benjamini-Hochberg FDR across the sampled population.
- Per-year avg R and trade count for every survivor; era split (2010–2021 vs 2022→holdout cutoff) for survivors and all three named configs.
- Roll-day sensitivity (with/without roll-day trades) — only meaningful for futures instruments, reported as N/A for FX.
- Slippage sensitivity computed analytically from trade logs, no re-simulation: stop slippage 0/1/2/3 ticks × time-exit slippage 0/1/2 ticks.

## Part 7 — Summary pack

Written to a per-run `analysis/summary/` folder, each file small enough to paste into a chat: `results_configs.csv`, `funnel_counts.json`, `named_configs_report.md` (all three, both symbols, win rate next to the commonly claimed 70–80% band), `es_validation.csv` (named for the validation symbol), `ablation_ladder.csv`, `null_summary.md`, `discretion_premium.txt`, `era_split.csv`, `frequency_report.csv`, `timing_report.txt`. Downloadable as one zip.

**Holdout stays off limits** — nothing in this layer loads it. The date cutoff is enforced in the loader, and a run that would touch holdout bars refuses to start.

## Technical notes

- New `shared/quant/ict/sweep.ts`: canonicalisation, hashing, enumeration, sampling, FDR, deflated Sharpe, slippage sensitivity — pure functions, testable, vendored to edge via `npm run quant:sync`.
- New `shared/quant/ict/nulls.ts`: the three null generators, seeded RNG (reusing the unbiased generator already in the repo).
- New `src/workers/ictSweep.worker.ts` plus a small pool manager hook (`useIctSweep.ts`) handling benchmark → confirm → run → checkpoint → merge, with progress and cancel.
- Shards and summary packs stored per run in the private backtest storage bucket, indexed in the existing run-history table so Recent Runs can reopen them.
- New UI: a **Validate** step in `BacktestTab.tsx` (Data → Strategy → Run → Validate) with benchmark card, sweep progress, funnel counts, null percentiles, ablation table and pack download.
- Engine changes are additive only: a per-window single-window restriction mode and a direction-override hook for the shuffled-direction null. No changes to existing fill logic, so current runs stay comparable.
- Tests extend `ictTaughtConfigs.test.ts` plus a new `ictSweep.test.ts`: canonical dedup collapses dead params, sampling is seed-stable, nulls reproduce, DSR matches a worked example, holdout guard trips.

## Suggested build order

1. Canonicalisation + enumeration + hashing + tests
2. Worker pool, benchmark stage, sizing gate, checkpointed shards
3. Sweep run + results table + funnel counts
4. Nulls (a/b/c) and percentile reporting
5. Ablation ladder + discretion premium
6. Statistics (DSR, FDR, era, frequency, slippage) + summary pack + zip
7. Validate-step UI wiring and run persistence
