

# Comprehensive Codebase Audit: Strategy Lab & Related Features

## Findings Summary

### 1. Critical Issues

**Missing Edge Function Config**
- `simulate-alpha` is NOT listed in `supabase/config.toml`. It needs `verify_jwt = false` to match the other functions. Without this, the function may reject requests from the frontend since it handles JWT validation in code.

**Hardcoded `hasTradeData = false` in StrategyLab.tsx (line 288)**
- The chat tab always shows "no trade data" quick actions because `hasTradeData` is hardcoded to `false`. It should query the trades table to determine if the user has trade data for the selected playbook. This means contextual quick actions never switch to the "has trade data" variant.

### 2. Unused Imports (Code Cleanup)

| File | Unused Imports |
|------|---------------|
| `src/components/strategy-lab/PerformancePanel.tsx` | `TrendingUp, TrendingDown, Target, BarChart3, Clock, Layers` from lucide-react (none used in JSX) |
| `src/components/strategy-lab/BacktestDashboard.tsx` | `ResizablePanelGroup, ResizablePanel, ResizableHandle` from resizable (never used); `Button` is also unused |
| `src/components/strategy-lab/GapAnalysis.tsx` | `useEffect` is used, but `useCallback, useRef` are used. All look used. `usePlaybooks` imported but the `playbooks` var is used. No issues here. |
| `src/components/strategy-lab/CodeEditor.tsx` | `onCodeChange` prop defined but never wired — dead prop |

### 3. Database & Security

- **Supabase linter**: No issues found. All tables have RLS enabled with appropriate policies.
- **All new tables** (`generated_strategies`, `backtest_results`, `simulation_runs`) have correct user-scoped RLS policies for all CRUD operations.
- **No orphaned tables** — all tables are actively referenced by the frontend or edge functions.

### 4. Edge Function Issues

- **`simulate-alpha`**: Missing from `config.toml` (needs `verify_jwt = false` entry).
- **All other edge functions**: Properly configured in `config.toml`.
- **CORS headers**: Both `strategy-lab` and `simulate-alpha` have correct CORS headers matching the SDK requirements.
- **Auth validation**: Both functions validate JWT in code via `supabase.auth.getUser()`.

### 5. Functional Issues

- **Stream re-emission in strategy-lab**: When there are no tool calls, the edge function reads the ENTIRE stream into memory, then re-emits it in 20-char chunks (lines 878-891). This adds latency and breaks the streaming UX. The original stream should be piped through directly.
- **Code Lab version naming**: `extractCode` regex only matches ` ```mql5 ` blocks. If the AI uses ` ```MQL5 ` or ` ```cpp `, code won't be extracted. Should be case-insensitive.
- **GapAnalysis.tsx**: The `useEffect` that computes gaps runs on the `playbook` object reference from react-query. Since react-query returns new references on every fetch, this will recompute on every render cycle where playbooks are refetched. Minor performance issue.

### 6. UX/Consistency Issues

- **No loading state in CodeLab** when loading versions from DB.
- **PerformancePanel** imports 6 Lucide icons but uses none of them in the JSX — the stats cards use inline JSX without icon components.

## Plan: Fixes to Apply

### Step 1: Add `simulate-alpha` to config.toml
Add the missing entry to `supabase/config.toml`.

### Step 2: Fix `hasTradeData` in StrategyLab.tsx
Query the trades table to check if the user has closed trades for the selected playbook. Use a simple count query and set `hasTradeData` accordingly.

### Step 3: Remove unused imports
- `PerformancePanel.tsx`: Remove `TrendingUp, TrendingDown, Target, BarChart3, Clock, Layers`
- `BacktestDashboard.tsx`: Remove `ResizablePanelGroup, ResizablePanel, ResizableHandle`, remove `Button`
- `CodeEditor.tsx`: Remove unused `onCodeChange` prop from interface (or keep for future use)

### Step 4: Fix stream passthrough in strategy-lab edge function
When there are no tool calls, instead of reading the entire response into memory and re-chunking, pipe the AI response body directly through to the client. This preserves real-time streaming.

### Step 5: Make code extraction case-insensitive in CodeLab
Change the regex from `/```mql5\n/` to `/```(?:mql5|MQL5|cpp)\n/i` to catch common variants.

### Files to modify:
- `supabase/config.toml` — add simulate-alpha entry
- `src/pages/StrategyLab.tsx` — fix hasTradeData
- `src/components/strategy-lab/PerformancePanel.tsx` — remove unused imports
- `src/components/strategy-lab/BacktestDashboard.tsx` — remove unused imports
- `src/components/strategy-lab/CodeLab.tsx` — case-insensitive code extraction
- `supabase/functions/strategy-lab/index.ts` — fix stream passthrough for non-tool-call responses

