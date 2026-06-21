# Remove `tp_reached` — MFE becomes the single proof source

## Rationale
MFE (numeric R) strictly dominates `tp_reached` (multi-select tags) for everything the simulator does. Removing it simplifies field resolution, kills a stale code path in `maxReachedR`, and shortens the trade form.

## Scope

### 1. Simulator math
**`src/lib/pairLabSimulator.ts`**
- Drop `tp_reached` from the proof-source comment block.
- Remove the `multiSelectCf(trade, keys.tpReached)` lookup and its contribution to `maxReachedR` — it becomes `max(loggedMfe, max(0, rActual))`.
- Remove `tpReached` from any local destructure.

**`src/lib/pairLabMath.ts`**
- Remove the `tpReached` entry from the `FIELD_ALIASES` table (line ~123).
- Remove `tpReached: null` from the default `FieldKeys` object (line ~131).
- Remove the `multiSelectCf(t, keys.tpReached)` aggregation block (~line 458) and any derived stat it feeds (likely a "TP hit distribution" counter — confirm whether it surfaces in `BucketStats`; if it does, drop the field from the type and from `BucketGrid` / `RecommendationCard` consumers).
- Remove the comment in the header about `cf_tp_reached`.

**`src/lib/pairLabPresets.ts`**
- No change to `trail_to_mfe` runner key — that's MFE-based, not tp_reached.

### 2. Edge function mirror
**`supabase/functions/_shared/quant/pairLabSimulator.ts`** and **`.../pairLabMath.ts`**
- Apply the identical removals so server-side `pair-lab-report` stays in sync.

### 3. Type + UI
**`src/lib/pairLabMath.ts`** (`FieldKeys` type) — remove `tpReached: string | null`.

**`src/hooks/usePairLab.tsx`** (line 109) — drop `!fieldKeys.tpReached` from the "no proof fields configured" guard so the warning fires correctly with just MFE/MAE.

Search for any other consumers:
- `RecommendationCard`, `QuantNotePanel`, `BucketGrid`, `StrategyCompare`, `StrategyRanker` — strip any "TPs hit" column / chip / copy.
- `src/types/reports.ts` and `ReportView.tsx` — remove TP-reached references if present.

### 4. Custom field definitions (data, not schema)
The `tp_reached` / `tps_hit` rows live in `custom_field_definitions` per user. We will **not** auto-delete them — users may still want the field for manual notes. The simulator simply stops reading it. Document this in the changelog comment at top of `pairLabSimulator.ts`.

If you'd rather hard-delete them, that's a separate `insert`-tool DELETE pass — say the word.

### 5. Out of scope
- No DB schema migration (the field is user-defined, not a column).
- No change to MFE logging UX.
- No change to `trail_to_mfe` runner behaviour.

## Files touched
- `src/lib/pairLabSimulator.ts`
- `src/lib/pairLabMath.ts`
- `src/hooks/usePairLab.tsx`
- `src/components/pair-lab/{RecommendationCard,QuantNotePanel,BucketGrid,StrategyCompare,StrategyRanker}.tsx` (only where tp_reached is surfaced)
- `supabase/functions/_shared/quant/pairLabSimulator.ts`
- `supabase/functions/_shared/quant/pairLabMath.ts`

## Validation
- Open Pair Lab on an account with MFE-logged trades → buckets, TP1\*, recommendation render unchanged.
- Open Pair Lab on a bucket where some trades only had `tp_reached` proof → those trades' `maxReachedR` now falls back to `max(0, r_actual)`; verify no NaN/undefined in BucketGrid.
- `pair-lab-report` edge function returns without errors.
