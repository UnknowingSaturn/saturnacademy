## Verdict on the tab as it stands

The Timing tab is useful but it can't separate edge from drift. It buckets every trade by `entry_time` minute and never reads `cf_ideal_entry_window`. A "first 30min" trade you took at :42 (out of plan) lands in the same cell as a "last 30min" trade taken at :42 (in plan). The cell mean is meaningless.

You don't need to journal differently — your "first 30min / last 30min" labels are enough. The tab needs to consume them.

## What changes

### 1. Parse `cf_ideal_entry_window` into a minute range

Small parser, normalizes case/whitespace/punctuation, supports:

- `first 15min` → 0–14
- `first 30min` → 0–29
- `first 45min` → 0–44
- `last 15min`  → 45–59
- `last 30min`  → 30–59
- `last 45min`  → 15–59
- explicit ranges `:15-:30` or `15-30` if ever typed

Variants like `first 30 minutes`, `1st 30min` resolve to the same window. Anything else → `null` = unspecified.

### 2. Classify each trade

Derived tag per trade:

- `in_window` — fill minute inside parsed window
- `out_of_window` — window exists, fill minute outside
- `unspecified` — no window logged or unparseable

### 3. New "Window discipline" control on the tab

Three options, sits next to Mode / Bucket size / Symbol:

```text
Window discipline:  [ Any ]  [ In-window only ]  [ Out-of-window only ]
```

- **Any** — current behavior.
- **In-window only** — heatmap shows the edge of trades you took inside your plan. Answers "is my window right".
- **Out-of-window only** — shows what happens when you chase. Confirms drift is costly.

`unspecified` trades are excluded from the in/out filters with a small footer count: `12 trades excluded — no ideal window logged`.

No "Split rows" mode — the per-symbol summary below already conveys the comparison without doubling heatmap height.

### 4. Per-symbol discipline summary line

Below the heatmap, one row per symbol with parseable windows:

```text
EURUSD   in-window +0.42R N 38   ·   out-of-window −0.31R N 14   ·   drift cost −0.73R
```

Amber chip on `drift cost` only when **both** sides have N≥5 and `|drift cost| ≥ 0.30R`. Below that threshold, render the number muted, no chip.

### 5. Replace the existing "first half vs second half" block conditionally

When the filtered set has ≥ MIN_N_FOR_COLOR (5) trades with a parseable window, hide the halves block and show the discipline summary instead. Below that threshold, keep halves as the fallback. One conditional, no component split.

### 6. Coverage nudge per symbol

When a symbol has ≥10 trades but fewer than 5 with a logged window, render one muted line under the summary:

```text
EURUSD — log ideal window on 8 more trades to unlock discipline view
```

This is the only piece that loops back to journaling behavior. One `<div>`, no new state.

### 7. Header + footer copy

Intro sentence notes the tab now respects logged `ideal entry window`. Footer info icon lists the supported phrases so you know what parses.

## Out of scope

- No journaling field changes, no new custom field, no DB migration.
- No `pairLabMath.ts`, Strategy Lab, simulator, or edge-function changes.
- No "how far out of window" bucketing — needs more data to be non-noise; revisit later.

## Technical notes

- Parser + classifier live in `src/components/pair-lab/IntraHourTiming.tsx` (or a small helper alongside it). Custom-field lookup uses the same path other Pair Lab components use for `cf_ideal_entry_window`.
- Minute math stays UTC (file already documents the invariance).
- `meanRWithCI` gates (N≥5 color, N≥15 edge proven) reused unchanged.
- Parser runs once inside the existing `useMemo`; no perf concerns.

## What this gets you

- **In-window only** → does my plan have an edge?
- **Discipline summary** → what is breaking the plan costing me?
- **All / Any** → has the underlying edge drifted somewhere new?
- **Coverage nudge** → tells you exactly where journaling discipline would unlock more analysis.

Three real questions answered, one journaling feedback loop, no UI bloat.
