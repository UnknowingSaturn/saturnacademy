# Production cleanup & robustness plan

Synthesis of four parallel audits (edge functions, frontend, DB/RLS, EA + ingest pipeline). Grouped from "delete with no risk" → "structural redesign." Each item is independently shippable; later items can be deferred.

## Section 1 — Safe deletes (zero risk, high signal)

These have zero callers anywhere in the codebase.

**Edge functions / EA**
- Delete `mt5-bridge/TradeJournalBridge.mq5` — byte-identical to `public/TradeJournalBridge.mq5`. Keep `public/` as single source of truth.
- Delete `supabase/functions/scalp-edge-analysis/` (723 LOC, zero frontend callers; pure client-computable math).
- Delete `src/hooks/useSetupTokens.tsx` — all 3 exports have zero consumers (only `useCreateCopierSetupToken` from `useCopier.tsx` is used).

**DB tables (no frontend reads, no edge fn writes — verified)**
- `simulation_runs`, `backtest_results`, `generated_strategies`, `strategy_conversations` (the abandoned Code Lab cluster)
- `trade_groups` (+ FK column `trades.trade_group_id`)
- `ai_feedback`, `ai_prompts` (prompts are hardcoded inside edge fns)

**DB columns (dead schema)**
- `trades.profile`, `trades.place`, `trades.partial_closes` (superseded by `trade_partial_fills`)
- `accounts.force_resync` (UI doesn't read it; the EA flow uses the watermark-nulling trick in `sync-account-state` instead)
- `accounts.field_label_overrides` (superseded by `field_overrides` table)
- `accounts.api_key` if confirmed unused after a final grep (moved to `setup_tokens`)

## Section 2 — RLS + GRANT fixes (correctness)

- **`ai_reviews`** still uses a `trade_id IN (SELECT ... FROM trades WHERE user_id = auth.uid())` subquery on every access despite having a direct `user_id` column. Replace all 4 policies with direct `auth.uid() = user_id`.
- **Remove `trades` and `copier_executions` from `supabase_realtime`** — no frontend channel subscriptions exist, but every write burns WAL decode CPU. (`useOpenTrades` realtime listens to a different pattern.)
- **`prop_firm_rules`**: change `USING (true)` to `TO authenticated USING (true)` so anon can't scrape it.
- Add explicit `GRANT SELECT, INSERT, UPDATE, DELETE ... TO authenticated` to original tables (`trades`, `accounts`, `playbooks`, `trade_reviews`, `profiles`, `user_settings`, `notebook_entries`, `reports`) that today rely on Supabase's permissive default.
- Add missing `UPDATE` policy to `setup_tokens` (used→consumed flow).

## Section 3 — Edge function consolidation

1. **Secure `restore-trade-times`** — currently `verify_jwt=false` and no in-code `getUser()`. Anyone with a guessed account UUID can overwrite trade timestamps. Add JWT + account ownership check, then mark it as a one-shot migration utility (not exposed to general users).
2. **Secure `playbook-assistant`** — same gap. ~5 lines to add `getUser()`. Currently burns AI quota for any anonymous caller.
3. **Merge `reclassify-sessions` into `reprocess-trades`** — `reprocess-trades` is a strict superset. Update the one frontend caller in `SessionConfigPanel.tsx` to call `reprocess-trades`. Delete `reclassify-sessions`.
4. **Trim `copier-update-check`** — delete the unused `mode=web-download` branch, fix the duplicated `installerAsset` variable (lines 122 + 181), move hardcoded `GITHUB_OWNER`/`GITHUB_REPO` to env vars.
5. **Bulk update in `reprocess-trades`** — replace the N+1 per-trade UPDATE with a single CASE-WHEN UPDATE or a DB function. At 10k trades this is 10k round trips today.
6. **Consistency pass**: every function either uses shared `_shared/cors.ts` or its own inline copy. Pick one (shared) and migrate. Strip the ~70 leftover `console.log` debug calls in `ingest-events`, `copier-update-check`, `reprocess-trades`.

## Section 4 — Frontend cleanup

**God-files to split (highest-leverage):**
- `src/components/journal/settings/FieldsPanel.tsx` (1305 LOC) → `SystemFieldsPanel`, `CustomFieldsPanel`, `FieldEraseDialog`.
- `src/pages/Playbooks.tsx` (880 LOC) — extract lines ~440–880 into `PlaybookFormDialog.tsx`; replace its 30 `useState`s with `react-hook-form`.
- `src/hooks/useUserSettings.tsx` (562 LOC, 14 exports across 3 domains) → split into `useUserSettings` / `useSessionDefinitions` / `usePropertyOptions`.
- `src/components/journal/TradeTable.tsx` (935 LOC) → `TradeTableColumns` + `TradeTableToolbar` + body.

**Silent failures**: `useUserSettings.tsx` has 12 bare `console.error` calls in mutation `onError` handlers with no `toast()`. Same pattern in `useCustomFields`, `useFieldOverrides`, `useScreenshots`, `EditAccountDialog`. Users currently can't tell when a save fails. Add `toast.error()` to all of them.

**Realtime hygiene**: `useOpenTrades.tsx` runs both a `refetchInterval: 15000` AND a Supabase channel subscription, and the channel is created inside the hook body so every mount opens a new one. Pick one (remove the polling, hoist the channel to a provider).

**Type drift**: `src/lib/tradeTransform.ts` takes `any` as input. Type the parameter as `Tables<'trades'>['Row']` so a schema change breaks the build instead of leaking at runtime into the hand-maintained `Trade` interface in `src/types/trading.ts`.

**Small naming/organization** (cheap, helpful): move `getWeekPeriod` / `getMonthPeriod` / `getPreviousPeriod` out of `useReports.tsx` into `src/lib/reportPeriods.ts`; rename `useSenseiReports` → `useAIReports` so the two "reports" hooks stop colliding; consolidate the ~141 scattered `format(...)` call-sites into 4 named formatters in `src/lib/dateFormat.ts`.

## Section 5 — The structural redesign (reconciliation pipeline)

This is the one place where patch-fixing has been the dominant pattern. Today three edge functions can mutate the same trade row from different angles:

```text
EA ──▶ ingest-events ────────▶ trades (creates / live updates)
   ──▶ sync-account-state ──▶ trades (auto-close to zero PnL on reconnect)
User ▶ repair-snapshot-closed ▶ trades (fills real exit from events)
```

`sync-account-state`'s auto-close sets `exit_price = entry_price` (zero PnL) and does NOT write a `trade_repair_events` row, so `repair-snapshot-closed` is blind to those ghost trades. The EA also makes two HTTP calls to `sync-account-state` on startup, runs both `ReconcileClosedPositions` and `RunCatchupCycle` covering overlapping ground, and maintains a local 24h sync-flag file that fights with the server watermark.

**Proposed redesign — one writer, one repair sweep:**

1. **`ingest-events` is the only function that writes PnL.** No other function may set `exit_price` to anything other than `null`.
2. **`sync-account-state` becomes a tombstone-only repair.** When a stale `is_open=true` ticket isn't in the EA's `open_tickets`, mark `is_open=false`, `exit_price=null`, `awaiting_exit=true`, AND write `trade_repair_events(action: 'tombstoned_on_reconnect')`. No more zero-PnL ghost trades.
3. **`repair-snapshot-closed` becomes a generic sweep.** Single rule: any trade where `is_open=false` AND `exit_price IS NULL` AND no `repaired_*` event yet → look up the real exit in `events` across sibling installs and apply it. Covers both the snapshot-closed path AND the new tombstone path.
4. **EA: one `sync-account-state` call on startup**, not two. Use the response for both replay-from and open-tickets reconciliation.
5. **Delete EA functions made redundant**: `ReconcileClosedPositions` (superseded by `RunCatchupCycle`), `ShouldSyncHistory` + `MarkHistorySynced` + the `.flag` file (server watermark is authoritative), `ReadLastActiveTime` / `UpdateLastActiveTime` and the `InpReconcileIntervalTicks` input.
6. **Collapse the 4 `Inp*IntervalTicks` user inputs to a single `InpCheckIntervalSec`** and derive the rest at fixed ratios.
7. **DriftTray UI**: when no snapshot exists within the 10-min window, show "EA appears offline — drift data stale" instead of silently hiding.

**Why this is robust long-term**: every trade has exactly one writer of money fields, every repair is one query against one invariant, the EA carries no local reconciliation state that can fight the server, and a new contributor can read the whole flow on one page.

## Suggested rollout order

1. Section 1 + Section 2 (one migration, one cleanup PR — all safe).
2. Section 3 (security fixes first: `restore-trade-times`, `playbook-assistant`).
3. Section 4 god-file splits one at a time (`useUserSettings` first — 13 consumers cause the widest re-render cascade).
4. Section 5 redesign behind a feature flag on the EA side; ship server changes first (backward compatible), then a new EA version, then retire old EA paths after a release window.

This plan deletes ~2k LOC of dead/superseded code, closes two auth holes, removes the zero-PnL ghost-trade class of bug at its root, and leaves the trade pipeline understandable on one screen. I won't touch anything outside the above without checking back.
