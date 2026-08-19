# Remove the MT5 history limit and make imports resumable

## Goal
Allow multi-year M1 history to be collected without silently stopping at MT5's chart limit, while preserving previously imported bars when history is uploaded in multiple files.

## Confirmed current state
- The screenshot shows `99,904 bars, limited by charts settings`; MT5—not the Backtest Lab—truncated this export at the terminal's chart-history setting.
- The Backtest Lab parser accepts multi-year M1 CSV/TSV files, processes them off the UI thread, splits them by month, and reports gaps.
- The app currently explains where to export bars but does not explain MT5's **Max bars in chart** requirement or detect this specific truncation clearly.
- Importing another partial file that overlaps an existing broker month currently replaces that whole stored month. That makes incremental/backfill imports unsafe unless every overlapping month is complete.
- No purpose-built MQL5 history exporter exists in the project today.

## User-facing workflow
1. In MT5, set **Tools → Options → Charts → Max bars in chart** to `Unlimited` (or a sufficiently high value), restart MT5, and let the M1 history load.
2. Use a downloadable Backtest Lab exporter script to request an explicit symbol and date range in monthly chunks.
3. Upload one or several output files. The Data step will merge them, show the actual first/last bar against the requested range, and identify incomplete months before a backtest can use them.

## Implementation

### 1. Add a purpose-built MT5 exporter
- Add a downloadable `.mq5` script for Backtest Lab history export.
- Inputs: symbol, start date, end date, output filename, and optional broker suffix handling.
- Retrieve M1 bars in bounded monthly requests, write standard MT5 OHLC/tick-volume/spread columns, and include metadata for requested/actual range and incomplete retrieval.
- Fail visibly when terminal/server history is unavailable instead of producing an apparently complete file.
- Keep broker-server timestamps unchanged; the existing import preview remains responsible for confirming the UTC offset.

### 2. Make partial uploads lossless
- Change broker-month ingestion to read any existing month, decode it, merge incoming bars by timestamp with deterministic last-write-wins behavior, re-sort, re-run quality checks, then store the combined month.
- Keep this merge authoritative in the backend so separate files, retries, and overlapping ranges behave consistently.
- Return inserted/replaced/total bar counts so the UI can explain what happened.

### 3. Detect and explain truncation in the importer
- Add a compact “Export full MT5 history” guide beside the upload control, including the exact Max-bars setting and restart/history-load requirement.
- Parse exporter metadata when present and compare requested versus actual coverage.
- For ordinary MT5 exports, flag suspicious hard-cap patterns and abrupt first/last coverage boundaries as a warning, without claiming certainty from bar count alone.
- Show first bar, last bar, requested range, incomplete edge months, and whether the import will extend or update existing coverage.

### 4. Coverage safeguards
- Treat weekends and known market closures separately from true missing weekdays so quality warnings are not inflated.
- Prevent a run range from appearing fully covered when its first or last requested month is only partial.
- Preserve broker data priority over vendor fallback; use fallback only for genuinely absent periods.

## Verification
- Parser tests for standard MT5 exports and exporter metadata.
- Import tests for multiple years, overlapping partial months, duplicate timestamps, retries, and out-of-order files.
- Regression test proving a second partial upload cannot delete bars already stored in that month.
- Exporter fixture covering DST changes and broker UTC-offset preview.
- End-to-end check: export/import a range longer than 100,000 M1 bars, verify its first/last timestamps and monthly coverage, then load that exact range into a backtest.

## Immediate workaround
Until this is built: set MT5 **Max bars in chart** to `Unlimited`, restart MT5, reopen/load the EURUSD M1 chart, then export again. Do not upload several overlapping partial-month files yet, because the current importer replaces the stored version of an overlapping month.