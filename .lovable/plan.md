Audited `src/lib/pairLabMath.ts`, `src/lib/pairLabSimulator.ts`, `src/hooks/usePairLab.tsx`, the shared edge-function versions, and all `pair-lab` UI components. Findings below are grouped by accuracy bugs (must-fix) and quant additions (opt-in). Every item cites the file:line where it lives.

## A. Data-accuracy bugs (recommend fixing all)

1. **CI label says "90%" but bootstrap is 95%** — `RecommendationCard.tsx:142` says `90% CI` while `pairLabMath.ts:189` uses percentiles 0.025/0.975. Change label to `95% CI`.
2. **"closed trades in scope" counter includes open trades** — `usePairLab.tsx:160` reports `trades.length` (raw, includes open) but `PairLab.tsx:69` labels it "closed". Count `is_open === false` only.
3. **`slDrift` divide-by-zero on frontend** — `pairLabMath.ts:436` divides by `slInitMed` without the `> 0` guard the server has at `_shared/quant/pairLabMath.ts:289`. Add the guard.
4. **Frontend ↔ server parity drift** (same bucket, two different answers):
   - Prop-firm risk cap formulas differ (`pairLabMath.ts:522` empirical streak vs server's fixed `÷3 / ÷5`).
   - Bootstrap iters differ (500 vs 400) → CI bounds disagree.
   - Server's `buildBuckets` skips `resolveSym()` (`_shared/quant/pairLabMath.ts:380`) → AI quant note groups by raw broker symbol.
   - Frontend session normalizer misses `new_york_am/pm` that the server handles.
   Pick one canonical implementation (recommend: lift frontend logic into the shared module and import from both sides).
5. **TP-ladder percentile variable names are inverted** — `pairLabMath.ts:499` (`p70 = quantile(..., 0.3)`). Computation is correct, names are misleading. Rename to avoid a future regression.
6. **Quarter-Kelly silently floored at 0.25%** — `pairLabMath.ts:201`. When the raw Kelly is e.g. 0.03%, the UI prints 0.25% with no warning. Surface "edge below floor" badge instead of hiding it.
7. **`be_after_first_tp` runner with no partials exits at 0R** — `pairLabSimulator.ts:327`. Add an eligibility check that requires at least one partial when this runner is selected.
8. **Matched-sample `ineligibleReasons` inflated** — `pairLabSimulator.ts:549`. The tooltip counts strategy-level ineligibility, not intersection-level. Filter to reasons that actually caused intersection drops.
9. **Stale unit comment in simulator** — `pairLabSimulator.ts:185` says "MAE is logged in broker TICKS" but the call chain (`tradeMaeR → slDistancePips → pipSizeForSymbol`) treats it as pips. Fix the comment to match contract in `pairLabMath.ts:23`.
10. **`sim_risk_per_trade_pct` is dead code in the simulator** — stored in profile (`useSimulatorProfile.tsx:8`), threaded through `usePairLab.tsx:129`, but `replayBucket` uses the slider value from Ranker/Compare. Either feed the profile value as the slider default or remove the field.
11. **AI quant note fires for N=1** — `QuantNotePanel.tsx:114` only disables on `n===0`. Gate on the existing low/med/high confidence (require ≥ low, i.e. N ≥ 10) to stop the LLM from hallucinating on a single trade.
12. **`StrategyRanker` tiebreaker is total $, not risk-adjusted** — `pairLabSimulator.ts:83`. Tiebreak on expectancyR / sd(R) (Sharpe-of-R) so a strategy with more eligible trades doesn't auto-win.

## B. Quant features worth adding (rank in order of value)

Only features that are implementable from fields already in your data are listed.

1. **Wilson CI on TP-hit rates and win rate.** Today `tp1Star.hitRate` and `winRate` are point estimates. A Wilson 95% interval on the binomial proportion is a one-liner and immediately tells you when a "62% win rate" is really `[40%, 81%]` at N=20.
2. **Profit factor + payoff ratio per bucket.** Both derive from existing `winR`/`lossR` arrays at `pairLabMath.ts:387`. These are the two most-used discretionary-trading metrics and currently missing from `BucketStats`.
3. **MAE-based stop-loss optimization curve.** Replace the single heuristic SL suggestion at `pairLabMath.ts:436` with a sweep: for SL ∈ [p25_MAE, p90_MAE], compute the % of trades stopped and ΔE[R]. Renders as a small curve in `RecommendationCard`, mirroring the TP1* idea on the loss side.
4. **Empirical trail-capture ratio.** Replace the hardcoded `TRAIL_CAPTURE_FRAC = 0.8` (`pairLabSimulator.ts:26`) with the per-user median of `r_actual / MFE` across trades where both are present and `r_actual > 0`. Falls back to 0.8 when sample < 10.
5. **Sharpe / Sortino on the simulated R series.** `rs` already exists at `pairLabSimulator.ts:384`. Add `mean(rs)/std(rs)` and downside-only variant to `SimulationResult` so Compare/Ranker can rank by risk-adjusted return, not raw $.
6. **Underwater equity (drawdown) chart in `EquityCurveOverlay`.** `maxDrawdownDollars` is computed but only shown as a scalar. Plotting `equity - runningMax` next to the cumulative curves visually separates two strategies that finish at the same P&L but with very different drawdown depth.
7. **Walk-forward / out-of-sample split for the Ranker.** Split trades chronologically (e.g. first 70% in-sample → choose winner → verify on last 30%). Surfaces overfitting and is mandatory for any strategy-selection workflow over many candidates.
8. **Multiple-testing badge on the grid.** With M buckets shown, flag any "winning" cell whose nominal p-value doesn't survive a Benjamini–Hochberg adjustment at q=0.10. Stops users from trading the one (symbol × session) that lit up by chance.
9. **Kelly CI.** Bootstrap the quarter-Kelly fraction so the UI shows `0.8% (CI 0.1% – 1.6%)`, matching the existing expectancy CI treatment.

## C. Open questions before I touch code

1. **Unit of MAE in your data** — is it always pips, always ticks, or mixed? The simulator comment says ticks, the math contract says pips. If any of your existing rows are in ticks, every MAE-derived number (SL suggestion, trail capture, stop-optimization curve) is wrong by 10–100×.
2. **`r_multiple_actual`: gross or net of commissions/swap?** If gross, every R metric (expectancy, Kelly, Sharpe) overstates the strategy because cost drag is invisible. Trade win/loss classification (`pairLabMath.ts:374`) can flip if gross R disagrees with `net_pnl`.
3. **Partial fills** — does one logical trade ever exist as multiple rows in `trades`? If yes, `buildBuckets` is double-counting and MFE/MAE quantiles are distorted; we need an aggregation step first.
4. **Scope for this iteration** — Section A only (bugs)? A + top 3 of B? Everything? My recommendation: do **all of A** + **B1 (Wilson CI), B2 (profit factor / payoff), B5 (Sharpe), B6 (drawdown chart)** in one pass — they share the same files, are low-risk, and cover the highest-leverage gaps. Defer B3/B4/B7 to follow-ups since they each need their own design discussion.

## Technical notes

```text
pairLabMath.ts        ── canonical math; lift to shared module to fix parity drift
pairLabSimulator.ts   ── add Sharpe/Sortino to SimulationResult, fix tiebreaker
_shared/quant/*       ── re-export from shared, drop duplicated implementations
RecommendationCard    ── CI label fix, Wilson intervals, PF/payoff chips
EquityCurveOverlay    ── add underwater-equity series
usePairLab.tsx        ── exclude open trades from totalTrades, gate AI note
QuantNotePanel.tsx    ── disable Generate when confidence < low (N < 10)
```

No DB migrations needed for Section A or the recommended B subset. Walk-forward (B7) and the MAE optimization curve (B3) would each warrant a follow-up plan.

**Tell me which scope to ship and answer the three questions in section C, and I'll proceed.**