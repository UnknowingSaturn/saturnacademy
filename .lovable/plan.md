
## Audit Summary

Two parallel audits (math correctness + dead code) returned ~30 findings. The codebase is in reasonable shape — no fabricated metrics or look-ahead leaks — but three classes of issue remain: (a) duplicate pip-size table with wrong index values, (b) client/server math drift in `pairLabMath` / `pairLabSimulator`, (c) accumulated dead UI primitives and one unused parameter.

Plan executes in three passes. Each pass leaves the build green; later passes can be skipped if approved selectively.

---

## Pass A — P0 Correctness Bugs

**A1. Delete the duplicate pip-size table.**
`supabase/functions/_shared/rMultiple.ts` has its own `getPipSize`/`getPipValue` that returns `0.01` for NAS100/SPX (should be `1.0`) and `0.1` for DAX (should be `1.0`) — 10–100× R-multiple errors on the fallback path. Replace both with `pipSizeForSymbol` / `tickSizeForSymbol` from `_shared/quant/symbolMapping.ts`, the single canonical source. Add a one-line warning log when fallback path is used so we can audit if it ever fires.

**A2. Fix `totalDollarsCi` scaling in `pairLabSimulator.ts:507`.**
Current: `[expectancyRCi[0] * n * dollarRisk, expectancyRCi[1] * n * dollarRisk]` treats a CI on the *mean* as if it were a CI on the *sum* — width grows with n instead of shrinking. Either (a) recompute by bootstrapping `sum(R) * dollarRisk` directly, or (b) drop `totalDollarsCi` from the result and report only `meanDollarsCi = expectancyRCi * dollarRisk` (recommended — total-P&L CI is misleading on bootstrap of a fixed-n sample anyway).

**A3. Guard `pnl.ts` against positive-signed commission brokers.**
`gross - Math.abs(commission) + swap` double-subtracts when a broker reports commission as already-deducted (positive). Add a single broker-sign detection in `tradeTransform.ts` ingest pipeline that flags the convention per account; pass a signed `commission` into `computeNetPnl` so the function becomes simply `gross + commission + swap`. Default behavior unchanged for MT5.

---

## Pass B — Statistical Rigor / Drift

**B1. Reconcile prop-firm cap formula (client ↔ server).**
Server `_shared/quant/pairLabMath.ts:522` uses hardcoded divisors `/3` and `/5`, ignores `worstLosingStreak` and `hardCapPct`. Client uses `streak`-aware budget with floor and hard cap. Extract one `computePropFirmRiskCap()` function and import on both sides; align `PropFirmContext` interface (add `worstLosingStreak`, `hardCapPct` to server type).

**B2. Remove dead `trail` parameter from `scoreTp`.**
Both `pairLabMath.ts:766` (client) and `_shared/quant/pairLabMath.ts:298` (server) accept `trail` and immediately `void` it. Drop the parameter, drop the redundant `estimateTrailCapture` call inside `pickBestTp` / `runWalkForward` that exists only to feed it.

**B3. Decorrelate Kelly-CI bootstrap RNG (`pairLabMath.ts:362`).**
Win-rate binomial draw consumes the same RNG stream as payoff resampling within each iteration, weakly coupling `b` and `p`. Fix: pre-generate `nW + nL + n` uniforms per iteration into a typed array, or split into two independent seeded RNGs (one for payoff, one for binomial).

**B4. Honest CI percentile indexing.**
`means[Math.floor(iters * 0.025)]` / `floor(0.975)` reads 2.6th/97.6th percentile at `iters=500`. Switch to linear interpolation between adjacent ranks (standard percentile). Apply in both `bootstrapMeanCi` mirrors.

**B5. Document `downsideStddev` convention.**
`pairLabMath.ts:236` divides squared *downside* deviations by total `n−1` (Sortino "all observations" convention). Behavior is defensible but undocumented — add a 2-line doc comment explaining the choice and the alternative.

