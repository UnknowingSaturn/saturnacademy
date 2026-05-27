## Fix

`MT5SetupDialog`'s "Download EA File" button uses `window.open('/TradeJournalBridge.mq5', '_blank')`, which the browser renders as plain text instead of downloading. Replace with a programmatic `<a download>` click (same pattern already used in `QuickConnectDialog.tsx` lines 122–127) so the file saves to disk.

## File

**`src/components/accounts/MT5SetupDialog.tsx`** (line 56) — swap the `onClick` to create a temporary anchor with `href='/TradeJournalBridge.mq5'` and `download='TradeJournalBridge.mq5'`, click it, then remove.

## Out of scope

No other download buttons, no server/MIME changes, no copy-path changes.
