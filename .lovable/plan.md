# Pair Lab Audit — Findings & Remediation Plan

Three parallel deep-audits (Math, UI/State, Data Pipeline) surfaced 27 issues. Below is a phased fix list, ordered by severity. Each item is a pure code change; no UX restructure.

---

## Phase J — Critical Correctness (crashes, data loss, silent leaks)

**J1.** `supabase/functions/_shared/quant/pairLabMath.ts:546` — `mfes` is referenced but never declared in edge `computeBucket` → **ReferenceError** on every edge-side report. Add `const mfes = rows.map(t => numericCf(t, keys.mfe)).filter(...)` before the return.

**J2.** Same file:584 — edge `buildBuckets` signature is missing `profile`, `dateFrom`, `dateTo`, `recentN`, `includeUnrealized`. Mirror the client `BuildBucketsOpts` so server reports honor walk-forward, profile, and unrealized filters.

**J3.** `src/hooks/usePairLab.tsx:114` — `detectPartialFills` uses a stale "two rows in the same minute" heuristic and ignores `trade_partial_fills` (already on `t.partial_fills`). Rewrite to count `t.partial_fills.length > 0`, eliminating both false positives (scalpers) and false negatives (real partial exits).

**J4.** `src/hooks/usePairLab.tsx:293` — symbol-groups data (which installs `tick_size_overrides`) is **not** in `usePairLab`'s `useMemo` deps. First render computes buckets with empty overrides; if no other dep changes, stale tick math sticks. Add `useSymbolGroups().data` (or pass overrides explicitly) to the dep array.

**J5.** `src/workers/oosSplit.worker.ts:62-68` — `splitIso` boundary is inclusive in both train & test ⇒ trades at the split timestamp leak into both halves. Shift test `dateFrom` by +1 ms.

**J6.** `src/hooks/useOosSplit.ts:29` — `includeUnrealized` excluded from the memoization fingerprint ⇒ toggling the header switch leaves stale OOS results. Add it to the JSON key object.

**J7.** `src/lib/pairLabSimulator.ts:494` — `dailyLossDollars === 0` is treated as a real 0 cap, busting every path on any loss. Guard with `> 0` to match client `buildRecommendation` and edge `computeBucket`.

---

## Phase K — Math & Parity Hardening

**K1.** `shared/quant/stats.ts:192` — `bootstrapKellyCi` resamples wins and losses from the same `randPayoff` stream, so the documented independence is not real and CI widths are mildly underestimated. Add a third seeded stream `randLoss = makeSeededRng(seedBase ^ 0x27d4eb2d)` for the loss loop.

**K2.** `src/lib/pairLabMath.ts:285-299` — `resolvePairLabFieldKeys` uses `Array.find`, silently ignoring a second `cf_mae_*` / `cf_mfe_*` definition. Switch to `filter`, expose an `ambiguousFields` flag alongside `missingFields`, and surface it in the Overview warnings.

**K3.** `src/lib/time.ts:99` — `detectSessionFromUtc` formats the hour with `currentDisplayTimezone` (Tokyo/London users get the wrong session bucket). Hardcode `timeZone: 'America/New_York'`.

**K4.** `src/lib/brokerDst.ts:136` — fallback path for non-matching naive timestamps calls `new Date(s)` (locale-dependent) then subtracts the DST offset, risking a double shift. Log a warning and return `new Date(s)` unchanged.

**K5.** `src/hooks/usePairLab.tsx:263` — `countNaiveEntryTimes` runs only on `scopedTrades` (closed). Run it on the full `trades` array so open trades with naive TZ strings still surface in the header chip.

---

## Phase L — Journal ↔ Pair Lab Data Parity

**L1.** `src/pages/Journal.tsx:60` — `useTrades()` is called with no account filter ⇒ fetches all accounts and filters in JS. Pass `{ accountId: selectedAccountId !== "all" ? selectedAccountId : undefined, includeUnassigned: true }` to mirror Pair Lab and shrink the wire payload for multi-account users.

