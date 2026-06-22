## Audit result

**Wiring & build:** clean. Tabs reduced to Grid / Simulator / Strategy lab / Symbol aliases. `RiskOptimizationLab`, `RotationSimulator`, `MaeMfeMatrix` deleted and no dangling imports. `NumericInput` commits on blur/Enter with proper clamping. `StrategyLab` runs 24 cells (4 rotations × 6 risk tiers) × 1,200 paths each.

**Engine math review (`propFirmMonteCarlo.ts`):**

| Item | Verdict |
|---|---|
| Target equity `accountSize × (1 + targetPct)` with fractional input | ✔ correct |
| Stationary block bootstrap (Politis–Romano, geometric block length, mean = √N) | ✔ correct |
| Day-loss cap check `-dayPnL[i] >= dailyCap` | ✔ correct |
| Max-loss cap `accountSize - equity[i] >= maxLossCap` (peak-from-start) | ⚠ uses start equity, not running peak — different from "trailing drawdown" firms (FTMO, MyFF) |
| Peak-to-trough drawdown tracking (`peakDD`) | ✔ correct (separate from bust check) |
| Early exit on pass | ✔ correct |
| `riskOfRuin` is per-account bust rate, not per-path | ⚠ doc comment on line 56 wrongly says "Probability any single account hits maxLoss"; metric is `bustedAccounts / totalAccounts` |
| Rotation cursor update only when target.length>0 | ✔ |
| Block bootstrap re-seed every call: `seed: 1337` shared by all cells | ⚠ all cells see correlated noise — fine for ranking, but understates between-cell variance |

**Strategy Lab review:**

| Item | Verdict |
|---|---|
| Auto trades/day from `entry_time` dates | ✔ correct (rounds, clamps 1-8) |
| Prop-firm `$` limits divided by user-edited `accountSize` to get % | ⚠ unrealistic if user changes account size — firm limits don't scale |
| Heatmap colour gradient on passProb range | ✔ but ignores statistical noise (~±1.4 pp at p=0.5, n=1200) |
| Score `passProb × (1−RoR) − 0.5·max(0, DD−5)/100` | ✔ reasonable, but no penalty for inconclusive paths |
| No Monte-Carlo confidence interval shown | ⚠ user can't tell signal from noise |

## Proposed fixes (one batch)

### 1. Correct `riskOfRuin` semantics
Change the metric to **per-path** "probability any account busts" (more intuitive and matches the doc). Keep the per-account survival rate as a separate field. Update the score to use the new RoR.

### 2. Add Monte-Carlo Wilson 95% CI for pass prob
Expose `passProbCI: [lo, hi]` on `MCResult`. In the detail card show `68% [65–71]`. In the heatmap, add a tiny `±2pp` line beneath DD when the CI half-width is >3pp — flags noisy cells.

### 3. De-correlate cell seeds
Seed each cell as `hash(model, risk)` instead of one shared seed, so two cells with similar means aren't artificially close due to identical sample paths.

### 4. Optional trailing-drawdown mode
Add `maxLossMode: "static" | "trailing"` to `MCParams`. Trailing tracks peak equity since start and busts when `peakEquity - equity >= maxLossCap`. Default `static` (preserves current behaviour). Expose a toggle in Strategy Lab inputs labelled "Trailing DD (FTMO-style)".

### 5. Auto-scale firm limits when account size changes (Strategy Lab only)
When `hasPropFirmProfile` is true and the user edits `accountSize` away from the profile's account size, scale `dailyLossDollars` and `maxDrawdownDollars` proportionally. Show a small note "Firm % rules applied to override balance".

### 6. Fix the misleading comment
Update line 56–57 doc string to reflect the new per-path RoR semantics.

### 7. Score includes inconclusive penalty
Change score to `passProb × (1−RoR) − 0.5·max(0, DD−5)/100 − 0.1·inconclusiveProb`. Stops the optimiser from preferring "never bust, never pass" cells when window is short.

### 8. Surface the score components in the detail card
Add a small "Score breakdown" line: `pass 0.70 × survival 0.85 − DD 0.012 − incon 0.030 = 0.553`. Makes the recommendation auditable.

## Out of scope
- Replacing the engine itself (block bootstrap stays).
- Edge-function mirror — already covered in previous turn.
- Per-account independent targets (e.g. "all accounts must pass") — flag for a future turn.

## Files touched
- `src/lib/propFirmMonteCarlo.ts` — items 1, 2, 3, 4, 6.
- `src/components/pair-lab/StrategyLab.tsx` — items 2, 5, 7, 8 + trailing-DD toggle.

Confirm and I'll implement.