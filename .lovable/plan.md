## Problem

On the Pair Grid, cells like **EURUSD · All Sessions (N 119)**, **GBPUSD · NY AM (N 44)**, **EURUSD · NY AM (N 58)** all render:

> 🔴 N 119
> *too few — need ≥10*
> 9/119 MFE · 9/119 MAE

The numbers are correct — those cells genuinely cannot produce a recommendation — but the **reason** shown is wrong. `classifyDataTier` returns `"insufficient"` for two different causes:

1. `n < 10` (true "too few trades")
2. `max(MFE coverage, MAE coverage) < 30%` (enough trades, but not enough are tagged with MFE/MAE)

Every cell the user flagged is cause #2. The current copy only describes cause #1, so it looks like a bug.

## Fix

Differentiate the two failure modes in `BucketGrid.tsx`'s `CellInner` insufficient branch, and surface the actual gate that tripped.

### Behaviour after fix

- **N < 10** → unchanged: `too few — need ≥10`
- **N ≥ 10 but coverage < 30%** → new copy: `low coverage — need ≥30% MFE/MAE` (with the existing `9/119 MFE · 9/119 MAE` line directly below, in red, as the evidence)
- Coverage dot stays red; tier stays `insufficient` so we still hide expectancy/win% (correct — we don't want to publish a recommendation from 9 logged trades out of 119).

### Implementation

1. In `BucketGrid.tsx` `CellInner`, after `tierFor(b)` returns `"insufficient"`, compute which gate fired:
   ```ts
   const coverage = Math.max(b.loggedMfeCount, b.loggedMaeCount) / b.n;
   const reason = b.n < DATA_TIER_INSUFFICIENT_N ? "sample" : "coverage";
   ```
2. Render the matching message:
   - `sample` → `too few — need ≥{DATA_TIER_INSUFFICIENT_N}` (existing)
   - `coverage` → `low coverage — log MFE/MAE on ≥{Math.round(DATA_TIER_INSUFFICIENT_COVERAGE*100)}% of trades`
3. Pull `DATA_TIER_INSUFFICIENT_COVERAGE` from `shared/quant/config.ts` (already exported).
4. Wrap the cell body in a tooltip that explains the gate in plain English so the user can hover to see e.g. "119 trades, but only 9 have MFE logged (7.5%). Log MFE/MAE on more trades to unlock the recommendation."

### Scope

- Frontend-only, single file: `src/components/pair-lab/BucketGrid.tsx`.
- No math/classification changes — the underlying tier logic is correct.
- No changes to StrategyRanker (its "too few" copy is for a different code path; can be revisited separately if you'd like).

### Out of scope (flag for follow-up)

- The root cause that so many EURUSD/GBPUSD trades lack MFE/MAE values. That's a journaling-coverage problem, not a Pair Lab math problem. If you want, a follow-up turn can add a "Missing MFE/MAE" link on the Overview tab that opens the Journal filtered to those trades.
