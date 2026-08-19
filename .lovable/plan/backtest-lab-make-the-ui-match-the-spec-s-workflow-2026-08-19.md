# Backtest Lab: make the UI match the spec's workflow

## Short answer

It isn't meant to look like this. The engine underneath is the 4-layer lab from your spec, but the UI shipped as one long left rail: data import, coverage, 25 rule knobs, walk-forward, and run history all stacked in a 340px column with no hierarchy. Every control is visible at all times, including ones that don't apply to the current mode. That's the confusion — it's a settings dump, not a workflow.

## What it should be

A three-step workflow across the top, with the heavy panel switching to match the step, and results always on the right.

```text
[ 1 Data ]---[ 2 Strategy ]---[ 3 Run ]        Symbol: EURUSD   2025-08 -> 2026-07
+-----------------------------+  +-------------------------------------------+
| step panel (changes)        |  | Results                                    |
|                             |  |  headline: OOS expectancy / PF / trades    |
|  1 Data:  import + coverage |  |  equity curve                              |
|  2 Strategy: rule groups    |  |  fold table (walk-forward)                 |
|  3 Run: mode, costs, sweep  |  |  trade list                                |
+-----------------------------+  +-------------------------------------------+
```

## Changes

**Persistent header bar**
Symbol, month range, and the Run button move out of the rail into a sticky header. These are needed at every step, so they should never scroll away. Run button shows the current mode ("Run walk-forward" / "Run backtest") and inline progress instead of a separate loading card.

**Step 1 — Data**
`Mt5ImportPanel` + `BarCoveragePanel` only. Coverage gets a single status line ("12/12 months, broker data, no gaps") with details collapsed. Green check on the step chip once coverage is clean, so you know when to move on.

**Step 2 — Strategy**
The 25 knobs get grouped into collapsible sections that are collapsed by default and show a one-line summary of their current setting:
- Setup (window, HTF bias, sweep, MSS, displacement)
- Entry & exit (entry level, expiry, stop, target)
- Filters (min FVG, max trades, swing strength)

Above them, a preset row (Silver Bullet / London killzone / NY AM continuation / Custom) fills the whole rule set in one click. Editing any knob flips it to Custom. This is the main fix: you start from a named strategy instead of 25 defaults.

**Step 3 — Run**
Money model (sizing, balance, risk %, spread) plus walk-forward config and the sweep axes. Grid size shown as a plain-language cost line. Save-to-history toggle lives here.

**Results column**
Unchanged logic, better ordering: when a walk-forward report exists, OOS numbers lead and the in-sample-vs-OOS selection gap is the headline, not a footnote. Run history moves to a small dropdown in the header ("Recent runs") instead of a permanent panel.

**Conditional controls**
Anything that doesn't apply is hidden, not shown disabled — sweep axes only when walk-forward is on, balance/risk only in risk sizing, target R only in fixed-R mode (this last part already works and stays).

## Technical notes

- Presentation only. No changes to `shared/quant/**`, the worker, hooks, or the engine config shape. `UiConfig` and `RunParams` stay identical.
- New: `BacktestHeader.tsx` (symbol/range/run/history), `StrategyPresets.tsx`, `RuleSection.tsx` (collapsible with summary line), and a `presets.ts` map of named `Partial<UiConfig>` values.
- `BacktestControls.tsx` splits into a strategy panel and a run panel; the existing `Num`/`Toggle` helpers move into a shared `controls.tsx`.
- `BacktestTab.tsx` gains a `step` state and renders the matching panel; all existing state, callbacks, and `buildParams` stay as they are.
- Step state and preset name persist in the URL alongside `tab=backtest`, matching how Pair Lab already persists lens/filters.
