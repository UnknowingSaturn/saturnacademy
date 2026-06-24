## Verification result

Phases 1-4 are largely applied. The remaining gaps are duplicated walk-forward UI inside `IdealWindowHeatmap`, dead `localWf` fallback, server-side tick-size override divergence, and a stale fixture path in the verify script.

### Verified clean
- **C1** `winnersMaePips` iterates raw rows, no `sl_initial` gate (`pairLabMath.ts:715`).
- **C2** `useTrades` account filter uses `account_id.eq.X,account_id.is.null`.
- **C3/M6** `isUnrealized()` lives in `shared/quant/stats.ts` and is consumed by `usePairLab` + `pairLabMath`.
- **H1** `bootstrapKellyCi` uses two independent RNG streams (`stats.ts:184-185`).
- **M1** Both `pairLabMath.ts` and `_shared/quant/pairLabMath.ts` use `sideOf()`-driven `longestLossStreak`.
- **M3** `baselineRs.push(r)` is gated to once per trade in `idealWindowMath.ts:290`.
- **C4** Single `usePairLab` call in `PairLab.tsx`, bounds via `usePairLabTradeBounds`.
- **C5** `PairLabWalkForwardContext` exists; `OverviewTab`, `StrategyTab`, `IdealWindowHeatmap` read it.
- **H4** Strategy Lab MC offloaded to `strategyLabMC.worker.ts`.
- **Phase 3** Tabs IA shipped; URL-bound state in `PairLab.tsx`.
- **Phase 4** UTC parser hardened, payload extended (`walk_forward`, `recommendationConfidence`, `expectancyAtSuggestedCi`, `suggestedTpR`), `--heat-positive/--heat-negative/--chart-trail` tokens applied, `tick_size_overrides` migration + client shim shipped.
- `sampleWindow`, `totalTradeRowsRaw`, dead `TRAIL_CAPTURE_FRAC` leak — all gone. `tsgo` is clean.

### Gaps to close

1. **Duplicate walk-forward UI inside `IdealWindowHeatmap`** (`IdealWindowHeatmap.tsx:144-149, 152-157, 434`).
   The component now lives inside `IdealWindowsTab`, which sits under `PairLabWalkForwardProvider` and inherits the lens that `OverviewTab` already exposes. The component still renders its own `<WalkForwardControls>` AND still wires a `localWf` fallback. Result: two slider rows on screen, plus dead state.
   - Remove `localWf` state and the `sharedWf ? ... : ...` branches; require context.
   - Remove the in-component `<WalkForwardControls>` render (keep the per-pair scope/regime/direction/minN/sort selectors).
   - Drop the `useOptionalPairLabWalkForward` import; use `usePairLabWalkForward` since the provider is now mandatory.

2. **Server-side tick-size overrides** (Phase 4 open question, answer = yes).
   `supabase/functions/_shared/quant/symbolMapping.ts` has no override path, so the AI pair-lab report uses default tick sizes while the UI uses overrides — divergence on crypto/exotic symbols.
   - Add an in-memory override map + setter to `_shared/quant/symbolMapping.ts` (mirror `src/lib/symbolMapping.ts`).
   - In `pair-lab-report/index.ts`, load `symbol_groups.tick_size_overrides` for the user, merge, and seed the map before running `buildBuckets`.

3. **`scripts/verify_pair_lab_math.ts` fixture path.**
   Script reads `/tmp/verify/trades.json` unconditionally and crashes if missing. Add a clear `process.exit(1)` with a hint pointing at the dump command, so future runs don't look like a verification failure.

4. **`entry_time` persistence** (Phase 4 second open question).
   Leave as-is. The display label + hardened parser cover the parity issue; rewriting historical `entry_time` would mutate user-owned data without an unambiguous gain. Document the decision in `brokerDst.ts` header.

### Technical details

**File edits**
- `src/components/pair-lab/IdealWindowHeatmap.tsx`
  - Replace `useOptionalPairLabWalkForward()` with `usePairLabWalkForward()`.
  - Delete `localWf`, `setLocalWf`, the clamp `useEffect`, and the `sharedWf ? ... : ...` ternaries (`wf`/`setWf` come straight from context).
  - Delete the `<WalkForwardControls ... />` block at ~L434 and the surrounding "Walk-forward" header row; leave the pair/scope/regime/direction/minN/sort controls.
  - Drop the now-unused `WalkForwardControls`, `WalkForwardState` imports; keep `resolveWindow` if still referenced (it is, for `dateFrom/dateTo`).

- `supabase/functions/_shared/quant/symbolMapping.ts`
  - Add `let TICK_OVERRIDES: Record<string, number> = {}` module state.
  - Export `setTickSizeOverrides(map)` and adjust `tickSizeForSymbol`/`pipSizeForSymbol` to consult overrides first (key by normalized symbol).

- `supabase/functions/pair-lab-report/index.ts`
  - Before computing buckets: `select tick_size_overrides from symbol_groups where user_id = ...`, merge into one map, call `setTickSizeOverrides(merged)`.
  - Reset overrides at end of the request (`setTickSizeOverrides({})`) to avoid bleed between invocations.

- `scripts/verify_pair_lab_math.ts`
  - Wrap fixture reads in a `try`/`fs.existsSync` guard with a one-line hint: "run `bun scripts/dump_pair_lab_fixture.ts` first" (or print the supabase query the user should run).

- `src/lib/brokerDst.ts`
  - Add 3-line header comment recording the decision to keep `entry_time` raw and display-only conversion.

**Validation**
- `bunx tsgo --noEmit` after edits.
- Manual: load Pair Lab → Ideal Windows tab and confirm only one walk-forward slider remains (the one from Overview).
- Manual: trigger pair-lab-report on a user with a crypto override and confirm `r_multiple_actual` / SL pip values in the AI payload match the UI.