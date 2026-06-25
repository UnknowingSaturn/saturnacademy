# Pair Lab Remediation Audit (Phases A–I)

I re-read every file touched by Phases A–I and grepped the codebase for the symbols each phase added or purged. **All 24 fixes are in place and reachable from the live UI**, with one minor cleanup worth doing.

## Phase-by-phase verification

### Phase A/B/C — Correctness, parity, dead-code
- ✅ `isUnrealized` is the single source of truth — imported by `usePairLab`, `idealWindowMath`, both `pairLabMath` modules, and the OOS worker.
- ✅ Prop-firm Kelly math matches client ↔ edge: both gate on `dailyLossDollars > 0` and default `hardCapPct` to 2 when ≤ 0 (`src/lib/pairLabMath.ts:1002`, `supabase/.../pairLabMath.ts:522`).
- ✅ Purged shims are gone: zero hits for `wilsonInterval`, `bootstrapMeanCI`, `parseTpLabel`, `actualProfile`, `DEFAULT_TRAIL_CAPTURE`, `totalTradeRowsRaw`. The `idealWindowMath` header comment documents the removal.

### Phase D — State + perf
- ✅ `useSymbolGroups()` is called **once** in `PairLab.tsx:98`; `OverviewTab` consumes it as a prop (only the `SymbolGroup` type is imported).
- ✅ OOS dual-bucket build runs in `src/workers/oosSplit.worker.ts` via `useOosSplit`; `OutOfSamplePanel` reads bounds from `usePairLabTradeBounds` (no per-memo full sort).
- ✅ `recentN` is no longer in `PairLabWalkForwardContext` (grep returns empty). `usePairLab` still accepts the optional filter and defaults to 10, so the field was cleanly retired without breaking callers.

### Phase E — UX + verify script
- ✅ `scripts/verify_pair_lab_math.ts` imports `normalizeSession` from shared, runs per-cell `expectedR` + Wilson `winRateCi` lo/hi checks (lines 144–177), and validates baseline `profitFactor` + `profitFactorAllWins` (lines 233–240).
- ✅ `IDEAL_WINDOW_OPTIONS` uses `hsl(var(--heat-positive|--heat-negative|--chart-trail|--muted-foreground))` exclusively.
- ✅ `OutOfSamplePanel` formats dates with the `(UTC)` suffix and the dynamic profile picker derives from real trade values.

### Phase F — Critical bugs (1–5)
- ✅ **F1 session aliasing**: `SESSION_LABELS` in `shared/quant/stats.ts:276–278` maps `overlap_london_ny`, `ny_london`, and `london_ny_overlap` all to "Overlap".
- ✅ **F2 edge filter**: `tp1StarPairs` loop in edge math now starts with `if (isUnrealized(t)) continue;` (line 385).
- ✅ **F3 ideal-windows filter**: `idealWindowMath.ts:238` skips unrealized rows.
- ✅ **F4 OOS context**: `includeUnrealized` is threaded `PairLab → StrategyTab → OutOfSamplePanel → useOosSplit → worker` (worker uses it on both train and test buckets, lines 59 + 67).
- ✅ **F5 missing-field diagnostics**: `usePairLab` returns the structured `missingFields` object and `OverviewTab` surfaces field-specific warnings.

### Phase G — Parity (6–10)
- ✅ Prop-firm parity (see Phase A).
- ✅ `rFallbackCount` flows through the hook and renders as the amber "{n}/{N} R inferred" badge (`OverviewTab.tsx:432`).
- ✅ Orphan default is on (`includeUnassigned`) with the "+N orphan" muted chip at line 455 and the toggle at line 159.
- ✅ Open-trade leakage: `usePairLab` filters `t.is_open` twice (lines 117 + 232) — once in the baseline pass, once in `scopedTrades`.
- ✅ `tickSizeOffenders` covers crypto + indices and renders the warning at `OverviewTab.tsx:346`.

### Phase H — Architecture (11–15)
- ✅ Journal alias resolver: `Journal.tsx` memoizes `symbolResolver` and applies it in the filter (line 152) and the `getTradeValue('symbol')` sort case (line 212).
- ✅ `countNaiveEntryTimes` is exported from `shared/quant/stats.ts:412`, wired into `usePairLab` (line 263), exposed on `PairLabData.naiveTimestampCount`, and rendered at `OverviewTab.tsx:472`.
- ✅ Hardened `isUnrealized` keeps the `is_open` guard, executed-only zero-PnL branch, and strict-equality SL/TP checks.
- ✅ `SL_DRIFT_ALIGNED_MIN/MAX` JSDoc explains the 0.80/1.20 band and the discipline-vs-suggested-SL distinction.

### Phase I — Cleanup (16–19)
- ✅ `bootstrapKellyCi` uses two seeded streams (`randPayoff` + `randBinom`, `shared/quant/stats.ts:184–185`).
- ✅ Naive-timestamp detector + UI chip (covered above).
- ✅ `"mixed"` is removed from the `IdealWindowValue` union and `IDEAL_WINDOW_VALUES` picker list; a runtime-only `LEGACY_IDEAL_WINDOW_VALUES` set keeps `readIdealWindow` backward-compatible and `decode("mixed")` still maps to `first_worked + second_failed`.
- ✅ Expanded `isUnrealized` partial-fill heuristic adds the "flat-fill" branch (`entry_price === exit_price` + one untouched side) and the empty `partial_fills` branch.

## One residual cleanup worth doing

**Dead `case "mixed"` in `decode` switch.** `IdealWindowValue` no longer includes `"mixed"`, so TypeScript treats the case as unreachable for the typed path. Since the parameter is `IdealWindowValue | string | null | undefined` the case still fires for legacy DB strings, so the behavior is correct, but the comment + case look inconsistent with the union now that `"mixed"` is a "legacy string only" value.

Proposed micro-fix (build mode):

```ts
// In src/lib/hourSetup.ts decode()
// Legacy "mixed" arrives as a plain string (not in IdealWindowValue) — handle
// it before the switch so the switch only deals with the canonical 9 states.
if (value === "mixed") return { ...EMPTY, firstWorked: true, secondFailed: true };
```

…and drop the `case "mixed":` branch + comment from inside the switch.

## What I did NOT find any regressions in

- No remaining call sites for purged helpers.
- No duplicate `useSymbolGroups` / `useSymbolAliases` subscriptions in PairLab tabs.
- No edge-vs-client divergence on `isUnrealized`, `normalizeSession`, `bootstrapKellyCi`, or prop-firm Kelly gating.
- No render path that bypasses `includeUnrealized` (heatmap, grid, OOS worker, edge report all gate on it).

## Recommendation

Approve the one-line cleanup above (Phase I follow-up). Everything else from Phases A–I is verified and behaving as designed.
