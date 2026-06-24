
# Pair Lab restructure — full quant view for ideal entry windows

Goal: for each pair, identify the **hour × half** buckets that show a statistically meaningful edge — measured by both worked-rate and expectancy (R) — with optional conditioning on regime and direction, and a 15-min sub-grid drill-down for precision.

## What changes in the UI

Pair Lab gets a new tab: **Ideal Windows** (becomes the default). Existing Grid / Strategy Lab / Intra-hour / Aliases tabs stay untouched.

### Layout

```text
┌─ Filter bar ────────────────────────────────────────────────────┐
│ Pair: [EURUSD ▾]   Hours: [07 08 09 10 11 20 21]                │
│ Optional: Regime [Any ▾]  Direction [Any ▾]  Date [All ▾]       │
│ Min N: [20 ▾]   Sort by: [Lift ▾ | Expectancy | Worked-rate]    │
└─────────────────────────────────────────────────────────────────┘

┌─ Baseline strip ────────────────────────────────────────────────┐
│ EURUSD baseline   worked: 64% (n=312)   expectancy: 0.41R       │
└─────────────────────────────────────────────────────────────────┘

┌─ Heatmap (only the hours you selected) ─────────────────────────┐
│                  1st half                  2nd half             │
│  07:00   58% · 0.22R · −0.19R  (n=12)   71% · 0.55R · +0.14R ★  │
│  08:00   82% · 0.91R · +0.50R★ (n=27)   44% · −0.05R · −0.46R   │
│  09:00   70% · 0.48R · +0.07R  (n=20)   65% · 0.39R · −0.02R    │
│  10:00   —   (n=6, below N)             55% · 0.18R · −0.23R    │
│  11:00   63% · 0.35R · −0.06R           78% · 0.78R · +0.37R ★  │
│  20:00   90% · 1.10R · +0.69R★ (n=21)   50% · 0.05R · −0.36R    │
│  21:00   67% · 0.42R · +0.01R           73% · 0.60R · +0.19R    │
│                                                                 │
│  Color = lift vs baseline (green/red diverging)                 │
│  Opacity = sample-size confidence                               │
│  ★ = bucket differs from baseline at p<0.05 (one-prop z-test)   │
│  Greyed cell = n < min-N (directional only)                     │
└─────────────────────────────────────────────────────────────────┘

┌─ Cell drill-down (click cell) ──────────────────────────────────┐
│  EURUSD · 08:00 · 1st half                                      │
│  Worked: 22 / 27   Wilson 95% CI: 64% – 92%                     │
│  Expectancy: 0.91R   Bootstrap 95% CI: 0.42R – 1.38R            │
│  Lift vs baseline: +0.50R   z=2.31  p=0.021                     │
│                                                                 │
│  15-min sub-grid (entry time within the half):                  │
│    08:00–08:15   83% · 1.20R  (n=12) █                          │
│    08:15–08:30   80% · 0.55R  (n=15) ░                          │
│                                                                 │
│  Trades feeding this bucket: [list with links to journal]       │
└─────────────────────────────────────────────────────────────────┘
```

### Filter behavior

- **Hours** — multi-select chip row, default = hours with ≥1 trade for the pair, user override persisted in `user_settings`.
- **Regime** — Any / Rotational / Transitional / any custom regime option. Source: `trades.actual_regime` falling back to `trade_reviews.regime`.
- **Direction** — Any / Long / Short.
- Filters are *conditioning*, not just visual hides — stats recompute on the filtered trade subset, including the baseline strip.

## Stats math (all pure functions in `src/lib/idealWindowMath.ts`)

Per `(pair, hour, half)` bucket within the filtered trade set:

- `worked` / `failed` from `setup_worked_halves` / `setup_failed_halves` (existing `hourSetup.ts` helpers). Trade W/L ignored.
- `n = worked + failed`
- **Worked-rate:** `rate = worked / n`, with `wilsonInterval(worked, n, 0.95)`.
- **Expectancy (R):** mean of `trade.r_multiple` across the same trades, plus a 1,000-iter bootstrap 95% CI on the mean.
- **Baseline:** same stats computed over all filtered trades for the pair (ignoring hour/half).
- **Lift:** `expectancy_bucket − expectancy_baseline` (primary sort key) and `rate_bucket − rate_baseline`.
- **Significance flag:** one-proportion z-test of bucket worked-rate vs baseline worked-rate, p<0.05 → ★.
- **Min-N gate:** cells with `n < minN` (default 20, user-adjustable to 10/30/50) → greyed, no color, no ★.
- **Sub-grid:** on drill-down, partition the bucket's trades into 15-min sub-bins by entry minute and recompute rate + expectancy (no CI — sample too small for CI, just directional).

## Technical details

- New `src/lib/idealWindowMath.ts`:
  - `bucketTrades(trades, hours, filters): Map<BucketKey, BucketStats>`
  - `wilsonInterval(k, n, z=1.96)`
  - `bootstrapMeanCI(values, iters=1000, alpha=0.05)` — deterministic seed for reproducibility
  - `oneProportionZTest(k1, n1, k2, n2): { z, p }`
  - `computeBaseline(trades)`
  - `subGridFifteenMin(trades, hour, half)`
- New `src/components/pair-lab/IdealWindowHeatmap.tsx` — filter bar, baseline strip, heatmap grid, drill-down panel. Consumes `useTrades`, `useUserSettings`, `useCustomFields` (for regime options).
- `src/pages/PairLab.tsx` — add `Ideal Windows` as the first / default tab.
- `user_settings` gets a single `ideal_window_hours INT[]` column (confirmed at build time after reading `useUserSettings.tsx`; if a JSON prefs blob already exists, store there instead — no schema change).
- Reuses existing `r_multiple`, `actual_regime`, `direction`, `entry_time` fields on `trades`. No edge functions, no new tables.

## Out of scope (deferred)

- Auto-classified regime from price data.
- Session / killzone / day-of-week / news / volatility slicing.
- Auto-ranked cross-pair watchlist and live "what to trade now" view.
- Walk-forward / out-of-sample decay monitoring.
- Position sizing, prop-firm drawdown integration, equity overlay.
- Sub-grid CIs (sample sizes too small to be meaningful).
