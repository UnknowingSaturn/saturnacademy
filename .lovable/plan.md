# Elite Report Upgrade — Accuracy, Cleanup, and Guardrails

After auditing the last 8 reports + the quant pipeline, three classes of issues are degrading the guidance:

1. **Wrong numbers** — MAE→pip conversion is off by 10× on 5-digit FX, "pips" is mis-labeled on indices, and `delta_vs_current` compares non-overlapping trade subsets (Runner showing "+2.4R uplift" on only 10 of 21 trades).
2. **Missing context** — no prop-firm rules feed the report, top/bottom bucket lists overlap when there are ≤3 buckets, and confidence thresholds are too loose to gate real money decisions.
3. **Dead/duplicate code** — `bandLetter`, `clamp` are unused; ~58 lines of narrative helpers (`worstTradeNarratives`, `symbolExpectancy`, `tiltNarrative`) are computed twice; the LLM has no numeric-grounding check.

## Changes

### 1. Fix unit-conversion bugs (highest impact — wrong numbers leaving the system)
- **MAE / Ideal-SL in pips off by 10×** (`_shared/quant/pairLabMath.ts` + `src/lib/pairLabMath.ts`): drop the `× tick / pip` factor; treat `cf_mae` and `sl_initial`-derived distances as pre-converted pips. Update field comments to pin the contract.
- **Symbol-aware unit label**: add `slUnit: "pips" | "points"` (via `classifySymbol` in `symbolMapping.ts`) to every `QuantBucketSummary`. UI shows the correct unit; LLM stops mislabeling SPX "152.5 pips".

### 2. De-bias the strategy replay comparison
- In `_shared/quant/pairLabSimulator.ts`, add `nComparable` and `biasWarning: boolean` to `PresetReplayResult` — true when `nEligible < totalConsidered × 0.7`.
- Compute a second `expectancyROnIntersection` over the trade set that's eligible for **both** the preset and `current`, so `delta_vs_current` is apples-to-apples.
- Surface both numbers in the quant block; LLM prompt requires citing `n_eligible / total_considered` and using the intersection delta when bias is flagged.

### 3. Surface prop-firm context
- In `computeQuantBlock`, join `accounts → prop_firms → prop_firm_rules` for the report's `account_id`. Pass `{ maxDD, dailyDD, profitTarget }` into `buildBuckets` and into the LLM payload as `prop_firm_context`.
- Server `buildBuckets` gets an optional `PropFirmContext` param (parity with client). Suggested risk %% gets clamped under prop-firm caps; LLM prompt adds rule: "if prop_firm_context is present, frame every risk/SL suggestion in terms of remaining drawdown headroom".

### 4. Tighten confidence + remove overlap
- Raise `confidenceFor`: `n≥50 = high`, `n≥15 = medium`, else `low` (was 30/10).
- In `computeQuantBlock`, ensure top/bottom buckets are disjoint — when fewer than 6 ranked buckets exist, only emit `buckets_top` (no fake "bottom" that is the same list reversed).

### 5. Numeric hallucination grader
- After `callSensei` returns, build a flat `{ pattern: number }` fact map from `metrics.current` + `quant`. Scan each section `body` for decimals; any number not within ±5% of a fact gets flagged in a new `sensei_quality.warnings[]` array stored on the report. UI shows a single inline badge "1 ungrounded figure flagged" — does not block save.

### 6. Cleanup (no behavior change)
- Delete `bandLetter` and `clamp` in `generate-report/index.ts` (dead).
- Extract the narrative builders (`worstTradeNarratives`, `symbolExpectancy`, `tiltNarrative`) into a single helper called by both the main generation path and `buildLlmContext` — removes ~58 lines of verbatim duplication.
- Add a short comment block at the top of each `_shared/quant/*.ts` file documenting that it mirrors `src/lib/*.ts` and listing the intentional divergences (so future drift is visible).

### 7. Prompt upgrades for "The Math" section
- New required clauses: cite `n_eligible vs total_considered`, use intersection delta when biased, reference `slUnit` explicitly, and tie every SL/risk suggestion to prop-firm headroom when present.
- Schema additions to the `quant_advice` tool: `n_eligible`, `bias_warning`, `unit` ("pips" / "points" / "R" / "%").

## Files touched

- `supabase/functions/_shared/quant/pairLabMath.ts` — unit fix, confidence thresholds, doc header
- `supabase/functions/_shared/quant/pairLabSimulator.ts` — bias fields, intersection expectancy
- `supabase/functions/_shared/quant/symbolMapping.ts` — `pipLabelForSymbol`
- `supabase/functions/generate-report/index.ts` — prop-firm join, hallucination grader, dedup of narratives, slUnit wiring, prompt upgrade, delete dead helpers, top/bottom disjoint
- `src/lib/pairLabMath.ts` — mirror unit + confidence fixes so PairLab UI stays correct
- `src/types/reports.ts` — `slUnit`, `bias_warning`, `n_comparable`, `prop_firm_context`, `sensei_quality`
- `src/components/reports/ReportView.tsx` — render correct unit, bias chip, prop-firm headroom line, "ungrounded figures" badge

## Validation

- Re-run report `8528bf3b-…` after deploy; verify:
  - `suggested_sl_pips` for EURUSD/GBPUSD is in a sane range (>5 pips).
  - SPX bucket shows `slUnit: "points"`.
  - Runner replay shows `bias_warning: true` and the LLM's "Math" section qualifies the uplift.
  - Top/bottom bucket lists are disjoint (or bottom is omitted).
  - If account has a prop firm, the report mentions DD headroom.
- Spot-check `sensei_quality.warnings` on the rerun — should be 0 or 1 with the upgraded grounding rule.

## Out of scope (deliberately)

- Extending `BucketKey` with extra dimensions (playbook/direction) — meaningful only once per-bucket sample sizes are larger; revisit when weekly trade counts exceed ~50.
- Merging client `src/lib/*` and server `_shared/quant/*` into a shared package — divergence is intentional (client has interactive `PropFirmContext`/`opts`, server is duck-typed). Doc headers (item 6) are enough for now.
- Backfilling `quant` onto historical reports — only forward reports get the upgraded numbers; old reports remain immutable.
