# Cleanup plan — remove temporary backfill scaffolding

Once all 4 affected accounts (70561, 70583, 76034, 76036, 86021) confirm a successful resync, strip the one-off UI and keep only the changes that are permanent correctness fixes.

## Keep (permanent)

These are not "backfill scaffolding" — they fix latent bugs that affect normal operation:

- `EquityCurve.tsx` — `reconstructed` baseline (`equity_current − period_pnl`) and the new fallback cascade.
- `Dashboard.tsx` — `periodPnlByAccount` derivation and corrected `accountStartingBalance` sum.
- `AccountCard.tsx`, `MultiAccountPicker.tsx` — `balance_start || equity_current` display fallbacks.
- `sync-account-state/index.ts` — selecting `sync_history_from` and returning `replay_from`. Harmless on old EAs (they ignore unknown fields); essential for v4.01+ catchup-floor behaviour on any future fresh connect, terminal reinstall, or `sync_history_from` change.
- `TradeJournalBridge.mq5` v4.01 — `replay_from` parsing and the `fromTime` cascade. This is the correct catchup behaviour going forward.

## Remove (one-off)

- `EditAccountDialog.tsx` — delete the "Resync history from MT5" section (button + optional date override + toast). Remove any related local state and the `force_resync`/`sync_history_from` write path from the dialog's submit handler.

## Leave intact in the DB / edge layer

- `accounts.force_resync` column stays — `sync-account-state` still reads it as part of the dormant-reconnect repair path (`shouldResync = wasDormant || account.force_resync || force`). With the UI gone, nothing in the app will set it to `true` anymore, but the column and code stay so future debugging can flip it manually via SQL.
- `accounts.sync_history_from` stays — used by `replay_from`.

## Order of operations

1. Confirm 70561 catchup completes (flag flips to `false`, expected history events ingested).
2. Trigger resyncs for the dormant accounts by reconnecting them in MT5 (no UI button needed — `wasDormant` path handles it).
3. Once data looks right on the dashboard for all 5 accounts, ship the `EditAccountDialog.tsx` removal.

## Files touched in cleanup PR

- `src/components/accounts/EditAccountDialog.tsx` — only file changed.

No DB migration, no edge function changes, no EA changes.
