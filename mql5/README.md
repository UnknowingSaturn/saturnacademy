# MQL5 EA — Single Source of Truth

This directory is the **canonical source** for every MetaTrader 5 Expert Advisor
shipped by the project:

| EA                          | Purpose                                                |
| --------------------------- | ------------------------------------------------------ |
| `TradeJournalBridge.mq5`    | Cloud journal upload (read-only)                       |
| `TradeCopierMaster.mq5`     | Master account — captures trades, writes local queue   |
| `TradeCopierReceiver.mq5`   | Receiver account — consumes queue, executes copies     |

## Distribution targets

These files are **propagated** by `scripts/sync-mql5.mjs` to every location that
serves or bundles them. Never edit the copies directly — edit the file here and
run the sync script.

| Target                                          | Purpose                                       |
| ----------------------------------------------- | --------------------------------------------- |
| `public/`                                       | Web app download buttons (`/Trade*.mq5`)      |
| `copier-desktop/src-tauri/resources/`           | Bundled into the desktop installer            |
| `mt5-bridge/`                                   | Reference / documentation copy                |

## Commands

```bash
bun run mql5:sync     # copy mql5/* → all distribution targets
bun run mql5:check    # verify all copies are byte-identical + shared constants match
```

`mql5:sync` runs automatically before `dev` and `build` so the web download and
the Tauri bundle can never diverge.

## Shared constants (drift-protected)

The sync script asserts that every distributed copy contains the same value for:

- `EDGE_FUNCTION_URL`  (ingest-events endpoint)
- `SYNC_STATE_URL`     (sync-account-state endpoint, where present)
- Supabase project ref host (`soosdjmnpcyuqppdjsse.supabase.co`)

If any copy drifts, `mql5:check` fails and the build aborts.
