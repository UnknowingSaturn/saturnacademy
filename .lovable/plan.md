# Trim production: remove one-off repair tooling

Now that all account histories are reconciled and the EA routes new events by `broker_login`/`account_info.login`, several pieces of repair scaffolding are no longer pulling their weight. Below is what to keep, what to remove, and what to fold away behind a less prominent surface.

## Keep (still useful in steady state)

- **`sync-account-state`, `ingest-events`, `copier-*`, `generate-report`, `get-shared-report`, `schedule-reports`, `extract-knowledge`, `knowledge-chat`, `playbook-assistant`, `scalp-edge-analysis`** — core product.
- **`AccountCard` resync banner + `useStopResync`** — small, harmless, only renders when `force_resync = true` (currently 0 accounts). Useful if we ever need to re-trigger a backfill.
- **`DriftTray` + `repair-snapshot-closed`** — still catches genuine future drift when a broker silently closes a position and the EA misses the deal. This is an ongoing failure mode, not a legacy one.
- **Archive All Trades (Danger Zone)** — generic, not legacy-specific.

## Remove (one-off, legacy-only)

1. **Edge function `repair-legacy-trade-ownership`** — only purpose was to fix trades misrouted before the EA started using `broker_login`. New events can't reach that state. Delete the function and its UI.
2. **`Accounts.tsx` "Repair legacy trade ownership" card** (lines ~277–363) plus all related state (`legacyRepairAccountId`, `legacyRepairPreview`, `isPreviewingLegacyRepair`, `isApplyingLegacyRepair`, `invokeLegacyOwnershipRepair`, `handlePreviewLegacyOwnershipRepair`, `handleApplyLegacyOwnershipRepair`, the `LegacyOwnershipSummary`/`LegacyOwnershipPreview` types).
3. **Edge function `fresh-start`** — destructive whole-account wipe used while we were untangling ownership. Archive All covers the safe path; keeping `fresh-start` around is a footgun. Verify no UI still calls it (`EditAccountDialog.tsx` is the only caller — remove that action too if it exists), then delete.
4. **EA force-resync hot loop (v4.02 changes)** — keep the `force_resync` flag read on startup, but drop the "poll every 30s while resync is active" behavior in `public/TradeJournalBridge.mq5` and `mt5-bridge/TradeJournalBridge.mq5`. Return to the normal polling cadence. No account currently has `force_resync = true`, so this only matters next time we flip it; the aggressive cadence was a backfill convenience, not a permanent need.
5. **`replay_from` references in the EA** — the DB column no longer exists. Remove any leftover reads so the EA doesn't log "column missing" warnings.

## Demote (keep behind an admin-only surface, off the main Accounts page)

6. **`repair-snapshot-closed` "Repair stuck break-even trades" button** — keep the function (drift recovery), but move the button out of the main Accounts page and into the existing `DriftTray`, which already shows the affected trades. The standalone account-picker version was added when we didn't trust drift detection; we do now.
7. **`reprocess-trades`, `restore-trade-times`, `reclassify-sessions`, `trades-drift`** — verify each is still wired into a real user flow (Session Config panel, TradeTable, DriftTray). If any are only reachable from a removed maintenance UI, delete them too. (Quick audit pass during implementation.)

## Result

- Accounts page loses ~130 lines of legacy repair UI and one entire maintenance card.
- Two edge functions deleted (`repair-legacy-trade-ownership`, `fresh-start`), one demoted.
- EA returns to a single steady-state polling cadence.
- DriftTray becomes the single home for "something looks off, fix it" actions.

## Technical notes

- DB: nothing to migrate. `force_resync` column stays; `replay_from` is already gone.
- Edge function deletion uses `supabase--delete_edge_functions`.
- Frontend: trim `src/pages/Accounts.tsx`, remove unused imports (`Wrench`, `Archive` if no longer used, `AlertDialog*` if no longer used), remove unused state.
- EA: revert the 30s force-resync polling block in both `public/` and `mt5-bridge/` copies; keep the broker_login routing (that's the permanent fix).
- Memory: update `mem://copier/reconciliation-logic` if it referenced the legacy ownership repair flow.

After approval I'll do a quick audit of the 4 functions listed in step 7 before deleting, so we don't drop something still wired into a user flow.
