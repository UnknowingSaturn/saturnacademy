
# Pair Lab — Persistence + Honest Audit

Two workstreams. I want to do the audit **before** rewriting math — the safe way to "not make things worse" is to first document what actually exists (with file:line refs), diff it against Journal semantics, and only then patch. Any fix I propose without that step would be a guess.

## Part A — Persist filter state per user (root-cause fix)

**Problem (verified in code).** `src/pages/PairLab.tsx` reads every filter from `useSearchParams`. If the URL has no query string (fresh navigation from the sidebar, new tab, bookmark to `/pair-lab`), every toggle falls back to its hard-coded default (`profile=any`, `pf=on`, `unreal=off`, `orphans=on`, `scope=all`, `lens=all`, `asOf=now`, `tab=overview`). Nothing is written to the database or `localStorage`, so it looks like the app "forgets" your setup on every reload.

**Fix.** Store last-used Pair Lab filters per user and hydrate them on mount when the URL doesn't already specify them. URL still wins when present (shared links, deep links from Coach/Journal keep working).

Concretely:
1. Add a JSONB column `pair_lab_prefs` to `public.simulator_profile` (same row that already owns `ranker_comfort_dd_pct`, `sim_hard_cap_pct`, etc. — one round-trip, one RLS policy already in place). Migration includes the standard GRANT block; existing RLS untouched.
2. Shape (small, forward-compatible):
   ```ts
   {
     profile?: string;              // "any" | tag
     propFirmMode?: boolean;
     includeUnrealized?: boolean;
     includeUnassigned?: boolean;
     scope?: string;                // "all" | "grp:<id>"
     tab?: "overview"|"grid"|"windows"|"strategy"|"setup";
     lens?: "all"|"90d"|"30d";
     distanceUnit?: "pips"|"ticks";
   }
   ```
3. Extend `useSimulatorProfile` with a debounced `updatePairLabPrefs(partial)` mutation (300 ms debounce, optimistic cache update, no toast).
4. In `PairLab.tsx`:
   - On first mount, if a given URL param is absent, seed from `pair_lab_prefs`; if present, URL wins.
   - Every existing `setX` callback also fires `updatePairLabPrefs({ x })`.
   - `asOf` and per-cell `symbol`/`session` selection are **not** persisted (session-scoped; would confuse across sessions).
5. `distanceUnit` today uses `useDistanceUnit` (localStorage). Move source of truth into the same server prefs so it survives across devices; keep a localStorage fallback for unauth'd renders.

**Acceptance.** Reload `/pair-lab` in a fresh tab with no query string → prop-firm toggle, unrealized, orphans, scope, profile, lens, tab, distance unit are restored to whatever the user last set. A shared URL with `?pf=0&lens=90d` still overrides.

## Part B — Thorough Pair Lab audit (deliverable = report, not code)

You explicitly asked me not to hallucinate. The only way I can honestly deliver a "heavy and thorough analysis of all pages, code, math, methodologies, data accuracy vs. journal" is to first produce a written audit doc you can read and approve/reject item by item. I will not silently rewrite math in the same PR.

Scope of the audit (fixed, nothing else touched):

