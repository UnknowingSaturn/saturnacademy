
## Switch SL optimization to use `cf_ideal_stop_loss` by default

### Why
- 45 trades have ideal SL logged, 37 have MAE — coverage is the same.
- Your trading rule places SL at structure. Ideal SL *is* that structure; MAE is just a survival heuristic for when structure isn't logged.
- The current `max(MAE p75 × 1.15, idealSlMedian)` rule inflates SL distance whenever a trade took unusual heat and survived — which is exactly the wrong time to widen the stop forever.

### Change

**`src/lib/pairLabMath.ts → suggestSlTp`** (currently lines ~755–770):

Replace:
```ts
suggestedSlPips = Math.max(maeCandidate ?? 0, s.idealSlMedian ?? 0);
slMethod = "winners_mae";
```

With a priority cascade:
1. If `idealSlMedian` is present → use it. `slMethod = "ideal_sl"`.
2. Else if `maeP75Pips` is present → use `maeP75Pips × 1.15`. `slMethod = "winners_mae_fallback"`.
3. Else → legacy.

So ideal SL wins whenever it exists. MAE drops to fallback-only.

### Surfacing it

**`src/components/pair-lab/StrategyLab.tsx`** — the SL/TP suggestion card already shows `slMethod`. Add one line under the SL value:

- When `ideal_sl`: "Source: your logged ideal SL (median of N trades)."
- When `winners_mae_fallback`: "Source: MAE p75 × 1.15 — no ideal SL logged for this bucket."

So you always know which one is driving the recommendation, per symbol/bucket.

### Optional escape hatch (only if you want it)

A single Pair Lab setting `SL source = [Ideal SL (default) | MAE survival | Max of both (legacy)]` persisted on the simulator profile. Skip unless you want to A/B them — the cascade above already does the right thing for your data.

### Intra-hour and alternate-setup toggle

Dropping both from this plan since they aren't what you asked about. We can revisit either separately.

### Files
- `src/lib/pairLabMath.ts` — replace the SL selection block, update the `slMethod` union type.
- `supabase/functions/_shared/quant/pairLabMath.ts` — mirror the change so edge-function reports match.
- `src/components/pair-lab/StrategyLab.tsx` — add the one-line source caption.

### Out of scope
- No schema changes.
- No changes to MFE/TP logic.
- No removal of MAE — it remains the fallback and stays available in stats.
