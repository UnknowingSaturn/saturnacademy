# Results dashboard, reporting pass, and the holdout run

Three pieces on top of the finished sweep: a 1080p dark dashboard with per-panel PNG export, a
tightened reporting pass, and a one-shot holdout run that cannot be quietly repeated.

## 1. Results dashboard (13 panels)

A new **Results** view inside the Validate step, shown once a sweep report exists. Every panel is
drawn as a fixed 1920x1080 SVG with its own viewBox, so what you see scaled in the app is exactly
what exports — no screenshot library, no layout drift between screen and export.

Panels, in the order given:

1. Funnel — configs tested, profitable gross, profitable net, net Sharpe >= 0.5, survived FDR,
   survived validation.
2. Net Sharpe distribution across all discovery configs, with the random-entry null overlaid.
3. Trade-frequency spectrum — trades/year across the population on a log x-axis, the three named
   configs marked.
4. Ablation ladder — six labelled bars, the perfect-bias rung flagged as lookahead.
5. Real result vs the three null distributions, real result marked.
6. Discovery vs validation net Sharpe scatter for survivors, with the y=x line.
7. Per-year heatmap of average R for the survivors.
8. Era split — pre-2022 vs 2022 onward.
9. Discretion premium — one large number (the share of losers you must skip in advance to break
   even) with a one-line caption.
10. Named-config win rates against the taught 70-80% band, band drawn as a shaded strip.
11. Cost sensitivity — net Sharpe vs slippage assumption.
12. Percent of trades that hinged on the ambiguous-bar assumption.
13. Equity curves — best realistic config with the null band shaded, plus as_taught_5m on the same
    panel (and your journal's real trades for the symbol when the range overlaps).

Export: one button per panel plus **Export all panels** (zip of thirteen 1920x1080 PNGs). Export
rasterises the panel SVG through a canvas at exactly 1920x1080; theme colours are resolved from the
design tokens at export time so the PNGs carry the same dark palette.

Three panels need data the sweep does not currently keep, so those get collected during the run:

- Per-iteration Sharpe for the random-entry null (panel 2 overlay) — the null worker already runs
  the iterations, it just returns mean R today.
- Per-year stats for survivors, not only for the reference configs (panel 7).
- Funnel counts for "profitable gross", "profitable net" and "Sharpe >= 0.5" (panel 1).

## 2. Reporting pass

The summary pack already emits results_configs.csv, funnel_counts.json, named_configs_report.md,
null_summary.md, ablation_ladder.csv, discretion_premium.txt and frequency_report.csv. Two changes:

- Rename `validation.csv` to `<validation_symbol>_validation.csv` so the file names itself.
- Add a short `README.md` to the pack listing what each file answers, and note explicitly that raw
  bars and full trade logs are deliberately excluded.

## 3. The holdout, run once

A fourth card in the Validate step, locked until a sweep report exists.

- Runs the top three survivors plus all named configs on the holdout era only
  (from the holdout start month to the most recent ingested month) — no sweep, no selection.
- Requires typing the symbol to unlock, and states plainly that the result stands whatever it says.
- Before running, it checks run history for an existing holdout run on this symbol; if one exists
  the card shows that result instead of offering a re-run.
- The run is saved to history with the holdout flag set, together with the config hashes it used,
  so the record shows exactly which configs were locked in beforehand.

## Technical notes

- New: `src/components/pair-lab/backtest/dashboard/` — one component per panel plus a shared
  `Panel1080` frame (axes, title, footnote, palette) and `exportPanels.ts` (SVG to PNG to zip,
  reusing the existing zip writer in `summaryPack.ts`).
- `src/workers/ictSweep.worker.ts`: `nullResult` gains `randomEntrySharpe: number[]`.
- `src/hooks/useIctSweep.ts`: computes the extra funnel counts, keeps per-year rows for survivors,
  and gains a `runHoldout()` action guarded by a history lookup.
- `shared/quant/ict/sweep.ts`: an `assertHoldoutOnly()` counterpart to the existing guard, so the
  holdout path can only load holdout-era bars and the discovery path still cannot touch them.
- No schema changes: the holdout run uses `backtest_runs.include_holdout`, which already exists.
