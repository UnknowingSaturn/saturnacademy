# Codebase Audit — Quant Math, Drift & Cleanup

Two parallel audits surfaced (a) systematic math bugs that silently bias every Pair Lab recommendation, (b) drift between client `src/lib/*` and edge function `_shared/quant/*` mirrors, and (c) dead code from previous refactors. Below is what to do, grouped by risk.

---

## P0 — Correctness bugs (wrong numbers, silent)

### Quant math

1. **`scoreTp` trail formula is wrong** — `src/lib/pairLabMath.ts:752` and mirror `supabase/functions/_shared/quant/pairLabMath.ts:290`
   - Bug: `sum += p.rActual * trail` discounts an already-realized exit by `trailCapture` (e.g. ×0.7), understating expectancy for every winner where MFE < TP.
   - Fix: when no TP would have triggered, use `p.rActual` unchanged (true realized outcome). The `* trail` factor only belongs on the *hypothetical* trail branch (`mfeR * trail`).
   - Impact: biases the TP-grid argmax low → every bucket's recommended TP is too tight. Affects walk-forward OOS scores and AI report TP suggestions.

2. **`computeRMultiple` equity fallback returns a percentage, not an R** — `supabase/functions/_shared/rMultiple.ts:92`
   - Bug: `netPnl / equityAtEntry × 100` is % return on account, stored in the `r_multiple_actual` field.
   - Fix: return `null` and surface a "missing risk data" flag instead of an economically incorrect ratio. Better to drop the trade from bucket stats than poison them.

3. **JPY pip value hardcoded to 7.5** — `supabase/functions/_shared/rMultiple.ts:23`
   - Bug: pip value depends on live USDJPY; 7.5 is right at ¥133/$, off 10–35% across normal range.
   - Fix: prefer `grossPnl / (totalPoints × lots)` (already primary path); when truly fallback, compute `lots × 10 / usdjpyAtClose` using the close price already stored on the deal. If not available, return `null`.

4. **`Math.abs(swap)` flips carry credits into costs** — `supabase/functions/_shared/pnl.ts:12`
   - Fix: `gross - commission + swap` (MT5 swap is already signed). Audit `tradeMath.ts` callers for the same pattern.

5. **`bootstrapKellyCi` resamples from a combined wins+losses pool** — `src/lib/pairLabMath.ts:349`
   - Fix: resample wins and losses as independent arrays with their own counts; recombine for `p` and `b`. Removes spurious anti-correlation in CI bounds.

### Cross-boundary drift (client ↔ edge function)

6. **`PropFirmContext` schema mismatch** — client uses `firmName / riskPerTradeFrac / hardCapPct`; server uses `firm / profitTargetDollars`. Pick one shape and re-export from a shared module.

7. **`BucketReport` field names differ**:
   - `idealSlMedian` (client) vs `idealSlMedianPips` (server)
   - `slInitialMedian` vs `slInitialMedianPips`
   - `suggestedRiskPctPropFirm` vs `suggestedRiskPctPropFirmCap`
   - Client has 8 extra fields (`winRateCi`, `profitFactor`, `payoffRatio`, `slSweep`, `riskBelowFloor`, `bindingConstraint`, `edgeVsBaseline`, `suggestedRiskPctCi`) the server never produces.
   - Fix: align server output to client shape; add the 8 missing fields server-side so `QuantNotePanel` doesn't silently read `undefined`.

8. **Server `Tp1Star` missing `hitRateCi`** — `_shared/quant/pairLabMath.ts:191`. Add it; mirror the client formula.

### Dead references from prior refactor

9. **Stale comment** — `src/lib/propFirmMonteCarlo.ts:8` still references deleted `RiskOptimizationLab` / `RotationSimulator`. Update.

10. **Four orphaned components, zero inbound imports** — delete:
    - `src/components/dashboard/MetricCard.tsx`
    - `src/components/journal/ScreenshotUpload.tsx`
    - `src/components/journal/settings/ColumnConfigPanel.tsx` (687 lines)
    - `src/components/playbooks/PlaybookStatsCard.tsx`

---

## P1 — Statistical rigor & consistency

11. **Block-bootstrap block size** — `propFirmMonteCarlo.ts:121,248`. Switch `Math.sqrt(N)` → `Math.round(N^(1/3))` (Politis–Romano optimal). Over-smoothing currently inflates path variance ≈ more simulated busts than reality.

12. **Walk-forward look-ahead leak** — `pairLabMath.ts:830` estimates `trailCapture` from OOS rows. Force OOS trail = IS trail. Also report `oosN = oosPairs.length` not `oosRows.length` (true DoF for `scoreTp`).

13. **`computeTp1Star` ad hoc scoring** — `pairLabMath.ts:534`. Replace `hitRate × log(1+r)` with the `expectancyR` already computed one line below.

14. **Sortino denominator** — `pairLabMath.ts:241` uses `n-1`; textbook Sortino uses `n`. Either fix to `n` or rename the metric to "downside-σ Sharpe (Bessel-corrected)" to avoid misinterpretation.

