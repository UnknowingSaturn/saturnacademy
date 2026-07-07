# SL drift "116000 t" and ideal-SL methodology

## Where the 116000 comes from (root cause)

The number is **wrong** — it's a symbol-classification bug, not real data.

Trace (`shared/quant/symbolMapping.ts`):

1. Your symbol is logged as **`SP500`**.
2. `classifySymbol("SP500")` runs the index regex at line 38, which only matches `SPX`, `US500`, `SPX500`, `NAS100`, etc. The literal string `"SP500"` contains **neither `SPX` nor `US500`** as a substring, so it falls through to `"unknown"`.
3. `defaultTickSize` for `unknown` returns `0.0001` (the FX-5 fallback at line 84).
4. `pipSizeForSymbol` for `unknown` returns `tick * 10 = 0.001`.
5. `slInitialMedianPips = |entry − sl_initial| / pip`. For a real ~11.6-point SP500 stop: `11.6 / 0.001 = 11,600` "pips".
6. Display converts pips → ticks: `11,600 × 0.001 / 0.0001 = 116,000 t`. ✅ Matches your screenshot exactly.

The ideal SL (`125 t`) is stored directly by you in ticks on the custom field, so it renders correctly and doesn't go through the broken classifier path.

**Fix:** extend the index regex to catch `SP500` (and add `NAS`, `NDX100`, `SPX500`, `ES`, `NQ`, `YM` bare forms that also miss today). Then add `SP500` to the per-symbol default-tick block so it gets `0.25` like `SPX500`/`US500`, matching CME.

```ts
// classifySymbol regex — add SP500, NDX100, NAS, ES, NQ, YM, RTY
/(NAS100|NAS|US100|USTEC|NDX|NDX100|SPX|SPX500|SP500|US500|ES|NQ|YM|RTY|US30|…)/
// defaultTickSize — extend the SPX/US500 branch
if (/^(SPX500|SP500|US500|ES)/.test(n)) return 0.25;
```

I'll also add a **unit test** for `classifySymbol`/`tickSizeForSymbol` over the common index aliases (`SP500`, `SPX`, `NAS`, `NAS100`, `US30`, `DAX`, `DE40`) so this regression can't silently return.

## Is this the most optimal way to compute the ideal SL in walk-forward?

Short answer: **no — the current "ideal SL" is not a walk-forward estimator at all.** It's just the median of a user-entered custom field (`Ideal Stop-Loss`) across the whole in-scope bucket (`src/lib/pairLabMath.ts:660-665, 694`). Two structural issues:

1. **It's the same value at every point on the causal chart.** `estimateBucket` computes one median over `rows`, so the "ideal" line doesn't evolve as trades accumulate — no walk-forward property.
2. **The SL-drift verdict compares planned vs. ideal medians only.** It ignores whether the ideal SL would actually have *survived* the realized MAE distribution — so "aligned" can still bleed at −1R on the tail.

Proposed upgrade (kept behind the existing custom-field path, no schema changes):

- **Rolling / expanding-window ideal SL.** For each trade `i` in causal order, recompute `idealSL_i` from trades `[0..i−1]` (expanding) or the last `W` (rolling, default 20). Render as a second series on the "Expectancy over time" chart so drift is visible.
- **MAE-quantile anchor as the objective.** The best-supported causal rule is: pick the smallest SL that keeps the winners' MAE inside the stop. Formally `SL* = quantile(MAE_winners, q)` with `q ∈ {0.85, 0.90, 0.95}`, then sanity-check by replaying at that SL and picking the `q` that maximises out-of-sample `E[R]`. This is exactly the formula already documented under the panel (`SL = p90(winners' MAE) × 1.10`) but the number rendered isn't computed that way — it just reads the user field. I'll wire the real computation.
- **Confidence gating.** Suppress the "ideal SL" pill when the winners' MAE sample `< 8` (current sweep already needs 10; matching thresholds).
- **Keep the user's custom-field value as a manual override**, shown as a third dotted reference when present, so your journaled judgement stays visible next to the data-driven number.

## Scope of changes

1. `shared/quant/symbolMapping.ts` — extend index regex + per-symbol tick defaults; add tests in `src/lib/__tests__/`.
2. `src/lib/pairLabMath.ts` — add walk-forward `idealSlSeries` (expanding + rolling) and MAE-quantile-based `idealSlDataDriven` alongside the existing custom-field median; both surfaced on `BucketStats`.
3. `src/components/pair-lab/QuantNotePanel.tsx` — show data-driven ideal SL as primary, journaled value as secondary reference; add a small series to the expectancy chart.
4. Tests: symbol classification, MAE-quantile ideal-SL determinism, and a fixture proving the SP500 bug is fixed (`11.6-point stop → ~46 ticks`, not 116000).

## Out of scope

- No DB migrations, no changes to how the `Ideal Stop-Loss` custom field is captured.
- No Journal changes.
- No changes to the sweep / replay math beyond consuming the new ideal-SL value.
