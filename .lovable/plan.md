# Audit + fix: MAE displayed in ticks, not R

## Audit — all six additions wired correctly

| Feature | Status | Where |
| --- | --- | --- |
| Shared MC engine | ✅ | `src/lib/propFirmMonteCarlo.ts` |
| Risk Optimization Lab tab | ✅ | `PairLab.tsx` → `RiskOptimizationLab` |
| Rotation Simulator tab | ✅ | `PairLab.tsx` → `RotationSimulator` |
| MAE/MFE matrix tab | ✅ | `PairLab.tsx` → `MaeMfeMatrix` |
| Extended dashboard metrics (Sharpe, recovery, consec W/L, max DD, monthly heatmap, R distribution) | ✅ | `Dashboard.tsx` → `ExtendedDashboardMetrics` |
| Challenge Planner cards | ✅ | `Accounts.tsx` → `ChallengePlannerCard` |
| Extended `DashboardMetrics` type | ✅ | `src/types/trading.ts` |
| Typecheck | ✅ | `tsc --noEmit` clean |

Nothing missing. The five new files exist, are imported, and the page renders (your screenshot proves the Grid renders).

## Fix — MAE is the tick value you record from TradingView's measure tool

You record MAE in **ticks** (raw input), and that's how you want to read it back. The current UI converts ticks → R for display, which makes the number small and abstract (e.g. `MAE 0.04R`). MFE stays in R as designed.

### Math layer — add raw-tick aggregates (no conversion)

In `src/lib/pairLabMath.ts`:
- Extend `BucketStats` with `maeP50Ticks: number | null` and `maeP75Ticks: number | null`.
- In `computeBucket`, push `Math.abs(maeTicks)` for every closed trade with the MAE custom field set (no pip/SL gating required — ticks are unit-free per symbol).
- Populate `maeP50Ticks = median(...)` and `maeP75Ticks = quantile(..., 0.75)` alongside the existing R/pip aggregates.
- **Keep** `maeP50`, `maeP75`, `maeP75Pips` — the SL sweep and recommendation math depend on R/pip values internally. Only the display layer changes.

### Display layer — swap R for ticks in three places

1. **`BucketGrid.tsx`** (the cells in your screenshot):
   - Current: `MFE 2.45R · MAE 0.04R`
   - New: `MFE 2.45R · MAE 87 t`
   - Render `b.maeP75Ticks?.toFixed(0)` with a `t` suffix.

2. **`QuantNotePanel.tsx`** "MAE p50/p75" cell:
   - Current: `0.85 / 1.20R`
   - New: `87 / 142 t`
   - Use `b.maeP50Ticks` / `b.maeP75Ticks`.

3. **`MaeMfeMatrix.tsx`** cells + verdict:
   - Cell MAE rendered in ticks: `MAE 87 t` (compute mean ticks per cell directly from `getCf(t, fieldKeys.mae)`).
   - Verdict thresholds no longer make sense as R-thresholds — switch the verdict to use the **bucket's existing `slDrift` signal** (ideal-SL ÷ planned-SL ratio: too_wide / too_tight / aligned). This is the same source of truth the QuantNotePanel uses for its drift badge, so the matrix stops contradicting it.

4. **Legend** below the ranker: change `"MAE & Ideal-SL in ticks · MFE & TP targets in R"` — it already says ticks, just confirm it now matches reality everywhere.

### Why not pips?

`maeP75Pips` exists internally for the SL sweep math. We don't surface pips in the UI because your input device (TradingView measure tool) gives ticks directly — converting back to pips on read would only add a number you'd have to mentally re-convert.

## Verification

Open `/pair-lab` Grid tab on a populated bucket (e.g. EURUSD · Tokyo with N22) and confirm `MAE` reads as an integer with `t` suffix, not `R`. Repeat on QuantNotePanel ("MAE p50/p75") and the MAE/MFE matrix. Numbers should match the raw values you typed into the journal.
