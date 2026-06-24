# Tightened Pair Lab Plan

Replace the current `.lovable/plan.md` with this streamlined version. Same goals (walk-forward analysis, per-pair-per-hour resolution, pair groups, cleaner Analyze tab), less machinery.

## Guiding principles

1. **Walk-forward by default** — every bucket metric is a function of `asOfDate`. No future leakage. Atom stays *pair × hour-half*; groups are sums over atoms.
2. **One source of truth for selection** — a single `selected` state (URL-synced). No `simulateAll` flag, no conditional mounting, no fade transitions.
3. **Composable, not duplicated** — groups never become separate measurements; they are views over the same atoms, so merge/unmerge is always lossless.

## Part 1 — Pair groups (merge)

- New table `symbol_groups` (`id`, `user_id`, `name`, `color`, `symbols text[]`, timestamps) + RLS + GRANTs.
- `useSymbolGroups` hook (CRUD).
- `SymbolGroupManager` panel with starter templates (EUR majors, USD majors, Metals, Indices).
- View selector on heatmap and Analysis tab: **Individual / Grouped / Both**. "Other" row catches ungrouped pairs.
- Ad-hoc merge: row-header action "Analyse as one" on the heatmap.
- Group metrics are recomputed from the underlying trades (N-weighted), never averaged from per-pair rates.

## Part 2 — Walk-forward layer (shared)

Single primitive in `idealWindowMath.ts`:

```text
bucket = { events: { ts, worked }[] sorted asc }
bucket.asOf(date) -> { rate, n, wilsonCI, rolling, drift }
```

All UI reads through `asOf()`. Tagging code path is unchanged.

Heatmap cell:
- Headline worked-rate as-of selected date
- Sparkline over last N tagged trades (causal)
- Drift arrow when recent vs lifetime diverges ≥15pp AND recent N ≥5

Global controls (top of Pair Lab + Analysis tab):
- Lens toggle: All-time / 90d / 30d
- As-of date slider (walk-forward inspector)

Cell drill-down modal:
- Cumulative worked-rate + Wilson CI band
- Rolling worked-rate overlay
- Individual trade dots (✓/✗)
- Optional regime breakpoint markers

Out-of-sample panel: pick split date → train vs test worked-rate per bucket.

No-leakage rule: a trade contributes to its bucket using `entry_timestamp` only.

## Part 3 — Analyze tab cleanup

Replace the `simulateAll` machinery with one state model.

```text
Analyze tab
├── Baseline summary card
├── BucketGrid
├── Sticky selection header (chip + Clear, or "All in-scope")
├── QuantNotePanel (bucket OR baseline note)
└── StrategyRanker (always rendered; scope follows `selected`)
```

- Single `selected` state, synced to URL via `useSearchParams` (`?pair=&hour=&half=`). Deep-linkable, back/forward works, refresh preserves context.
- Sticky selection header (`position: sticky; top: 0`) so context is always visible.
- `Esc` clears selection (one keydown listener).
- Scroll-on-select: CSS `scroll-margin-top` on the header + one `scrollIntoView` call. No effect-driven mounting, no fade.
- `SimulatorProfileSettings` stays inside the simulator section.

## Files touched

- New migration: `symbol_groups` + RLS + GRANTs
- New: `useSymbolGroups.tsx`, `SymbolGroupManager.tsx`, `WalkForwardControls.tsx`, `CellHistoryModal.tsx`
- Updated: `src/lib/idealWindowMath.ts`, `src/lib/pairLabMath.ts`, `src/components/pair-lab/IdealWindowHeatmap.tsx`, `src/components/pair-lab/StrategyRanker.tsx`, `src/pages/PairLab.tsx`
- Replace `.lovable/plan.md` with this document

## Out of scope (explicit)

- Exponential time-decay weighting (revisit if drift signal proves noisy)
- Server-side recomputation — all math stays in the browser (hundreds–few thousand tagged trades)
- Changes to tagging UX or trade ingestion
