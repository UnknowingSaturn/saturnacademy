# Journal report for an LLM (executed trades)

## What you get
1. **A file now**: one Markdown report of every executed trade (archived ones left out), saved to your Files.
2. **An "Export for AI" button** on the Journal page. It builds the same report from whatever filters you have set (dates, account, symbol) and downloads it as a `.md` file.

## Report structure
```text
# Header        what the file is, date range, trade count, units (R, points/pips, UTC)
# Playbooks     each playbook: regimes, entry zone, confirmation, invalidation,
                management rules, failure modes, risk limits, checklist questions
# Summary       win rate, expectancy, average R, broken down by playbook, symbol,
                session and direction (worked out the same way as the Coach)
# Trades        one section per trade (multi-TP legs merged into one trade):
                - symbol, direction, session, entry/exit time, lots
                - entry, SL (first and last), TP (first and last), exit, P&L, planned/actual R
                - MAE/MFE, ideal SL, ideal SL position, ideal entry window, other custom fields
                - planned vs actual playbook/model, regime, alignment, timeframes
                - checklist answers and score, emotions before/after
                - notes: thoughts, mistakes, did well, to improve, action steps, comments
                - screenshot labels and descriptions (text only, no images)
# Data dictionary   what every field means, so the LLM reads it correctly
```

## Technical details
- New `src/lib/export/journalReport.ts`: a pure function that takes trades, reviews, playbooks and field definitions and returns Markdown. Field labels come from the existing fields registry, and legs are merged by `group_key`.
- Button in the Journal toolbar. It fetches all matching executed trades in pages, generates the file in the browser and downloads it.
- One-off file: run the same generator in the sandbox against the database and save it to `/mnt/documents/journal-report-<date>.md`.
- Tests: legs merge into one trade, ideas/paper/missed and archived trades are excluded, and custom field keys show as their labels.
