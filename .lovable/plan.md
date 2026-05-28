# Comprehensive Audit — Findings & Remediation Plan

Four parallel deep audits across **ingest-events**, **frontend**, **backend/DB**, and **desktop copier + EAs**. Findings are tiered: **latent bugs** (fix soon, real correctness risk), **dead/half-built code** (delete or finish), **structural overlap** (consolidate), and **three long-term redesigns** worth doing properly.

---

## Tier 1 — Latent bugs (real correctness risk)

| # | Location | Issue | Fix |
|---|---|---|---|
| 1 | `supabase/functions/trade-repair/index.ts:111-117` | Re-implements `isPendingRepair` inline with a **hardcoded subset** of `REPAIRED_ACTIONS` — missing `stale_dismiss` and `duplicate_dismiss`. When new action types are added to `_shared/snapshotRepair.ts`, `list-drift` silently excludes them. | Replace inline check with `isPendingRepair()` import |
| 2 | `supabase/functions/trade-repair/index.ts:223-234` | Hand-rolled R-multiple calc missing the weighted-fill path, pip-value fallback, and equity-risk path that `_shared/rMultiple.ts:computeRMultiple()` provides. Repaired trades get incorrect R values. | Replace with `computeRMultiple()` call (same pattern as ingest-events & trade-rebuild) |
| 3 | `supabase/functions/generate-report/index.ts:1272-1312 → 1393 → 1420-1440` | `read_quality` block (planned-vs-actual playbook grading, ~40 lines of computation) is sent to the LLM but **never persisted** — no column exists on `reports`. User can never query it. | Add `read_quality JSONB` to `reports` and include in insert, OR delete the computation |
| 4 | Migration pair `20260527194251` → `20260527194623` | The second migration runs `DELETE FROM trade_partial_fills` immediately after the first backfilled it from legacy `partial_closes` JSONB. The `partial_closes` column was then dropped in `20260527204815`. **Historical partial-fill data is permanently gone.** | Audit whether any recovery is possible from event log; otherwise document the data loss |
| 5 | `copier-desktop/src-tauri/src/copier/event_processor.rs:91-98` | Bridges `config_generator::SafetyConfig` → `safety::SafetyConfig` but only forwards 2 of ~10 fields. `max_daily_loss_r` from user config is **silently dropped** and the 3% default always applies. `manual_confirm_mode` has no runtime counterpart. | Either unify the two structs, or document `config_generator::SafetyConfig` as EA-wire-format only and read the runtime fields from the right source |

---

## Tier 2 — Dead code (delete)

**Frontend components (never imported):**
- `src/components/journal/TradeComments.tsx` (~120 lines) — fully wired against the real `trade_comments` DB table, never mounted. Either surface it in `TradeDetailPanel` or delete it and the `trade_comments` table.
- `src/components/journal/ScreenshotUpload.tsx` (~80 lines) — superseded by `AddScreenshotDialog`.
- `src/components/journal/settings/ColumnConfigPanel.tsx` (**687 lines**) — duplicates `JournalSettingsDialog`. Largest single deletable file in the repo.
- `src/components/dashboard/MetricCard.tsx`, `src/components/playbooks/PlaybookStatsCard.tsx`.
- 13 unused shadcn UI primitives in `src/components/ui/`: `aspect-ratio`, `breadcrumb`, `carousel`, `command`, `context-menu`, `drawer`, `hover-card`, `input-otp`, `menubar`, `navigation-menu`, `pagination`, `radio-group`, `resizable`.

**Frontend hooks/types:**
- `useInitializeDefaults` in `useUserSettings.tsx:642` — 67-line mutation, zero callers (init is already handled inside `useSessionDefinitions`).
- `AIPrompt` type in `src/types/trading.ts` + `ai_reviews` join in `useTrades`/`useOpenTrades` select strings — eagerly fetched on every trade-list load, never read by any component.
- `TradeComment` type in `trading.ts:263` (orphan).

**Desktop Tauri commands (zero frontend call sites or only reachable from dead components):**
- `auto_map_symbols`, `get_discovery_debug` — true dead.
- `get_position_sync_status`, `get_master_heartbeat`, `check_master_online` — only called by `PositionSyncDialog` / `PositionsPanel`, **neither component is mounted in `App.tsx`**.
- `EmergencyCommandType::ModifyAllSL` / `ModifyAllTP` enum variants — no wrapper command, no UI trigger.