| Area | Files audited | What I check |
|---|---|---|
| Data ingress vs. Journal | `usePairLab.tsx`, `useTrades.tsx`, `shared/quant/stats.ts` (`isUnrealized`, `ensureUtcMs`, `countNaiveEntryTimes`), `hooks/useOosSplit.ts` | Does the trade universe Pair Lab bucketizes exactly match what Journal shows? Account filter, orphans, archived, open, unrealized, TZ handling, walk-forward window edges. Cross-check by row count and by a sampled trade ID list. |
| Bucketing & baselines | `lib/pairLabMath.ts` (1285 lines) — `buildBuckets`, `resolvePairLabFieldKeys`, `detectAmbiguousFieldKeys`, `estimateTrailCapture`, quantile / expectancy / recommendation code | Quantile method (interpolation vs. nearest), R-fallback branch (sign-inferred R), MFE/MAE unit conversion via tick overrides, ¼-Kelly formula, recommendation guardrails, empty-sample and single-sample behaviour, NaN propagation. |
| Simulator / prop-firm math | `lib/pairLabSimulator.ts` (1225 lines), `lib/propFirmMonteCarlo.ts`, `useSimulatorProfile.tsx` | Balance source resolution (`manual` vs `active_account`), rule → dollars conversion (percentage flag), hard-cap application order, compounding vs. fixed risk, RNG seeding, path count, DD tolerance semantics. |
| Ranker + risk-MC | `StrategyRanker.tsx`, `useRankerRiskMC.ts`, `workers/rankerRiskMC.worker.ts`, `useStrategyLabSweep.ts` | Sort key (BCa lower bound of R), risk grid clipping to `sim_hard_cap_pct`, ruin-prob ceiling, comfort-DD flow, worker payload contract, verdict thresholds. |
| Presets & Strategy Lab | `lib/pairLabPresets.ts`, `StrategyLab.tsx`, `tabs/StrategyTab.tsx` | Preset R sample derivation, deterministic replay, out-of-sample split (`useOosSplit`), whether preset simulations still respect walk-forward and profile scope. |
| Ideal windows & grid | `IdealWindowHeatmap.tsx`, `BucketGrid.tsx`, `lib/idealWindowMath.ts`, `lib/hourSetup.ts` | Timezone of hour-buckets vs. session definitions, min-sample gating, colour-scale saturation, drift-signal window `recentN`. |
| Symbol layer | `lib/symbolMapping.ts`, `lib/symbolAliasing.ts`, `useSymbolGroups.tsx`, `useSymbolAliases.tsx`, `SymbolGroupManager.tsx`, `SymbolAliasManager.tsx` | Tick-size override precedence, classify vs. normalize order, group scope override interaction with aliases, the J4 side-effect subscription. |
| UI shell & context | `pages/PairLab.tsx`, `contexts/PairLabWalkForwardContext.tsx`, `WalkForwardControls.tsx`, `usePairLabTradeBounds.ts` | URL ↔ state contract, memoization boundaries, tabs that re-mount and lose local state, effect deps that miss inputs. |
| Server parity | `supabase/functions/pair-lab-report/*` and `serverReplayParity.test.ts` | Any server surface must produce the same numbers as the client for the same inputs. Divergences get logged, not silently normalized. |
| Dead code / drift | Entire `src/components/pair-lab` and `src/lib/pairLab*.ts` | Unreferenced exports, superseded helpers, legacy field-key branches, TODO/FIXME density, tests pinning obsolete behaviour. |

**Method (no guessing).**
- Three parallel `spawn_agent` explorations (data-plumbing, math-core, UI/UX+dead-code), each producing a section of the report with `file:line` citations.
- Cross-check ~20 randomly sampled trade IDs against Journal's own hook to confirm identical inclusion decisions.
- Where the code deviates from its docstring/comment → finding.
- Where two surfaces (Overview baseline vs. Ranker vs. server report) can produce different numbers for the same window → finding.

**Deliverable.** A single markdown file `.lovable/pair-lab-audit.md` with:
1. Executive summary — count of findings by severity (blocker / correctness / perf / UX / dead-code).
2. One entry per finding: title, `file:line`, current behaviour (quoted), expected behaviour, evidence, suggested fix, risk of fixing.
3. An explicit "unresolved / needs your call" list — e.g. "Ranker sort key is BCa lower bound of R, ignoring compounding. Intended?" I will not silently change these.

**Then and only then** you pick which findings to actually fix, and I open a follow-up plan with the concrete diff set. This is the only way to genuinely not make things worse.

## Out of scope for this plan
- Rewriting any math or UI in Pair Lab before the audit report is reviewed.
- Journal, Copier, Coach, Playbooks, Reports, Strategy Lab preset library changes.
- Adding new features (new metrics, new presets, new charts).

## Technical notes
- Migration is additive (JSONB column with default `'{}'::jsonb`). No backfill required — absence means "no saved prefs, use current defaults".
- Prefs write is fire-and-forget with optimistic cache update; a failed write logs a console warning and doesn't block the UI.
- `TanStack Query` cache key already keyed by `user.id`; adding one field doesn't invalidate other consumers.
- Audit produces a doc committed under `.lovable/` — no runtime impact.

## Order of execution
1. Ship Part A (small, isolated, verifiable in one reload).
2. Produce Part B report.
3. You review the report → we open a third plan for the concrete fixes you approve.
