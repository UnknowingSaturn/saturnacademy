
## Propagate `slSource` to AI reports

The recommendation cascade is correct in the math libs. Two report-layer touch-ups left so AI-generated reports reflect the new SL priority instead of treating ideal SL and MAE as co-equal.

### 1. Carry `slSource` / `slSourceN` into report payloads

**`supabase/functions/pair-lab-report/index.ts`**
- Add `slSource` and `slSourceN` to the `RecommendationShape` type (around line 40) and to the `BaselineShape` if needed.
- Include them in the bucket payload (around line 122) and baseline payload (around line 141):
  ```ts
  suggested_sl_pips: b.suggestedSlPips,
  sl_source: b.slSource,
  sl_source_n: b.slSourceN,
  ```

**`supabase/functions/generate-report/index.ts`**
- Same two fields next to `suggested_sl_pips` at line 1098.

### 2. Update the AI report prompt

**`supabase/functions/pair-lab-report/index.ts`** (around line 181, and the equivalent guidance block):

Replace:
> If slDrift is "too_wide" → suggest tightening to ideal_sl_median. If "too_tight" → suggest widening to mae_p75 × 1.15.

With:
> The recommended SL (`suggested_sl_pips`) is sourced per the `sl_source` field:
> - `ideal_sl`: median of the trader's logged ideal SL across `sl_source_n` trades. Cite the SL as "based on your logged ideal SL".
> - `winners_mae`: MAE-of-winners (no ideal SL logged for this bucket). Cite as "derived from how much heat your winners absorbed (n=…)".
> - `winners_mae_fallback`: MAE p75 × 1.15. Cite as "fallback estimate — log ideal SL on more trades to improve this".
>
> For `slDrift`: "too_wide" / "too_tight" describes how the trader's initial SL compares to their own ideal SL — comment on discipline, not on changing the recommendation.

### Out of scope
- No changes to the simulator's `tighten_to_ideal` / `widen_to_mae_p75` rules — those are intentional user-selectable what-ifs.
- No removal of MAE stats from the UI — `maeP75` remains a useful diagnostic next to ideal SL.

### Files
- `supabase/functions/pair-lab-report/index.ts` — type + payload + prompt edits.
- `supabase/functions/generate-report/index.ts` — payload fields only.

After the edits both edge functions need redeploying.