**Rust duplicates in `mt5/bridge.rs`:**
- `bridge.rs:18-295` — `detect_terminal` (marked `#[allow(dead_code)]`), `extract_broker_from_folder_name`, `read_broker_from_srv_files`, `expand_broker_abbreviation`, `read_broker_from_ini`, `detect_broker_from_community_folder`, `detect_portable_terminal` — all duplicates of logic now living in `discovery.rs`.
- `bridge.rs:449 ensure_copier_folders` — duplicate of `config_generator.rs:169`.
- `bridge.rs:418 get_master_heartbeat` — duplicate of `commands.rs:165 read_master_heartbeat`.

**Backend dead-weight:**
- `prop_firm_rules` table — no edge function reads it, no frontend hook queries it. Stranded after the R11 prop-firm normalization.
- `schema_suggestions` field on `reports` — written every report, never read by any UI component.
- `ingest-events:27` — `ea_type` payload field accepted then discarded (R11 cleanup leftover).
- `ingest-events` — 3× duplicate `// (active-login tracking …)` stub comments (lines 395, 440, 575) and one R10 tombstone (611–612). Plus 3× `// Phase D dual-write:` comments labelling a migration that has shipped.
- `copier-update-check:119-121` — dead `installerAsset` assignment inside the `web-download` branch (only `windowsInstaller` is returned).

---

## Tier 3 — Structural overlap (consolidate)

### Backend
- **Account-resolution cascade duplicated** between `ingest-events:112-157` and `sync-account-state:56-141` — ~80 lines of near-identical "by login → by install sibling → by api-key" logic. Extract `_shared/accountResolver.ts`.
- **N+1 in repair detection**: `ingest-events:602-609 isSnapshotClosed()` fires a separate `trade_repair_events` query per trade, called twice per event, and once per candidate in the sibling-repair loop. Join `trade_repair_events(action)` into the `existingTrade` select.
- **Double `accounts.update()` on heartbeats** (`ingest-events:291-299` then `332-393`) — first write is immediately overwritten by the second.
- **`generate-report`**: `worstTradeNarratives` + `symbolExpectancy` computed twice (lines 1316-1376 and again in `buildLlmContext()` 922-978). Extract once.

### Frontend
- **Two toast libraries**: `useTrades` (and friends) uses shadcn `useToast`; `useUserSettings`, `useCustomFields`, `useCopier`, `useSharedReports`, `useSenseiReports`, `useKnowledge`, and most components use sonner directly. Pick one — both `<Toaster>` and `<Sonner>` are mounted simultaneously.
- **`useTradeCompliance`** issues its own full `useTrades` query per detail-panel open just to derive sibling trades — pass the cached list in as a prop or share the query key.
- **`useTrades` vs `useOpenTrades`** fetch the same full trade graph under different query keys — never deduplicated by React Query.
- **`useUserSettings.tsx`** (788 lines, 17 exports) is a hook barrel mixing column prefs, session CRUD, property options, defaults init, and live-trade questions. Split into 4 focused files.
- **`Playbooks.tsx`** (886 lines, **30 useState calls**) — 3 form-population paths (`openEditDialog`, `handleDuplicatePlaybook`, `handleSelectTemplate`) duplicate ~25 lines each. Extract `populateFormFromPlaybook(playbook, opts)`.

### Desktop (Rust)
- **5 independent copies of APPDATA + portable terminal path resolution**: `bridge.rs:349`, `position_sync.rs:364`, `symbol_catalog.rs:436`, `file_watcher.rs:164`, `commands.rs:62`. Extract a single `mt5::paths::resolve_terminal_files_path()`.

---

## Tier 4 — Half-built features (decide: finish or delete)

1. **`TradeComments` system** — DB table, RLS, full UI component, mutations — but the entrypoint was never wired into `TradeDetailPanel`. Either expose it as a Comments tab or delete the column and the DB table.
2. **`PositionSyncDialog` + `PositionsPanel`** — fully built, fully wired to Tauri commands, **never mounted in `App.tsx`**. Either re-introduce them on the dashboard or delete them and the 3 backing Tauri commands.
3. **`manual_confirm_mode`** — flows from desktop config → JSON → EA, but there is no Rust runtime guard for it and the EA branch consumes it independently. Either implement the desktop-side gate or remove from `config_generator::SafetyConfig`.
4. **`schema_suggestions`** — generated and stored on every report run. Either build the "suggest new journal fields" UI or stop generating them.
5. **Symbol catalog re-mapping** — `SymbolMappingStepV2` is only reachable from the wizard. Once setup is done, the user has no way to re-map symbols when a broker adds/renames instruments. Either expose a "Re-map symbols" action on the receiver card or document the limitation.

