
## Problem
Grid cells and simulator outputs render the same way no matter how thin the underlying data is. A cell with N=3 currently shows `+0.42R`, `33%`, `→ TP 1.25R` — visually indistinguishable from a cell with N=120. The user reads it as a result.

What's already in place: confidence dots (🟢🟡🔴), FDR badge, low-sample tooltip, MFE/MAE coverage colors, `MIN_ELIGIBLE_SAMPLE=10` in the ranker. These are *labels next to numbers* — the numbers are still the loudest thing on screen.

## Principle
**If the data can't support a conclusion, don't render a conclusion.** Replace the number with a state, not a decoration around the number.

## Proposed approach — three tiers, applied everywhere

Define three data states centrally (in `shared/quant/config.ts`) and have every surface honor them:

| State | Trigger | What the UI shows |
|---|---|---|
| `insufficient` | n < 10 OR coverage < 30% | dashes (`—`) + "need ≥10" hint. **No** expectancy, win%, TP suggestion, simulator row, equity curve. |
| `provisional` | 10 ≤ n < 30 OR FDR `ns` OR CI crosses 0 | numbers shown but **muted** (opacity, no color, no bold), prefixed `~`, plus a "provisional" pill. No TP recommendation, no "winner" crown, excluded from ranker top slot. |
| `validated` | n ≥ 30 AND FDR `sig` AND CI > 0 | full color treatment as today. |

### Where this applies
1. **BucketGrid cells** — `insufficient` cells render only `N=x — too few` (no expR, no win%, no TP). `provisional` cells render muted numbers, no TP arrow.
2. **Row totals** — same gating.
3. **StrategyRanker** — `insufficient` rows already dashed; extend: `provisional` rows can't be the winner and lose the green highlight + crown.
4. **StrategyLab simulator** — if the eligible R-sample feeding the Monte Carlo is `insufficient`, replace the whole grid with an empty-state card ("Need ≥10 eligible trades to simulate — currently X"). If `provisional`, keep the grid but add a banner: "Based on N=X trades — treat as directional, not predictive" and hide pass-rate %s, show only bust/no-bust.
5. **Equity curve overlay** — same gate; don't draw a curve from <10 samples.

### Thresholds — single source of truth
Add to `shared/quant/config.ts`:
```ts
export const DATA_TIER = {
  insufficient: { maxN: 9, minCoverage: 0.3 },
  provisional:  { maxN: 29 },  // validated = n>=30 + FDR sig + CI>0
};
```
Add a helper `classifyBucket(b): "insufficient" | "provisional" | "validated"` next to it. Every surface calls that one function — no scattered `n < 10` checks.

## Out of scope
- No changes to the math itself (Sprint C already proved it correct).
- No new aggregation modes, no new bucketing — purely a presentation gate.

## Files touched
- `shared/quant/config.ts` — add tiers + `classifyBucket`
- `src/components/pair-lab/BucketGrid.tsx` — gate cell rendering
- `src/components/pair-lab/StrategyRanker.tsx` — extend existing insufficient handling to provisional
- `src/components/pair-lab/StrategyLab.tsx` — gate simulator + add banner
- `src/components/pair-lab/EquityCurveOverlay.tsx` — early-return on insufficient

## One decision needed
The `validated` threshold of **n ≥ 30 + FDR sig + CI > 0** is the conservative quant-stats default. If you'd rather:
- **(a)** keep it strict at 30 (default proposal), or
- **(b)** loosen to n ≥ 20 so more buckets graduate (you have 25 buckets / 408 trades),

say (a) or (b) and I'll wire it up. Everything else proceeds as written.
