# Fix empty scalp-report output + stale tag suggestion

## What's wrong

Screenshot shows the assistant rendered only the `ScalpEdgeReport` card with "No cells meet n ≥ 20" and "Next tag to start filling for sharper edges: cf_ideal_entry_window_jdl1". Two problems:

1. **No prose narrative.** Edge logs show `turn_started` and `tool_executed scalp_edge_report success=true`, but no `turn_completed`, no `follow_up_failed`, no `follow_up_empty`. The follow-up call either streamed back nothing meaningful (model saw the `message` summary already inside the tool result and emitted whitespace), or it bailed mid-stream. The current safety net only synthesizes when `second.sawContent` is false — a single whitespace token defeats it. Result: the user gets the card and nothing else.
2. **Stale tag suggestion.** `suggestNextTag` in `supabase/functions/scalp-edge-analysis/index.ts` recommends the dimension with the largest variance reduction among *all* `cf_*` keys present on trades, regardless of how widely the field is already populated. The user already has `cf_ideal_entry_window_jdl1` populated, so suggesting it "to start filling" is wrong and condescending. The function has no notion of "coverage".

## Fix

### A. `supabase/functions/strategy-lab/index.ts` — guarantee a written summary

Make the deterministic summary the floor, not a fallback:

1. After tool execution and **before** the follow-up call, emit `summarizeToolResult(...)` for every scalp tool result. This guarantees the user always sees a prose block under the card, even if the model's follow-up is empty, partial, or aborted.
2. Tell the follow-up turn (system addendum) that a deterministic summary has already been shown, so it should add *commentary and next actions* on top — not repeat the cell stats.
3. Drop the now-redundant "safety net" synthesis at line 1088 to avoid double-printing.
4. Keep the existing `follow_up_failed` path printing the summary (still useful if the follow-up errors *before* anything streams).

### B. `supabase/functions/scalp-edge-analysis/index.ts` — coverage-aware suggestion

In `runAnalysis` (around line 244):

1. Compute `coverageByDim: Record<string, number>` = fraction of `labelled` rows where `ctx[dim]` is defined, for every dim seen.
2. In `suggestNextTag`, accept `coverageByDim` and **exclude** candidates with `coverage >= 0.6` from the "start filling" pool — a 60%+ populated field is not a "next tag to start", it's already in use. If all candidates are above the threshold, return `null` and let the response say "no obvious gap".
3. Return `suggested_next_tag_coverage: number | null` (coverage of the chosen tag, in [0,1]) alongside `suggested_next_tag` so the UI can give honest context.

### C. `src/components/strategy-lab/ScalpEdgeReport.tsx` — honest wording

1. Extend the `ScalpReport` type with `suggested_next_tag_coverage: number | null`.
2. Rewrite the suggestion line (≈ line 76-82):
   - If `coverage == null` or `coverage < 0.1`: "Most informative tag to **start collecting**: `…`".
   - If `0.1 <= coverage < 0.6`: "Most informative tag to **populate more consistently** (currently `${pct}%` of trades): `…`".
   - If `coverage >= 0.6` (shouldn't happen after the filter, defensive only): suppress the suggestion entirely.
3. Use the same `replace(/^cf_/, "")` display formatting.

### D. `src/components/strategy-lab/StrategyChat.tsx` — quick-action copy

Update the two scalp-edge quick actions (lines 40 and 54) so the wording matches: "the suggested next tag to focus on" instead of "to start collecting" / "to start filling next".

## Out of scope

- Changing the verdict threshold (n ≥ 20 conservative) or the cell ranking math.
- The recently-shipped prose styling, sidebar, streaming, or tool-result parser.
- Adding new tools or new model prompts beyond the one-sentence addendum in §A.

## Verification

1. Re-run "Run a scalp edge report on my last 6 months of trades." A `ScalpEdgeReport` card appears followed by a Scalp Edge Summary prose block (top GO / worst SKIP / commentary) without needing the model's follow-up.
2. Confirm the suggested tag line no longer recommends `cf_ideal_entry_window_jdl1` for this user (whose coverage is high). If everything is well-tagged, the line is omitted.
3. Confirm `_No statistically significant contexts yet — keep journaling._` still renders when zero cells meet `n ≥ 20`.
4. Check `[strategy-lab] turn_completed` shows up in edge logs after the run.
