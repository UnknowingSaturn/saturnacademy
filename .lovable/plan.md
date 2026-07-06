## Verification of the previous pass

I re-audited every item from the last plan against the current code. Ten of the fourteen deliverables landed cleanly and typecheck passes.

### Confirmed complete
- `pathProbTpFirst` (Brownian bridge) + `replayOneTrade` mixture — `shared/quant/stats.ts:458`, `pairLabSimulator.ts:473`
- Replay-mode toggle (Expected · Pessimistic · Optimistic) — `StrategyRanker.tsx:282`
- BCa CI on trail capture, threaded as `effectiveTrailCapture` — `StrategyRanker.tsx:54`
- Šidák-adjusted CI on TP grid winner — `pairLabMath.ts:983`
- TP1* fallback uses median empirical miss cost — `pairLabMath.ts:525`
- slSweep excludes trades with partial fills — `pairLabMath.ts:646`
- Sample-size penalty switched to `1 − 1/√(n/MIN)` — `pairLabSimulator.ts`
- Streak divisor blends observed + `log(N·q)/log(1/q)` expected worst-streak — `pairLabMath.ts:1196`
- `walkForwardKFold` uses numpy `array_split` recipe — `pairLabSimulator.ts:869`
- BH-FDR now runs per-half instead of one pooled family — `idealWindowMath.ts:352-353`
- `ensureUtcMs` in StrategyLab / IdealWindow — `StrategyLab.tsx:117`, `idealWindowMath.ts`
- `bootstrapKellyCiBCa` — `shared/quant/stats.ts:338`

### Gaps found (four items) — this plan closes them

**G1. Kelly-clip transparency (item 2E) — computed but invisible.**
`rawKellyClipped` and `suggestedRiskPctCi` are on the bucket object (`pairLabMath.ts:1163,1232`) but no component renders them. The user still can't tell when the 1.5% ceiling is masking a large raw Kelly.
Fix: in `QuantNotePanel.tsx` next to the risk %, add a small `Cap` badge with tooltip `"Kelly capped at 1.5% — raw was X.X%. Cap is a defence against estimation error at small n; not a suggestion to increase leverage."` Also render the BCa CI band under the risk figure.

**G2. Ranker sensitivity gate (Part 1 deliverable #5) — not implemented.**
`StrategyRanker` recomputes rows when `replayMode` changes but only shows the one active mode. Users can't see how much rankings depend on the ordering assumption without manually flipping the toggle and remembering both numbers.
Fix: compute Expected, Pessimistic, and Optimistic in one pass (three cheap calls to `rankStrategies` — memoised). For each row show:
- Primary: expectancy from the active mode.
- Secondary line when the pessimistic-vs-expected gap exceeds the BCa half-width: `range −0.15 → +1.42R (ordering sensitive)` and downgrade the confidence tier by one step (green→amber, amber→red). Rows with no ambiguous trades render exactly as today (no gap = no badge).
This is the "honest bounds" the plan promised.

**G3. StrategyLab CVaR utility (item 2J) — still on arbitrary constants.**
`scoreCellParts` at `StrategyLab.tsx:60-66` still uses `0.02 × max(0, avgDD − 5)` capped at 0.4 and `0.1 × inconclusiveProb`. Plan called for CVaR-based utility with an exposed λ slider.
Fix: replace `scoreCellParts` with
```text
score = passProb × (1 − riskOfRuin) − λ × max(0, −cvar5Pct) / 100
```
Add a `λ` slider (0…2, default 0.5) in the panel header labelled "Downside aversion (CVaR-5%)". Keep the additive-parts breakdown display; swap `ddPenalty`/`inconclusivePenalty` for a single `cvarPenalty` term shown in the row detail so the score is legible.

**G4. Unit tests for the new pure math (Part 1 verification step, item omitted).**
No `src/lib/__tests__` directory exists. `pathProbTpFirst` and `bootstrapKellyCiBCa` are the two most fragile new functions and have zero regression coverage.
Fix: add `src/lib/__tests__/pathProb.test.ts` (Vitest) with corner cases:
- Equal barriers `pathProbTpFirst(1, 1, 1, 1) → 0.5`
- Only MFE breaches: TP=1, SL=2, MFE=1.2, MAE=0.4 → 1.0
- Only MAE breaches: TP=1, SL=1, MFE=0.5, MAE=1.3 → 0.0
- Symmetric ambiguous: TP=1, SL=1, MFE=1.5, MAE=1.5 → 0.5 ± 0.05
- Asymmetric: TP=1, SL=2, MFE=1.2, MAE=2.3 → weighted to TP-first
And `bootstrapKellyCiBCa` sanity: monotone (larger edge ⇒ CI shifts right), lower ≤ point ≤ upper, respects `n<10` null return.

### Files touched
- `src/components/pair-lab/QuantNotePanel.tsx` — G1 badge + tooltip + CI band
- `src/components/pair-lab/StrategyRanker.tsx` — G2 three-mode compute, range line, tier downgrade
- `src/lib/pairLabSimulator.ts` — G2 helper that returns `{expected, pessimistic, optimistic, ambiguousCount}` in one pass to avoid re-ranking three times per render
- `src/components/pair-lab/StrategyLab.tsx` — G3 CVaR score + λ slider + breakdown
- `src/lib/__tests__/pathProb.test.ts` — new (G4)

No DB, edge-function, or schema changes. No new dependencies. Estimated ~200 lines of surgical changes.

### Verification after build
1. `tsgo --noEmit` clean.
2. `bunx vitest run src/lib/__tests__/pathProb.test.ts` green.
3. Playwright: open `/pair-lab`, confirm (a) Kelly card shows "Cap" badge on a preset where raw > 1.5%, (b) Ranker rows on early-TP presets show the range line and amber/red tier when ordering-sensitive, (c) StrategyLab λ slider moves cell rankings.