---

## Tier 5 — Three long-term redesigns (do these properly, in their own sessions)

### Redesign A — Split `ingest-events` (the deferred R3, now with a path)

`ingest-events/index.ts` is **1073 lines, 9 distinct responsibilities** (auth, account resolution, account auto-create, balance snapshot, heartbeat + DST detection, position snapshot, history-sync gating, dedup, `processEvent`). The R3 plan tried to do this as one big sync→async cutover, which was too risky.

**Proposed staged plan** (each step independently shippable, no EA contract change until the last):

1. Extract `_shared/accountResolver.ts` (covers `ingest-events` + `sync-account-state`).
2. Extract `_shared/heartbeat.ts` (the DST auto-detect block + the equity/last-heartbeat bump). Move the 200-event historical scan into a `pg_cron` job — it doesn't need to run on every heartbeat.
3. Extract `_shared/eventDedup.ts` and `_shared/processEvent.ts`. `processEvent` becomes pure: takes a normalised payload + account context, returns the trade-state diff.
4. **Only after** the above shrinks the handler to ~250 lines, optionally add a `pg_notify` async fan-out for repair work. EA contract is unchanged because step 3 already isolated the repair path.

### Redesign B — Frontend hook architecture

Replace the four overlapping trade-fetch hooks (`useTrades`, `useOpenTrades`, `useDashboardMetrics`, `useTradeCompliance`) with a **single `useTradesQuery(filters)`** hook that owns the canonical query key and selector. Specialised hooks become thin `useMemo` selectors over the cache — so:
- `useOpenTrades()` → `useTradesQuery({ isOpen: true })` + realtime subscription on the same key.
- `useTradeCompliance(trade)` → pure derivation from the already-cached list, zero new fetches.
- Drop the `ai_reviews` join from the canonical select; add it back as an opt-in `useTradeAIReviews(tradeId)` when (and if) AI reviews surface in the UI.

Split `useUserSettings.tsx` into `useColumnSettings`, `useSessionSettings`, `usePropertyOptions`, `useLiveTradeQuestions`. Pick **one** toast library (sonner is the most-used; remove the shadcn Toaster mount).

### Redesign C — EA source-of-truth

There are **3 divergent copies** of every EA:

| File | Master | Receiver | Notes |
|---|---|---|---|
| `copier-desktop/src-tauri/resources/` | 1113 | 3038 | **Canonical** — what the installer deploys |
| `mt5-bridge/` | 888 | 2400 | Dev reference; ~225-line and ~638-line drift |
| `public/` | 888 | 2125 | Web download; **still has hardcoded `magic = 12345`** at 4 sites |

Make `resources/` the single source of truth and generate the other two via a Vite `publicDir` copy step (for `public/`) and a build script (for `mt5-bridge/`). Until then, the `public/` receiver is shipping a known-broken hardcoded magic number to anyone who uses the manual install path.

---

## Technical details

- All Tier 1 fixes are single-file edits except #4 (data loss — needs a separate investigation of whether `events` can replay the lost rows).
- Tier 2 deletions are mechanical but touch ~30 files in total; safe to ship in 2-3 grouped commits (frontend components, ui primitives, Rust dead code, backend dead-weight).
- Tier 3 consolidations should be done before Redesign A so the `_shared/` boundary is well-rehearsed first.
- Redesigns A and C both touch the EA contract surface — neither should ship without at least a smoke test against a live receiver. Redesign B is pure frontend and can ship anytime.

## Open questions before implementation

1. **TradeComments**: finish or delete?
2. **schema_suggestions**: build the UI or stop generating?
3. **PositionSyncDialog / PositionsPanel**: re-introduce on the dashboard or delete?
4. **`read_quality`**: add the column or drop the computation?
5. **`partial_closes` data loss** — is there any business impact, or were those rows already known to be wrong?

Answer these and I'll sequence the actual implementation tranches.