**L2.** Add `countNaiveEntryTimes(...)` chip to Journal header so the DST/naive-timestamp signal is symmetric with Pair Lab.

**L3.** `src/hooks/useTrades.tsx:22` — stale doc comment says Pair Lab passes `includeUnassigned: false`; current default is `true`. Update the JSDoc.

---

## Phase M — UI/State/Perf & Cleanup

**M1.** `src/contexts/PairLabWalkForwardContext.tsx:41` + `src/pages/PairLab.tsx:163` — inline `value={{…}}` object recreated every render forces all 6 consumers to re-render. Either `useMemo` the value at the call site, or change `merged`'s deps to the individual primitives. *(Highest-leverage perf fix.)*

**M2.** `src/components/pair-lab/IdealWindowHeatmap.tsx:178` — shadow `resolveWindow(wf)` call; read `dateFrom/dateTo` from `usePairLabWalkForward()` instead (already on the context).

**M3.** `src/components/pair-lab/tabs/StrategyTab.tsx` — drop the `propFirmMode` prop and read it from context to remove the prop/context dup (M10 of UI audit).

**M4.** `src/components/pair-lab/QuantNotePanel.tsx:36` — clear `note/loading/error` on `[bucket.key.symbol, bucket.key.session]` change so stale AI text doesn't follow a new cell selection.

**M5.** `src/components/pair-lab/StrategyLab.tsx:122,137` — `useEffect(() => setTradesPerDay(detectedTpd), [detectedTpd])` so the auto-detected trades/day updates when scope/lens changes. Also delete the dead `const filteredTrades = trades;` alias and use `trades` directly.

**M6.** `src/hooks/useStrategyLabSweep.ts:27` — replace full `JSON.stringify(params)` with a lightweight fingerprint (length + first/last sample id + scalars), mirroring `useOosSplit`.

**M7.** `src/pages/PairLab.tsx:107-116` — URL-bind walk-forward `lens` and `asof` so reload/share preserves the window. Also URL-bind the Ideal Windows pair scope (`idw_scope`).

**M8.** `src/components/pair-lab/tabs/OverviewTab.tsx:77` — wrap `closed` in `useMemo([data.trades])` so `tickSizeOffenders` stops invalidating every render.

**M9.** Tokenize remaining hard-coded colors:
- `IdealWindowHeatmap.tsx:91-92` rgba literals → `hsl(var(--heat-positive|negative) / α)`
- `CumulativeExpectancyChart.tsx:103` SVG `fill-emerald-500` → inline `hsl(var(--heat-positive))` to match the canvas branch
- Scattered `text-emerald-*` / `bg-emerald-*` in `BucketGrid`, `StrategyRanker`, `StrategyLab` → `text-profit` / `bg-profit/15` / `border-profit/30`

**M10.** Add an Escape-key handler to the `IdealWindowHeatmap` drill-down panel for parity with `PairGridTab`.

**M11.** `src/lib/hourSetup.ts:90` — surface a one-time UI hint ("N trades have legacy `mixed` tags — decoded as 1st✓ · 2nd✗") in the Ideal Windows tab when legacy rows are detected.

**M12.** `src/lib/pairLabSimulator.ts:162-174` — delete the duplicated local `getCf`/`numericCf` and import from `shared/quant/stats`.

---

## Out of scope (verified correct, do not change)

Wilson CI · profit-factor formula (both sides) · expectancy · degradation % · SL drift band 0.80–1.20 · session-label map · `isUnrealized` (open-guard, flat-fill, empty `partial_fills`) · `isNaiveTimestamp` regex · `hardCapPct` default 2% · `computeNetPnl` sign convention · `eventsRFallbackCount` counting · `propFirmMonteCarlo` block bootstrap · `strategyLabMC.worker` per-cell seeding · `pair-lab-report` model id & error surfacing.

---

## Suggested execution

Approve as a single batch (J→K→L→M) or run J+K first (correctness) and review before L+M. Each item is independently mergeable; nothing requires a schema change.
