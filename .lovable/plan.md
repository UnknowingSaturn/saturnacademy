
# Most-Robust Path — Finish Everything

For each open question, the robust answer is **finish/preserve**, not delete. This shapes 5 implementation tranches, sequenced to minimize blast radius. Tier 1 latent bugs and Tier 2/3 consolidations from the audit are folded in where they touch the same files.

---

## Tranche 1 — `read_quality` persistence (Tier 1 bug #3)

**Decision:** Add column. The computation already runs every report; throwing it away is the waste.

1. Migration: `ALTER TABLE public.reports ADD COLUMN read_quality JSONB NOT NULL DEFAULT '{}'::jsonb`.
2. `generate-report/index.ts`: include `read_quality` in the insert payload (line ~1420).
3. `src/types/reports.ts`: add to `Report` type.
4. `ReportView.tsx`: render a small "Read quality" card (planned-vs-actual playbook grade) next to the existing metrics grid.

**Risk:** zero. Additive only.

---

## Tranche 2 — Wire `TradeComments` into `TradeDetailPanel`

**Decision:** Finish. Table, RLS, mutations, and UI all exist; only the mount is missing.

1. Add a **Comments** tab to `TradeDetailPanel` alongside Review / AI / Compliance.
2. Mount `<TradeComments tradeId={trade.id} />`.
3. Delete the orphan `TradeComment` type re-declaration once the component's own type is the source of truth.
4. Leave the `trade_comments` table untouched — no migration.

**Risk:** zero. New tab, isolated component.

---

## Tranche 3 — Surface `schema_suggestions` in the report UI

**Decision:** Build the UI. `SchemaSuggestionCard` already exists and inserts directly into `custom_field_definitions`.

1. In `ReportView.tsx`, render a "Suggested journal fields" section when `report.schema_suggestions?.length > 0`.
2. Map over suggestions → `<SchemaSuggestionCard suggestion={s} />`.
3. Place it after the Sensei notes block, before the trade highlights.

**Risk:** zero. Read-only render of data already being generated.

---

## Tranche 4 — Re-mount `PositionsPanel` + `PositionSyncDialog` in the desktop copier

**Decision:** Re-introduce. Tauri commands and components are production-ready; the dashboard just lost its mount during a prior refactor.

1. `copier-desktop/src/components/Dashboard.tsx`: add a **Positions** section that renders `<PositionsPanel />` per active receiver.
2. Wire the "Sync positions" button on each receiver row to open `<PositionSyncDialog />`.
3. Verify the 3 Tauri commands (`get_position_sync_status`, `get_master_heartbeat`, `check_master_online`) still compile against current Rust signatures.

**Risk:** low. Desktop-only; user can ignore the panel if they don't want it.

---

## Tranche 5 — `partial_closes` data-loss investigation + recovery

**Decision:** Recover what we can from `events`, document the rest.

1. `read_query` on `events` filtered to `event_type = 'partial_close'` (or equivalent) within the affected window — count rows per user.
2. If recoverable: write a one-shot migration that replays them into `trade_partial_fills` via a `INSERT … SELECT` joining `events` → `trades` on `(account_id, ticket)`.
3. If unrecoverable: add a `CHANGELOG` note inside the relevant migration directory and surface a one-time toast on the affected users' next dashboard load. No silent data loss.

**Risk:** medium — needs the read_query first to know which path applies. Will report findings before mutating data.

---

## Folded-in Tier 1 fixes (free with the above tranches)

Done alongside Tranche 1 since they touch the same edge-function shared helpers:

- **trade-repair bug #1** — replace inline `isPendingRepair` with the shared import.
- **trade-repair bug #2** — replace hand-rolled R-multiple with `computeRMultiple()`.
- **copier event_processor bug #5** — forward all `SafetyConfig` fields (or split the structs with a clear comment).

---

## Sequencing & shipping

| # | Tranche | Files | Migration? | Ship |
|---|---|---|---|---|
| 1 | `read_quality` + Tier 1 fixes | 4 + 3 | yes (additive) | first |
| 2 | Comments tab | 2 | no | second |
| 3 | Schema suggestions UI | 1 | no | second |
| 4 | Positions panel re-mount | 2 | no | third (desktop only) |
| 5 | partial_closes recovery | tbd after read_query | maybe | last, after investigation |

Tranches 1–3 are pure additions and ship together safely. Tranche 4 is desktop-only. Tranche 5 needs an investigation step first — I'll run the `read_query` and report numbers before writing any recovery migration.

## Technical details

- All migrations use `JSONB DEFAULT '{}'::jsonb` so existing reports backfill cleanly without a separate UPDATE.
- The Tier 1 trade-repair fixes preserve current behavior for already-repaired trades because `computeRMultiple()` returns the same value when given the same inputs the hand-rolled path computed correctly; only edge cases (weighted fills, pip-value fallback) change.
- Tier 3 structural consolidations (account resolver extraction, N+1 collapse, double-update fix, hook dedup, useUserSettings split, EA single-source-of-truth) are **not** in this plan — they're prerequisites for Redesigns A/B/C and belong in their own sessions. Including them here would balloon scope past what's safely reviewable in one pass.
