# Merge Grid + Simulator into one "Analyze" tab

## Recommendation

Given your flow (**Find → simulate**) and your preference for **clean, focused views**, the most professional pattern is a **single stacked tab** — not a split pane. Split panes look impressive on a marketing screenshot but in practice they fight each other for vertical space, force the simulator's charts and tables to render in a cramped column, and make the grid feel like a sidebar. Bloomberg, TradingView's strategy tester, QuantConnect, and Tradezella all use a stacked pattern for this exact reason: the analyst scans a table, picks a row, and the deeper view unfurls beneath it at full width.

The split-pane idea also conflicts with your other answer ("keep it clean"). A persistent side panel forces the simulator to *always* be visible, even when you haven't selected anything yet — which means empty states, narrow charts, or a permanently-half-used screen.

## What changes

**Collapse `Grid` and `Simulator` into one tab called `Analyze`** (or `Buckets`, your call). Five tabs become four: `Ideal windows · Analyze · Strategy lab · Symbol aliases`.

Inside `Analyze`:

```text
┌─────────────────────────────────────────────────────────────┐
│ Baseline summary card                                       │
├─────────────────────────────────────────────────────────────┤
│ BucketGrid (full width — unchanged)                         │
├─────────────────────────────────────────────────────────────┤
│  ↓ smooth scroll-to / fade-in when a cell is selected ↓     │
├─────────────────────────────────────────────────────────────┤
│ Selection header: "EURUSD · London"  [Clear] [Sim profile▾] │
├─────────────────────────────────────────────────────────────┤
│ QuantNotePanel  (bucket stats + AI note)                    │
├─────────────────────────────────────────────────────────────┤
│ StrategyRanker  (full-width simulator — what's on the       │
│ Simulator tab today, scoped to the selected bucket)         │
└─────────────────────────────────────────────────────────────┘
```

**Empty state (no cell selected):** the area below the grid shows a single muted card — *"Select a cell above to simulate that bucket, or [Simulate all trades in scope]"*. The second option preserves today's "no selection = simulate everything" behavior without making the simulator dominate the page.

**On selection:** the simulator section fades in and the page smooth-scrolls so the selection header lands just below the viewport's top. No layout jank, no tab switch, no lost context. This is the canonical "Find → simulate" gesture.

## Why this is the professional choice

- **One canvas per task.** Analysts read top-to-bottom; the grid → note → simulator order matches the actual decision sequence (scan → confirm → size).
- **Full-width charts.** The equity curve, ladder histogram, and replay table all render at proper width instead of being squeezed into a 50% column.
- **Self-documenting.** A new user lands on the page and sees the entire workflow without needing to discover a second tab.
- **No state to sync.** Today, selecting a cell on the Grid tab silently updates the Simulator tab — you only find out by clicking over. Inline removes that hidden coupling.

## What stays

- All math, hooks, and component internals are untouched — `BucketGrid`, `QuantNotePanel`, `StrategyRanker`, `SimulatorProfileSettings` all keep their props and behavior.
- `selected` state, prop-firm mode, profile filter, baseline card, partial-fill warning, SL-coverage warning — all unchanged.
- `Ideal windows`, `Strategy lab`, `Symbol aliases` tabs are untouched.

## Technical notes

- **File:** only `src/pages/PairLab.tsx` changes. Delete the `<TabsTrigger value="simulator">` and `<TabsContent value="simulator">`; move the simulator JSX into the `grid` tab's `<TabsContent>`, after the `QuantNotePanel` block. Rename `value="grid"` → `value="analyze"`, label `Analyze`.
- **Scroll-on-select:** wrap the simulator section in a `ref`'d `<div>`; in a `useEffect` keyed on `selected`, call `ref.current?.scrollIntoView({ behavior: "smooth", block: "start" })` when `selected != null`.
- **Empty state:** when `selected == null`, render a muted card with two actions: *Clear hint* (the current "select a cell" copy) and a *Simulate all trades in scope* button that's equivalent to today's default-tab behavior — clicking it just expands the simulator without setting `selected`. Implementation: track a local `simulateAll` boolean alongside `selected`; if either is truthy, render `StrategyRanker`.
- **Selection header:** small flex row above `QuantNotePanel` with the scope label, a `[Clear]` button (sets `selected = null` and `simulateAll = false`), and the existing `<SimulatorProfileSettings />` popover trigger (moved up from the simulator card).
- No schema, no dependencies, no math changes.

## Out of scope

- Side-by-side / split-pane layout (rejected above).
- Restructuring `Strategy lab` or `Ideal windows`.
- Any change to the simulator's internal layout.
