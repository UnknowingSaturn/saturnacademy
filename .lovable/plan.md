## Goal
Stop calling index distances "pips" (NAS100, US30, DAX, etc. trade in **points**), and give the trader an opt-in way to see raw **ticks** alongside, so values can be pasted straight into an MT5 EA input without a second conversion.

## Why this is the right shape
- Storage stays in broker **ticks** — already correct, broker-agnostic, lossless.
- Display stays in **pips for FX/metals/crypto/oil, points for indices** — matches TradingView's measure tool and how every trader talks about NAS100 ("420 points", not "420 pips").
- A small "Show ticks" toggle (persisted in localStorage, scoped to Pair Lab) surfaces the raw broker unit when the user is wiring an EA / MQL5 input. No math change, pure presentation.

## Scope — display only, no math changes

### A. Label bug fix (pure correctness)
The math layer already exposes `slUnit: "pips" | "points"` on every `BucketReport`. Consume it everywhere instead of hardcoding `"pips"`.

Files touched:
- `src/components/pair-lab/QuantNotePanel.tsx` — line 213 ("planned → ideal (pips)") and line 300 (`"… pips"` next to `suggestedSlPips`). Both become `b.slUnit` / `r.slUnit`.
- `src/components/pair-lab/StrategyRanker.tsx` — any `pips` literal next to SL/MAE.
- `src/components/pair-lab/BucketGrid.tsx` — same audit.
- Tooltip / drill-down strings under `pair-lab/tabs/` that reference "pips" while displaying a per-symbol distance.

Acceptance: every distance number in Pair Lab is rendered alongside the unit returned by `pipLabelForSymbol(symbol)`. NAS100 reads "420 **points**".

### B. Optional ticks display (opt-in)
- New tiny `useDistanceUnit()` hook (localStorage key `pairLab.distanceUnit`, values `"native" | "ticks"`, default `"native"`).
- One toggle in OverviewTab's header chip row: **Distance: Pips/Points · Ticks**.
- A pure formatter `formatDistance(symbol, valuePips, mode)` that either returns the existing string ("420 points") or converts back to ticks via `pipSizeForSymbol(symbol) / tickSizeForSymbol(symbol)` and renders "420 t" (NAS100 is 1×, FX 5-digit is 10×).
- Applied at the same render sites touched in A; no new state, no recomputation, no impact on the SL/TP math or recommendations.

### C. Documentation chip
Add a one-line tooltip on the unit label (e.g. "pips" / "points" / "ticks") that explains:
> Stored as broker ticks · Displayed as {unit}. NAS100 1 tick = 1 point. EURUSD 1 pip = 10 ticks.

This kills the recurring "why pips, why ticks" confusion at the source.

## Out of scope
- Anything that changes how MAE / Ideal-SL are *stored*, ingested, or used in math.
- EA / copier code — the desktop copier already consumes ticks directly and isn't affected.
- Renaming `suggested_sl_pips` in the edge response (field name stays for API stability; UI label is what changes).

## Technical notes
- `pipLabelForSymbol` already returns `"points"` for the `index` class; no new classifier work needed.
- Tick override map (`symbol_groups.tick_size_overrides`) is consulted by `tickSizeForSymbol`, so per-broker quirks (e.g. crypto on a non-standard 0.1 tick) flow through to both pip *and* tick display automatically.
- "All" / multi-symbol buckets keep `slUnit: "pips"` (current behavior) since the unit is symbol-specific; the toggle still works because the conversion factor degrades to 1 when `tick == pip`.
