# Robust Path — Completion Report

## Tranche 1 — `read_quality` persistence ✅ DONE
- Migration added `reports.read_quality JSONB DEFAULT '{}'`.
- `generate-report/index.ts` now persists the computed block.
- `Report` type gained `read_quality: ReadQualityBlock | null` + new `ReadQualityBlock` interface.
- `ReportView.tsx` renders a new "Read quality" card with match/partial/misread counts, win-rates per bucket, and top misread pairs.

## Tranche 2 — TradeComments wired ✅ DONE
- Added `comments` to `DetailSectionKey` + `DETAIL_SECTION_CATALOG` (default-visible).
- `TradeDetailPanel.tsx` imports and renders `<TradeComments tradeId={trade.id} />` inside the section switch — so users can show/hide/reorder it from the journal settings dialog like any other section.

## Tranche 3 — Schema suggestions UI ✅ ALREADY DONE
- `ReportView.tsx` already mounts `<SchemaSuggestionCard>` for each suggestion at lines 476-484. Audit was wrong about this being missing. No work needed.

## Tranche 4 — PositionsPanel / PositionSyncDialog ✅ ALREADY DONE
- `copier-desktop/src/App.tsx` already mounts both: `PositionsPanel` on the "positions" nav route, `PositionSyncDialog` as a header-button modal. Audit was wrong. No work needed.

## Tranche 5 — `partial_closes` recovery ✅ DONE
- Investigation: only **4 partial_close events** exist in the entire events log.
- Migration replays them into `trade_partial_fills` via JOIN on (account_id, ticket), idempotent (`NOT EXISTS` guard). Re-runnable safely.

## Tier 1 latent bugs folded in
- **trade-repair #1**: replaced inline `hasSnap && !repaired` with `hasSnapshotClosed()` + `!isAlreadyRepaired()` from `_shared/snapshotRepair.ts`. New REPAIRED_ACTIONS / dismiss types now flow through automatically.
- **trade-repair #2**: replaced hand-rolled R-multiple with `computeRMultiple()`. Repaired trades now use the same broker-agnostic logic as ingest-events / trade-rebuild (correct for indices, metals, crypto; supports weighted fills; equity-risk fallback).
- **copier #5**: `event_processor.rs` SafetyConfig comment now precisely documents which EA-only fields cannot be forwarded without a coordinated schema change. Conservative revert: did NOT add fields that don't exist on the runtime `ReceiverConfig` (would not compile). Threading them through requires R3.

## Audit corrections
The original audit overstated the dead-code surface in two places:
- `SchemaSuggestionCard` IS rendered.
- `PositionsPanel` + `PositionSyncDialog` ARE mounted.

## Not in this pass (genuine Redesigns, need their own sessions)
- A — Split `ingest-events`
- B — Frontend hook architecture refactor
- C — EA single-source-of-truth
- Tier 3 structural consolidations (account resolver, N+1 collapses, etc.)

---

## Tranche C — EA single-source-of-truth ✅ DONE
- New canonical directory `mql5/` holds the latest version of every EA:
  - `TradeJournalBridge.mq5`, `TradeCopierMaster.mq5`, `TradeCopierReceiver.mq5`
- New `scripts/sync-mql5.mjs` propagates canonical → all distribution targets:
  - `public/` (web download buttons), `mt5-bridge/` (docs reference), `copier-desktop/src-tauri/resources/` (Tauri bundle).
- Drift guard: script asserts EDGE_FUNCTION_URL, SYNC_STATE_URL and Supabase project ref are identical across every distributed copy. Fails non-zero on drift.
- Wired into npm lifecycle:
  - `predev` runs check, auto-syncs on first divergence.
  - `prebuild` always runs sync so Vite output and bundle ship matching files.
  - `mql5:sync` / `mql5:check` exposed for manual use.
- Initial sync resolved a real drift: previously the desktop installer shipped a newer Receiver (3038 lines) while web downloads served an older one (2125 lines) with a different `InpBrokerUTCOffset` default. All three copies are now byte-equal at the newest version.
- Single-file deployment preserved (no `.mqh` includes that would break end-user installs).

## Remaining
- Tranche D — Tier 3 structural consolidations.

## Tranche D — Tier 3 consolidations (Done)
- Created `supabase/functions/_shared/edgeAuth.ts` with `requireUser`, `requireOwnedAccount`, `json`, `AuthError`.
- Refactored `trade-repair` and `trade-rebuild` to use the shared auth + response helpers (eliminated 3 copies of the JWT bootstrap and 2 ad-hoc account-ownership checks).
- Both functions deployed successfully.
