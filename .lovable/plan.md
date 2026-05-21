## Why the report shows 0% today

The analyzer slices trades by up to 4 dimensions at once. With `time_bucket` (96 possible 15-min UTC slots) in the mix, plus `cf_*` custom fields, the joint cells get starved and almost never reach `n ≥ 20`. The hard cutoff then renders the whole report as 0% confident.

The fix is to (a) stop fragmenting samples, (b) always surface single-dimension marginals — which is what a user with <500 trades actually needs — and (c) report coverage honestly.

Scope: `supabase/functions/scalp-edge-analysis/index.ts` and `src/components/strategy-lab/ScalpEdgeReport.tsx`. No new tables, no journaling changes, no chat-side changes.

## Changes

### A. `supabase/functions/scalp-edge-analysis/index.ts`

1. **Drop `time_bucket`, add `session_phase`.** Replace the 15-min UTC bucket with a 3-value phase derived from `trade_features.time_since_session_open_mins`: `open` (<60), `mid` (60–180), `late` (≥180). Cardinality drops from 96 → 3.
2. **Coarsen sparse custom-field values.** In `labelTrade`, any `cf_*` value appearing on <10% of labelled trades is collapsed to `other`. Prevents one-off tag values from killing a dim's usability.
3. **Adaptive `MAX_DEPTH`.** Replace the hard-coded 4 with:
   `target_cells = max(3, floor(N / minN))` and pick the smallest depth `k` such that the product of the top-`k` dim cardinalities is ≤ `2 * target_cells`. Falls back to 1 when N is tiny.
4. **Rank dims by power, not pure entropy.** New score: `sum_v (n_v if n_v ≥ minN else 0) * |mean_R(v) - global_mean_R|`. If no dim scores, fall back to the current entropy×coverage ranking so we never empty the dim list.
5. **Compute marginals (always).** New output field:
   ```ts
   marginals: Array<{
     dim: string;
     values: Array<{ value, n, win_rate, expected_R, wilson_low, verdict, confidence }>;
   }>
   ```
   Verdict on marginals uses the same `minN` / wilson / mode rules as joint cells.
6. **Bayesian shrinkage for low-N cells.** For any cell with `n < minN`, also emit `expected_R_shrunk = (n*E[R] + minN*global_mean_R) / (n + minN)` and `confidence: "high" | "moderate" | "low"` (`high` = n ≥ minN, `moderate` = minN/2 ≤ n < minN, `low` = below). Existing fields stay backward-compatible.
7. **Honest coverage.** Replace `coverage_pct` with two fields (keep `coverage_pct` as alias of `joint_coverage_pct` so the existing UI doesn't break):
   - `joint_coverage_pct` — current definition (share of trades inside joint cells with n ≥ minN).
   - `marginal_coverage_pct` — share of trades covered by *any* dim whose value has n ≥ minN.
8. **Smarter `suggested_next_tag`.** New output:
   ```ts
   suggestion: {
     kind: "coarsen" | "complete" | "none";
     dim: string | null;
     reason: string;
   }
   ```
   - `coarsen`: dim is populated (cov ≥ 0.6) AND cardinality ≥ 6 AND its marginal looks flat → "Collapse values into 3 buckets".
   - `complete`: dim coverage <0.6 AND its present-value marginals already separate (max |E[R]| > 0.4R) → "Tag more trades with this".
   - `none`: nothing qualifies.
   Keep `suggested_next_tag` / `suggested_next_tag_coverage` populated from this for backward compat.

### B. `src/components/strategy-lab/ScalpEdgeReport.tsx`

1. **Extend `ScalpReport` type** with `marginals`, `joint_coverage_pct`, `marginal_coverage_pct`, optional `suggestion`, and per-cell `expected_R_shrunk` / `confidence`. All new fields optional so older reports still render.
2. **Header rewrite.** `"82% of trades have at least one meaningful tag · 14% land in fully-confident joint cells"`. Tooltip explains both numbers.
3. **New "By single tag" section** rendered above the joint table, one row per dim's value with: verdict chip · `dim=value` · n · win% · E[R] · wilson↓. Only shown when `marginals` is non-empty. This becomes the primary view.
4. **Joint table collapses** behind a "Show joint cells" disclosure when `joint_coverage_pct < 20`. Inside, low-confidence cells (toggled on) show an asterisk on E[R] with the shrunk value in a tooltip and a small `confidence` pill.
5. **Suggestion line** uses the new `suggestion.kind` / `suggestion.reason` when present; falls back to the existing copy.

## Out of scope

- Changing the journaling pipeline, `trades` / `trade_features` schema, or how `cf_*` fields are entered.
- Chat-side rendering (separate concern).
- New tables, RLS, or backfills.

## Verification

- Re-run the scalp report in the current conversation: the "By single tag" section appears with at least `session`, `direction`, and a populated `cf_*` showing per-value stats and verdicts.
- Header reads two coverage numbers; the 0% wording is gone.
- When joint coverage is low, the joint table is collapsed with a hint instead of an empty wasteland.
- Suggestion line names a specific action (coarsen X, or complete Y) or explicitly says "no obvious gap".
- Existing consumers (chat tool summary) still render — backward-compat fields preserved.