15. **Bootstrap iteration count** — `pairLabMath.ts:789` uses 200; everywhere else 500. Standardize on 500 for stable 2.5%/97.5% bounds.

16. **Server vs client divergence**:
    - `buildBuckets` sort key: server `expectedR × n`, client `n`. Pick one (recommend `n` for stability).
    - `estimateTrailCaptureRows`: server `minSample=5`, client `=10`. Standardize at 10.

17. **`StrategyLab` score is dimensionally inconsistent** — `StrategyLab.tsx:48`. `passProb × survival` is 0–1, but `ddPenalty = 0.5 × (DD% − 5) / 100` maxes at ~0.1 for 25% DD. Rescale to `0.5 × max(0, DD% − 5) / 100` → `0.02 × max(0, DD% − 5)` so a 25% DD costs 0.4 in score. Surface the breakdown in the detail card.

18. **`StrategyLab.autoTradesPerDay` uses active-day denominator** — inflates TPD for traders who skip Fridays. Switch to calendar-day denominator over the observed range, or use the median.

19. **BH FDR pool mixes per-cell + per-row buckets** — `BucketGrid.tsx:103`. These are non-independent (row aggregates contain the cells). Run BH on `perCell` only; either exclude `perRow` or apply a separate correction.

20. **Static vs trailing DD in the deterministic simulator** — `pairLabSimulator.ts:491`. Mirror the `maxLossMode` toggle that already exists in `propFirmMonteCarlo`, and wire it through `StrategyLab` so the deterministic preview matches the MC config.

21. **Sharpe/Sortino in simulator are per-trade R ratios, not annualized** — relabel in the UI ("per-trade R Sharpe") or annualize with detected trade frequency.

---

## P2 — Quant-grade improvements & hygiene

22. Add **geometric-mean R** alongside arithmetic mean (arithmetic overstates compounded growth at high R variance).
23. Add **Expected Shortfall (CVaR-5%)** alongside max-DD and Sortino.
24. Add **half-Kelly** as an explicit UI alternative (currently only quarter-Kelly is surfaced).
25. Add `totalRuinProb` metric (all accounts bust) alongside the existing "any account busts" `riskOfRuin`.
26. **Deduplicate `getPipSize`** — `rMultiple.ts` has its own table; `_shared/quant/symbolMapping.ts` has a richer one. Import from the latter.
27. **Symbol matching** in `rMultiple.ts` uses ordered `String.includes` — fragile. Replace with a lookup map keyed by `classifySymbol`.
28. **Toast system unification** — 17 files use shadcn `useToast`, 19 use sonner, both `<Toaster>` mounted in `App.tsx`. Pick sonner; migrate and delete `use-toast.ts` + `toaster.tsx`.
29. **Pointless re-aliasing** — `App.tsx:44–47`. Import with final names; delete 4 lines.
30. **`pairLabPresets.ts` duplicates `STRATEGY_PRESETS` from `pairLabSimulator.ts`** — merge into one source.
31. **`withForwardRef.tsx` wraps Radix primitives unnecessarily** (2 callers) — inline `React.forwardRef`, delete the util.
32. **Edge-function `any` typing** — `tradeEventProcessor.ts`, `healthEvents.ts`, `apiKey.ts`, `session.ts`, `accountResolver.ts`. Import `SupabaseClient` and the existing `TradeEvent` union.
33. **Files >500 lines that mix concerns** — split (lower priority, can be incremental):
    - `generate-report/index.ts` (1722) → prompt builder / section renderers / metrics aggregator
    - `TradeTable.tsx` (939), `Playbooks.tsx` (886), `useUserSettings.tsx` (788), `ReportView.tsx` (778), `pairLabMath.ts` (1016), `pairLabSimulator.ts` (742)

---

## Suggested execution order

Three focused passes so each is independently verifiable:

**Pass A — Quant correctness (items 1–8)**
Touches: `pairLabMath.ts` (×2), `rMultiple.ts`, `pnl.ts`. Validate by comparing recomputed bucket stats against a saved snapshot of current values on a few real trades, then patching any unit tests if present.

**Pass B — Dead code & drift cleanup (items 9, 10, 26, 29, 30, 31)**
Pure deletes + import swaps. Fast, low-risk, makes Pass C smaller.

**Pass C — Statistical rigor & UX (items 11–25)**
Touches: `propFirmMonteCarlo.ts`, `StrategyLab.tsx`, `BucketGrid.tsx`, `pairLabSimulator.ts`. Add the static/trailing-DD toggle and dimensional fix to the score formula. Surface geometric R + CVaR in `QuantNotePanel`.

**Deferred — Toast unification & large-file splits (items 28, 33)**
Mechanical but touches 30+ files; do as a separate dedicated PR.

---

## Out of scope

- Replacing the MC engine, regenerating Supabase types, or moving to a worker thread.
- Annualizing per-trade Sharpe (needs design choice on trade frequency normalization — flagged for follow-up).
- Splitting `integrations/supabase/types.ts` (auto-generated).

Tell me if you want to drop any sections or re-order; otherwise I'll execute Pass A first.