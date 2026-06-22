# Strategy Lab — Time Window Filter

Add a preset time-window selector to **Strategy Lab only**. BucketGrid and StrategyRanker stay on the existing (all-time) sample.

## Scope

- Presets: **All · 30d · 60d · 90d**
- Default: **All time** (preserves current behavior — no surprise regressions)
- Applies to: every calculation downstream of the trade sample inside `StrategyLab.tsx` (edge gate, bootstrap, heatmap, sizing recommendations, pass-prob simulation, TPD auto-calc)
- Does **not** apply to: `BucketGrid.tsx`, `StrategyRanker.tsx`

## UX

Compact segmented control in the Strategy Lab header row, right of the title:

```text
Strategy Lab          [ All · 30d · 60d · 90d ]
Sample: 296 trades · Jan 3 → Jun 22
```

Below the selector, always show:
- `n` (filtered trade count)
- Window date range (first → last entry in filtered set)

When the selected window pushes `n` below tier thresholds, the **existing** edge-gate / provisional banners fire automatically — no new warning logic needed. Add one sentence to the existing banner when a non-"All" window is active: *"Narrow window selected — widen to All for more samples."*

## Technical changes

**`src/components/pair-lab/StrategyLab.tsx`** (only file touched)

1. Add local state: `const [window, setWindow] = useState<'all'|'30d'|'60d'|'90d'>('all')`
2. Derive `filteredTrades` from the incoming trade prop:
   ```ts
   const filteredTrades = useMemo(() => {
     if (window === 'all') return trades;
     const days = window === '30d' ? 30 : window === '60d' ? 60 : 90;
     const cutoff = Date.now() - days * 86400_000;
     return trades.filter(t => new Date(t.entry_time).getTime() >= cutoff);
   }, [trades, window]);
   ```
3. Replace every internal reference to the source trade array with `filteredTrades` (sample extraction, `meanRWithCI`, `autoTradesPerDay`, bootstrap input, heatmap data).
4. Add the segmented control + `n` / date-range readout in the existing header.
5. Append the "Narrow window selected" hint inside the existing edge-gate banner when `window !== 'all'`.

**No changes** to:
- `propFirmMonteCarlo.ts` (already operates on whatever sample it's handed)
- `BucketGrid.tsx`, `StrategyRanker.tsx`, `pairLabSimulator.ts`, shared quant code
- Tier thresholds in `shared/quant/config.ts`

## Why this shape

- **Presets, not a date picker** — prevents sliding the window until CI turns green (p-hacking).
- **Default All** — matches today's behavior; no user re-education needed. Short windows are an opt-in lens.
- **Lab-only** — Grid/Ranker remain comparable across sessions; only the sizing/sim view (which is where window-sensitivity matters) gets the control.
- **No new statistics** — the existing `n ≥ 30` + CI-lower-bound > 0 gate already handles the "sample too small" case correctly when filtering shrinks `n`.

## Out of scope (v1)

- Custom date range picker
- Per-strategy or per-symbol windows
- Persisting window choice across sessions
- Applying the filter to BucketGrid / StrategyRanker
