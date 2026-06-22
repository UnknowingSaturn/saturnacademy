
Four focused upgrades, sequenced so each one is independently testable.

## 1. Display SL/TP suggestions in the UI

The new MAE-of-winners SL and MFE-grid TP are computed but only fed to the AI quant note. Surface them where users actually look.

**`src/components/pair-lab/QuantNotePanel.tsx`** — add a new section between the stats strip and the AI button:

```
Suggested parameters · [validated | low-confidence | insufficient data]
  SL: 187 pips   TP: 1.75R   E[R]: +0.42   95% CI: [+0.08, +0.71]
                                                    Ladder: 1.0R / 1.75R / 2.5R
```

- Three-state badge driven by `recommendation.recommendationConfidence`.
- Hide the row entirely when bucket has < 10 trades.
- Show "insufficient MFE/winner data — using legacy heuristic" tooltip on `insufficient`.

**`src/components/pair-lab/BucketGrid.tsx`** — add a compact `→ TP 1.75R` line below the existing `MAE 87t` cell content, color-coded by confidence (green/amber/grey). One-line addition per cell.

## 2. Walk-forward validation

The only honest defense against curve-fitting recommendations.

**`src/lib/pairLabMath.ts`** — add `runWalkForward(rows, keys, propFirm)`:

1. Sort trades by `entry_time`.
2. Split 70/30: in-sample (IS) = first 70%, out-of-sample (OOS) = last 30%.
3. Run `buildRecommendation` on IS → get `suggestedSlPips`, `suggestedTpR`.
4. Score those same parameters against the OOS trade set using the existing `scoreTp` helper (extracted to module scope).
5. Return `{ inSampleExpectancy, outOfSampleExpectancy, degradation: 1 − OOS/IS, oosN }`.

Add to `BucketRecommendation`:
```ts
walkForward: {
  inSampleE: number;
  outOfSampleE: number;
  degradationPct: number;
  oosN: number;
} | null;
```
`null` when total N < 30 (need ≥9 OOS trades to mean anything).

**UI**: a small "OOS: +0.31R (−26%)" line under the suggestion in `QuantNotePanel`. Red badge when degradation > 60% — that's the "curve-fit" warning.

## 3. Block bootstrap for prop-firm MC

Losses cluster on bad days. IID sampling under-counts streak risk → pass probabilities look better than reality.

**`src/lib/propFirmMonteCarlo.ts`** — replace the per-trade IID `rSample[Math.floor(rng() * len)]` with a stationary block bootstrap:

1. Pre-compute `blockSize = Math.max(3, Math.round(Math.sqrt(rSample.length)))` (default Politis–Romano rule).
2. Maintain a running `(blockStart, blockOffset)` cursor in `simulateOnePath`. When `blockOffset === blockSize`, draw a new random start with geometric expectation `blockSize` (probability `1/blockSize` per step to reset).
3. Sample R = `rSample[(blockStart + blockOffset) % rSample.length]`.

This preserves intra-block serial correlation (one bad cluster stays clustered) without locking block boundaries — the canonical method for time-series resampling. ~15 LoC change, zero API change. The three consumer labs (RiskOptimizationLab, RotationSimulator, ChallengePlannerCard) get more conservative pass probabilities automatically.

Add a small "block bootstrap (b=12)" footer text to each of the three result cards so the methodology is visible.

## 4. Sync edge-function math

`supabase/functions/_shared/quant/pairLabMath.ts` (440 lines) is missing everything added since the original sync — sweep, bootstrap CIs, MAE-of-winners SL, MFE TP grid, walk-forward. Only `generate-report` imports it.

Strategy: stop maintaining two copies. The mirror exists for Deno/edge compatibility, but the client file is plain TypeScript with one dependency (`@/lib/symbolMapping` for `ticksToPips`/`pipSizeForSymbol`).

**Approach**: rewrite `supabase/functions/_shared/quant/pairLabMath.ts` as a thin re-export wrapper that copies the client file verbatim but with:
- `import { ... } from "@/lib/symbolMapping"` → `import { ... } from "./symbolMapping.ts"` (already exists in `_shared/quant/`)
- `import type { Trade } from "@/types/trading"` → inline minimal `Trade` type at top of file (the shared file already does this — keep it)

Then add a build-time check script `scripts/check-quant-sync.mjs` that diffs the two files modulo those imports, runs in CI, and fails if they drift. Pre-commit nice-to-have but optional.

**Verify**: redeploy `generate-report`, hit it with a known fixture, confirm the response includes `recommendationConfidence` and `walkForward`.

## Sequencing

| # | Why first | Risk |
|---|-----------|------|
| 1 | Zero math risk, immediate user value (the "I can't see them" feedback) | Low |
| 3 | Independent of #2/#4, makes MC honest | Low |
| 2 | Adds new field; #1's UI picks it up automatically | Medium (math) |
| 4 | Last, since it must mirror final state of #1–3 | Low |

## Out of scope

- Multi-timeframe MFE (would need new custom field).
- Monte Carlo correlated-account model (assumes accounts trade same signals — currently true for this user).
- Replacing Kelly with fractional-Kelly or risk-parity sizing — separate decision.
