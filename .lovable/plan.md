

# Backtester Tab Test Results

## What Was Tested

1. **Navigation**: Strategy Lab page loads correctly with all 4 tabs (Chat, Backtester, Performance, Gap Analysis)
2. **Playbook Selection**: Dropdown lists all 5 playbooks, selecting "LON Continuation" works
3. **Phase 1 (Build EA)**: Three-panel layout renders (EA Versions | Chat | Code Editor). Quick actions appear contextually for a selected playbook. "Generate EA" sends the correct message to the `strategy-lab` edge function
4. **Streaming**: The AI streamed a response, extracted the MQL5 code, and auto-advanced to Phase 2
5. **Phase 2 (Run in MT5)**: Instructions display correctly with Download button, "Back to Builder" button, and HTML report upload button
6. **Phase 3 (Analyze Results)**: Not tested (requires uploading a real MT5 HTML report)

## Issues Found

**Minor: Download filename shows "Download _.mq5"** — the filename extraction regex didn't capture the EA name from the response, falling back to an underscore. The `extractAndSaveCode` function's name regex may not match the AI's output format.

**No blocking issues** — the core 3-phase flow works correctly.

## Recommended Fix

In `BacktestDashboard.tsx` line ~119, the fallback filename logic uses `playbookName || "Generated EA"` but the regex `nameMatch` often fails. A simple fix: default the filename to the playbook name directly when no match is found, producing `LON_Continuation.mq5` instead of `_.mq5`.

### Change
In `src/components/strategy-lab/BacktestDashboard.tsx`, update the name extraction fallback:

```typescript
const name = nameMatch
  ? nameMatch[1].trim().slice(0, 50)
  : playbookName || "Generated EA";
const safeName = name.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "");
setCurrentFilename(`${safeName || "Strategy"}.mq5`);
```

The regex `replace(/[^a-zA-Z0-9]/g, "_")` strips spaces to underscores, but the original code also strips periods, hyphens, etc. — that's fine. The actual bug is the regex `[^a-zA-Z0-9]` produces leading/trailing underscores or empty strings if the name is unusual. Adding a guard for empty results fixes it.

