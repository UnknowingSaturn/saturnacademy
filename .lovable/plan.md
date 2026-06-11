## Goal

Replace the binary "honest mode" gate with **per-trade, per-preset eligibility**. Each preset declares what data it needs; we replay only trades that *prove* (via recorded MFE, `tp_reached`, MAE, or `r_actual`) that the preset's rules would have triggered. No heuristic guessing. Quant-style transparency: every preset reports its own N, and the Compare view uses a matched intersection sample for fair diffs.

## Core principle

**A trade contributes proof, not approximation.**

- Logged MFE ≥ X → price reached X. ✓
- `tp_reached` contains a label parsing to ≥ X → price reached X. ✓
- `r_actual` ≥ X → price reached at least X (close happened there). ✓
- Logged MAE ≥ 1 → trade stopped out. ✓
- Anything else for a target the trade didn't *prove* it reached → excluded from that preset (not inferred).

A trade can be eligible for "Quick-flip @1R" (because `r_actual` = 1.2) while being ineligible for "All-out @2R" (no proof of 2R). That is correct — we just don't know.

## Per-preset data contracts

Each preset gets a typed `Eligibility` function:

```ts
type Proof = { reachedR: number; stoppedOut: boolean; loggedMfe: number | null; loggedMae: number | null };

interface PresetContract {
  /** Returns null if the trade can't be replayed honestly under this preset. */
  evaluate(proof: Proof, trade: Trade): { r: number } | null;
  /** Plain-english data needs, surfaced in the UI. */
  requires: string;
}
```

Examples:

| Preset | Eligible iff | Booked R |
|---|---|---|
| Actual behavior | `r_actual` exists | `r_actual` |
| Quick-flip @1R | `reachedR ≥ 1` OR (stoppedOut AND reachedR < 1) | +1 if reached, −1 if stopped |
| Scale-out 50/50 @1R,@2R | proof for BOTH 1R and 2R (or proof of stop-out before 1R) | 0.5·1 + 0.5·2 = 1.5; or −1; or partial @1R + BE if proof for 1R but not 2R AND not stopped out |
| All-out @2R | `reachedR ≥ 2` OR stoppedOut | +2 or −1 |
| Runner / trail-to-MFE | logged MFE only (no proxy) | 0.8 · loggedMfe (or −1 if loggedMae≥1) |
| Widen SL to MAE p75 | logged MAE only | computed using actual MAE vs widened SL |

Trades that can't prove the preset's full path but also can't prove a stop-out are **excluded** from that preset's N. We never assume "must have hit BE" or "must have stopped" without evidence.

## Reporting modes

### Ranker — native N per preset
- Each preset row shows its own `N_eligible / N_total` (e.g. "All-out @2R · N 18/30").
- Sort key becomes **expectancy R** rather than total $, because total-$ favors presets with larger N.
- Add a tiny eligibility badge: green if ≥70% of bucket eligible, amber 30–69%, red <30% or <10.
- Replace the "Honest mode" toggle with a single line: "Quant mode: proof-only replay, no guessing."

### Compare — matched-sample (intersection)
- Compute the set of trades eligible for BOTH selected strategies.
- Both replays use the same matched subset → totals, win-rate, expectancy are directly comparable.
- Header shows `Matched N: 14 of 30 (47%)` with a tooltip listing which trades dropped out and why (per-strategy ineligibility breakdown).
- If matched N < 5, show "Not enough trades pass both data contracts to compare. Pick presets with looser data needs, or log more MFE/MAE."

### Confidence intervals
- Add bootstrap 95% CI to expectancy R and total $ on every preset (reuse existing `bootstrapMeanCi`). Render as `+0.42R ± 0.31`. Quants instantly know whether the gap is real.

## Technical changes

### `src/lib/pairLabSimulator.ts` (rewrite the core)
- Add `extractProof(trade, keys)` → `{ reachedR, stoppedOut, loggedMfe, loggedMae }`. `reachedR = max(loggedMfe ?? 0, maxTpReached, max(r_actual, 0))`.
- Replace `replayOneTrade` with per-preset `evaluate` functions. Return `null` for ineligible.
- Remove all `bucket.mfeMedianWinners` / fallback logic. Delete `BucketConstants` MFE medians (keep `maeP75` for the widen-SL preset since that one *needs* MAE anyway and is gated on it).
- Replace `Fidelity` enum / `FidelityBreakdown` with a simpler `Eligibility` shape: `{ eligible: number; ineligible: number; reasons: Record<string, number> }`.
- `ReplayResult` gains: `eligibleCount`, `ineligibleCount`, `ineligibleReasons`, `expectancyCi: [lo, hi] | null`, `totalDollarsCi: [lo, hi] | null`.
- Add `replayBucketMatched(trades, keys, strategies[], opts)` → returns one `ReplayResult` per strategy, all using the matched subset, plus the matched subset itself.

### `src/lib/pairLabPresets.ts`
- Each preset declares its `requires` string (for UI) and references its evaluate function. The `ExitRule` shape stays for display, but execution goes through the new contracts.

### `src/components/pair-lab/StrategyRanker.tsx`
- Drop the high-fidelity toggle and insufficient-data banner.
- New columns: `N elig`, `Expectancy ± CI`.
- Sort by expectancy R, tiebreak by total $, busted strategies still demoted.
- Per-row eligibility chip + tooltip listing top exclusion reasons.

### `src/components/pair-lab/StrategyCompare.tsx`
- Use `replayBucketMatched` for the two selected strategies.
- Header card: "Matched sample: 14 / 30 trades · 47% — direct comparison".
- Per-strategy "if we used your full eligible set" footnote with native N for context, but the headline numbers are matched.
- Equity overlay uses the matched curves so they share an x-axis.

### `src/components/pair-lab/BucketGrid.tsx`
- Keep the MFE coverage badge (still useful as a glance metric).
- Add a second tiny row: `MAE Y/N` so users see MAE coverage too (needed for widen-SL preset and runner stop detection).

## What this does NOT change

- `BucketReport` shape stays (only `loggedMfeCount` already added; no breaking change).
- "Actual behavior" math is unchanged.
- The grid heatmap continues to use real `r_actual` for cell stats.
- No DB / schema changes.

## Why this is better

1. **Salvages partial information.** Your EURUSD-Tokyo bucket has 1 logged MFE but likely 8–12 trades with `tp_reached` or `r_actual ≥ 2` — those become *proven* eligible for "All-out @2R", not silenced.
2. **No more lying.** A preset's expectancy reflects only trades where the rules would have demonstrably fired. No bucket-median guesses inflating or deflating.
3. **Quant-grade comparison.** Matched-sample diffs in Compare + bootstrap CIs make "is preset A actually better than B?" a real statistical question, not vibes.
4. **Self-improving data UX.** When users see "All-out @2R: N 4/30 — log MFE on more trades to unlock", they get a concrete reason to log.
