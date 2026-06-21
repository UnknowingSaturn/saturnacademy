# Pair Lab — simplify confusing surfaces

After auditing `/pair-lab`, the math is sound but the **UI exposes too many quant knobs at once**. A non-quant trader lands on the page and sees: 4 confidence/CI styles, 2 expectancies (mean + median), 3 modes (Strict / Walk-forward / Prop-firm), and the Compare tab duplicates the Ranker. This is the cleanup.

## What's overengineered or redundant

| # | Surface | Why it confuses | Action |
|---|---|---|---|
| 1 | **`StrategyCompare` (side-by-side picker + equity overlay)** | Auto-ranker already shows all 12 presets ranked, with CI + Sharpe. Compare adds a second mental model ("matched intersection") that contradicts the ranker's per-preset N. Users have to learn the difference. | **Remove the Compare card.** Keep `EquityCurveOverlay` but render it inline under the auto-ranker for the top-1 vs "current" only. |
| 2 | **"Strict" toggle in `StrategyRanker`** | Switches the leaderboard between native-N and intersection-N — same data, different denominators. 99% of users won't grasp the difference; the dot+tooltip already flags coverage. | Remove the Strict toggle. Always show native-N (current default). |
| 3 | **"Planned profile" + "Actual profile" selectors in the header** | Two near-identical dropdowns side by side, both default to "Any". Most users don't tag both fields. | Collapse to **one "Profile" filter** that searches either field. Keep both fields in the data model. |
| 4 | **Hypothetical SL sweep table (5 rows of MAE quantiles in `RecommendationCard`)** | A grid optimization inside a recommendation card. The single "Suggested SL" tile already encodes the answer. | Hide behind a `<details>` "Show SL sensitivity" disclosure. |
| 5 | **"TP1*" line under TP ladder** | Adds a third TP concept (win-rate-maxing) next to the ladder and the suggested SL. Most users want one TP plan. | Keep TP1* number but move it into the same tile as the ladder with a small "win-max" tag — no separate sub-paragraph. |
| 6 | **`SimulatorProfileSettings` button buried in the simulator scope bar** | Users click "Sim $" input and don't realize the source-of-truth is a profile. Two ways to set the same number. | Make the Sim $ input read-only with a "Edit in profile" link — single source of truth. |
| 7 | **`QuantNotePanel` (AI quant note)** rendered next to `RecommendationCard` by default | Doubles the visual load on cell-select. Empty state ("Generate an AI note…") competes with the actual recommendation. | Render only the Generate button by default; expand into the full layout after the note exists. |
| 8 | **"Partial-fill" warning banner** | Long copy block about unimplemented consolidation — informational only, no action. | Shorten to a one-line muted note; move details into a tooltip. |
| 9 | **Median R + Mean R both shown in `RecommendationCard`** | Two expectancies invite the question "which is right?" | Keep Mean R + CI. Drop "Median R" row. |
| 10 | **"Reached R" diagnostic column in the ranker** | Marketed as "self-selection bias diagnostic" — that's PhD-level. | Hide column by default behind a "diagnostics" toggle on the ranker, or drop entirely. |

## Out of scope (keeping these — they are load-bearing)

- Walk-forward toggle (genuine overfitting check; one switch, one badge)
- Prop-firm mode (changes binding constraint; clearly labeled)
- Coverage dot + ineligibility tooltip (this is *exactly* the level of transparency the engine needs)
- BH/FDR badges in `BucketGrid` (one badge per bucket, low cost)
- 12 strategy presets (just added; sorting handles "too many")

## Technical changes

**Files to edit (frontend only):**
- `src/pages/PairLab.tsx` — collapse profile selectors to one; remove `<StrategyCompare>` mount; render `EquityCurveOverlay` inline under ranker.
- `src/components/pair-lab/StrategyRanker.tsx` — remove Strict toggle & branch; hide "Reached R" column behind a `showDiagnostics` local state (default off).
- `src/components/pair-lab/RecommendationCard.tsx` — wrap SL sweep table in `<details>`; merge TP1* into the TP tile; drop Median R `StatLine`.
- `src/components/pair-lab/QuantNotePanel.tsx` — render only header + Generate button when `note == null`.
- `src/pages/PairLab.tsx` — shorten partial-fill banner copy, move details to a Tooltip.
- `src/components/pair-lab/SimulatorProfileSettings.tsx` (or the scope-bar block in `PairLab.tsx`) — make Sim $ display read-only with an "Edit" link.
- **Delete:** `src/components/pair-lab/StrategyCompare.tsx` and its import in `PairLab.tsx`. `StrategyPresetPicker.tsx` is still used by other paths? Verify with `rg` before deletion; if unused, delete too.

**No engine, math, or DB changes.** All replay/CI/BH/walk-forward logic stays intact — only the UI surface is reduced.

## Verification

- Playwright on `/pair-lab`: load page, select a cell, confirm RecommendationCard renders without SL sweep open and without Median R; expand `<details>` and confirm sweep table appears.
- Confirm `StrategyRanker` still renders 12 rows and the winner card; no Strict toggle visible.
- Confirm Compare card is gone and an equity overlay (winner vs current) appears under the ranker.
- Console errors: none.
