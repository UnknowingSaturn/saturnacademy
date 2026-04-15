

# Codebase Review & Cleanup Plan

## Issues Found

### 1. Dead Code: Orphaned Components (2 files)
- **`src/components/strategy-lab/SimulatorPanel.tsx`** — The old metadata-only simulator. No longer imported anywhere. Contains a reference to the `simulate-alpha` edge function. Delete.
- **`src/components/strategy-lab/CodeLab.tsx`** — The old standalone code lab. Functionality merged into `BacktestDashboard.tsx`. No longer imported. Delete.

### 2. Redundant Edge Function
- **`supabase/functions/simulate-alpha/index.ts`** — Only called by the now-dead `SimulatorPanel`. The backtester flow uses `strategy-lab` exclusively. Delete the function and remove its entry from `supabase/config.toml`.

### 3. Duplicated SSE Streaming Logic in StrategyLab.tsx
- `src/pages/StrategyLab.tsx` lines 149-283 contain ~130 lines of manual SSE streaming code that is identical to `useStrategyLabChat.ts`. The hook was created specifically to deduplicate this. Refactor the Chat tab to use `useStrategyLabChat` instead, removing the duplicate `handleSend`, `handleAbort`, `abortControllerRef`, `isStreaming` state, and the inline SSE reader. The conversation persistence (save/load) stays but wraps the hook's callbacks.

### 4. Minor: `backtestMetrics` state in StrategyLab.tsx
- `backtestMetrics` state (line 39) was used by the old simulator flow. The Chat tab still passes `setBacktestMetrics` as `onBacktestMetrics` to `StrategyChat`, but it is never consumed after the simulator was removed. Clean up: remove `backtestMetrics` state and the `onBacktestMetrics` prop from the Chat tab's `StrategyChat` usage (the Backtester tab handles its own metrics independently).

### 5. No Database or RLS Issues
- All tables and RLS policies are correctly aligned. No orphaned tables from the changes. `simulation_runs`, `generated_strategies`, `backtest_results` are all still valid and used.

### 6. No Console Errors
- Console logs show only a benign `RESET_BLANK_CHECK` warning (Lovable internal). No application errors.

---

## Changes

| File | Action |
|------|--------|
| `src/components/strategy-lab/SimulatorPanel.tsx` | **DELETE** |
| `src/components/strategy-lab/CodeLab.tsx` | **DELETE** |
| `supabase/functions/simulate-alpha/index.ts` | **DELETE** |
| `supabase/config.toml` | Remove `[functions.simulate-alpha]` block |
| `src/pages/StrategyLab.tsx` | Refactor Chat tab to use `useStrategyLabChat` hook; remove ~130 lines of duplicate SSE code; remove unused `backtestMetrics` state |

No database migrations needed. No breaking changes to any active feature.