**B6. Align server trail-capture with client.**
`_shared/quant/pairLabSimulator.ts:217` hardcodes `TRAIL_CAPTURE_FRAC = 0.8`; client uses bucket-estimated `ctx.trailCapture`. Move `estimateTrailCapture` into `_shared/quant/pairLabSimulator.ts` and thread the per-bucket value through. Eliminates the client/server expectancy mismatch on any preset using a runner.

**B7. Fix `tp1Star` miss-cost assumption.**
`pairLabMath.ts:543` (`hitRate * r - (1 - hitRate) * avgLossR`) treats every miss as a full stop-out; misses can BE/partial. Replace `avgLossR` with the conditional mean R of trades whose MFE < r (empirical miss outcome), falling back to `avgLossR` only when that subset is < 5.

---

## Pass C — Hygiene & Refactor

**C1. Delete 12 orphaned shadcn primitives.**
`src/components/ui/`: `aspect-ratio.tsx`, `breadcrumb.tsx`, `carousel.tsx`, `context-menu.tsx`, `drawer.tsx`, `hover-card.tsx`, `input-otp.tsx`, `menubar.tsx`, `navigation-menu.tsx`, `pagination.tsx`, `radio-group.tsx`, `resizable.tsx`. Zero imports anywhere. Easy revert via `npx shadcn add <name>` if needed later.

**C2. Delete `src/lib/withForwardRef.tsx`.**
Three uses, all discard the ref. Inline the trivial pattern at the three call sites and remove the file.

**C3. Consolidate to a single toast system.**
`src/App.tsx` mounts both shadcn `<Toaster />` and sonner `<Sonner />`; ~14 files use `useToast`, ~15 use `sonner` directly. Pick sonner (already dominant + simpler API). Codemod all `useToast` calls to `toast.success/error/info`; remove `src/components/ui/toaster.tsx`, `src/hooks/use-toast.ts`, `src/components/ui/toast.tsx`, the corresponding `<Toaster />` mount. Single PR, mechanical change.

**C4. Resolve `CopierDashboard.tsx` vs `CopierDashboardView.tsx`.**
586-line `CopierDashboardView.tsx` exists but is not imported. Either delete it or swap `Copier.tsx` to render it (whichever is the intended current implementation — requires a 2-minute read to decide). Flag for confirmation in the implementation pass.

**C5. Fix `runner` preset fractions (`0.34 + 0.33` → `0.33 + 0.33 + 0.34 trail`).**
Cosmetic but the label promises equal thirds. Mirror in both client + server simulator presets.

**C6. Tighten `calculateSimilarity` in `symbolMapping.ts:246`.**
Current "character-set overlap / maxLen" misfires for FX pairs sharing `USD` (similarity 0.5 for EURUSD↔GBPUSD). Replace with a normalized Levenshtein distance (`1 - editDistance/maxLen`). Threshold stays at 0.5; eliminates false matches.

**C7. Remove `as any` casts where typed alternatives exist.**
- `useUserSettings.tsx:153–162,414` — JSONB columns can be typed `Json`.
- `useTrades.tsx:127–128` — `custom_fields` is a known field.
- `tradeTransform.ts` `normalizeReviews`/`transformReview`/`transformTrade` — use `Tables<'trades'>`.
Skip the `(supabase as any).from('filter_presets'|'session_definitions'|'symbol_aliases')` casts — those need a types regeneration which is out of scope.

---

## Explicitly Out of Scope

- Splitting `pairLabMath.ts` (1043 lines) and `TradeTable.tsx` (939 lines) — defer; they work and splitting risks breakage with no immediate payoff.
- Regenerating `src/integrations/supabase/types.ts`.
- Replacing the Monte Carlo engine.
- `slDrift` threshold calibration (P1-4) — needs a noise model first.

---

## Suggested Order

Pass A (correctness, 1 sitting) → Pass C1+C2+C5+C6 (low-risk cleanup, parallel) → Pass B (rigor, careful review) → Pass C3 (toast unification, mechanical but large diff) → Pass C7 (typing).

Confirm to proceed, or pick specific passes/items.
