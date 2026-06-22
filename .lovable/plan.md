## Goal

Replace the separate **Risk lab**, **Rotation lab**, and **MAE/MFE** tabs with a single **Strategy Lab** that sweeps risk × rotation together against your real R-history and the active prop-firm rules — and fix the input-field UX while we're at it.

## Why merge

Risk % and rotation model interact (e.g. round-robin at 1.5% may pass more often than stay-on-winner at 1.0%, but with worse drawdown). Testing them separately hides the optimum. A joint sweep is the only quant-correct answer.

## Changes

### 1. New tab: "Strategy Lab" (replaces Risk lab + Rotation lab)
- 2D sweep: `riskTiers × rotationModels` → grid of MC results (one cell per combo).
- Default tiers: `0.5, 0.75, 1.0, 1.25, 1.5, 2.0 %` × all 4 rotation models = 24 cells, 2000 paths each (~unchanged compute).
- Layout: heatmap-style table — rows = rotation model, columns = risk %, cell shows **pass prob** with **drawdown** subscript; best cell highlighted "Recommended".
- Below the heatmap: detail row for the selected cell showing full metrics (pass, fail, avg DD, risk-of-ruin, expected return, days-to-pass, survival).
- Click a cell → it becomes the detail row.
- Recommendation score: `passProb × (1 − riskOfRuin) − 0.5 × max(0, avgDD − 5%)` (penalises high-DD wins).

### 2. Remove MAE/MFE tab
- Remove `<TabsTrigger value="excursions">` and the `<MaeMfeMatrix>` panel from `PairLab.tsx`.
- Keep the `MaeMfeMatrix.tsx` file in repo (still imported by `QuantNotePanel`? — verify; delete if fully orphaned).

### 3. Fix number-input UX
Current inputs do `Number(e.target.value) || fallback` on every keystroke, so clearing the field or typing "0." snaps the value back. Replace with a small `NumericInput` wrapper that:
- Stores the raw string in local state, only commits on `blur` or `Enter`.
- Allows empty string mid-edit (no clamp-while-typing).
- Clamps to `[min, max]` only on commit.
- Used everywhere in the new Strategy Lab + remaining sliders.

### 4. Better parameters (drop the weak ones)
| Old | New | Reason |
|---|---|---|
| Max days (5–120) | **Evaluation window (calendar days)** preset: 30 / 60 / 90 + custom | "Max days" was a hard cutoff that distorted pass prob; window framing matches firm phase length |
| Trades/day fixed int | **Avg trades/day** (from actual history) auto-detected, override with slider 1–8 | Stops users guessing; defaults to truth |
| Target % free input | **Phase target** preset chips: 6 / 8 / 10 / 12 % + custom | Matches real firm phases |
| Daily loss / Max loss free input | **Pull from active prop-firm profile** when one is selected; only show fields in "Any profile" mode | Already in profile — no need to retype |
| Account size on rotation tab | Inherit from simulator profile, override inline | Same |

### 5. Files touched
- `src/pages/PairLab.tsx` — remove 2 tabs, add Strategy Lab tab, wire props.
- `src/components/pair-lab/StrategyLab.tsx` — **new**, replaces RiskOptimizationLab + RotationSimulator.
- `src/components/pair-lab/NumericInput.tsx` — **new**, shared commit-on-blur input.
- Delete `RiskOptimizationLab.tsx`, `RotationSimulator.tsx` once StrategyLab is verified.
- Delete `MaeMfeMatrix.tsx` if no other importer remains.

### 6. Out of scope
- Changing the Monte-Carlo engine itself (still block-bootstrap from last turn).
- Adding new rotation models.
- Changes to Grid / Simulator / Symbol aliases tabs.

## ASCII mock of the new heatmap

```text
                  0.50%   0.75%   1.00%   1.25%   1.50%   2.00%
One only           38%     46%     53%     58%    61%★    55%
Simultaneous       35%     41%     44%     42%     38%     28%
Stay-on-winner     52%     61%     68%     71%    74%★    69%   ← Recommended
Round-robin        50%     58%     65%     67%     69%     63%

★ = pass prob ≥70%, DD ≤7%
```

Confirm and I'll build it.