

# MT5 Strategy Tester Backtesting: Unified Alpha-to-EA Pipeline

## Current State

There are **three overlapping tabs** doing related things:
- **Code Lab**: AI generates MQL5 EA code from chat, saves versions
- **Backtester** (BacktestDashboard): Upload MT5 HTML report, AI analyzes it
- **Backtest Alpha** (BacktestPanel): Chat to build alpha JSON, run deterministic metadata-only filter

The user wants a single, robust flow: **Playbook → AI chat → MQL5 EA → MT5 Strategy Tester → Import results → Iterate**.

## The Plan: Merge Into One "Backtester" Tab

Consolidate the three tabs into one unified Backtester with a clear three-phase workflow:

```text
Phase 1: Build Alpha EA          Phase 2: Run in MT5          Phase 3: Analyze Results
┌─────────────────────┐          ┌──────────────────┐         ┌──────────────────────┐
│ Chat with AI to     │          │ Download .mq5    │         │ Upload HTML report   │
│ clarify playbook    │  ──→     │ Run in MT5       │  ──→    │ AI parses metrics    │
│ rules. AI generates │          │ Strategy Tester  │         │ Compare runs, refine │
│ production MQL5 EA  │          │                  │         │ Go back to Phase 1   │
└─────────────────────┘          └──────────────────┘         └──────────────────────┘
```

### Phase 1: Alpha Builder Chat (AI → MQL5 EA)

Reuse the existing `strategy-lab` edge function's `code_generation` mode, enhanced:
- AI reads playbook rules and asks clarifying questions (same as current Backtest Alpha chat)
- But instead of generating a JSON alpha, it generates a **full MQL5 EA** with proper Strategy Tester support
- EA includes: `OnInit()`, `OnTick()`, `OnTester()`, input parameters for all tunable values, session filters, volume profile logic, risk management
- Code appears in an inline editor (reuse CodeEditor component)
- User can download the `.mq5` file directly

### Phase 2: Run in MT5 (User's machine)

This happens outside the web app — instructions shown:
- Copy EA to `MQL5/Experts/`
- Open Strategy Tester, select EA, configure symbol/period/dates
- Run backtest
- Export HTML report

### Phase 3: Import & Analyze Results

Reuse the existing `ReportUpload` component and HTML parser:
- Upload MT5 HTML report
- Metrics extracted and displayed in dashboard cards
- AI analyzes results and suggests refinements
- "Refine EA" button loops back to Phase 1 with context

### Version History

Reuse existing `generated_strategies` table and `StrategyVersionList` — shows all EA versions with their associated backtest results.

## Technical Changes

### 1. Remove redundant tabs
- Delete `BacktestPanel.tsx` (the metadata-only alpha JSON approach)
- Remove the "Backtest Alpha" tab from StrategyLab.tsx

### 2. Rebuild `BacktestDashboard.tsx` → unified Backtester
Merge CodeLab + BacktestDashboard + relevant parts of BacktestPanel into one component with three sub-phases:
- **Left panel**: EA versions list (from CodeLab)
- **Center**: Chat (shared streaming logic)
- **Right**: Code editor (from CodeLab) OR results dashboard (from BacktestDashboard), toggled by phase

### 3. Extract shared streaming hook
Create `src/hooks/useStrategyLabChat.ts` to deduplicate the ~80 lines of SSE streaming code currently copied across 4+ components.

### 4. Enhance the `strategy-lab` edge function
Update the `code_generation` system prompt to specifically generate **Strategy Tester-ready** MQL5 EAs:
- Include `OnTester()` with custom metric reporting
- Add `#property tester_` pragmas for optimization
- Proper `input` parameters matching playbook filters
- Session-aware trading logic
- Built-in risk management matching playbook limits

### 5. Rename tab
"Backtester" tab replaces all three current backtest-related tabs (Backtester, Code Lab, Backtest Alpha).

## Files

| File | Action |
|------|--------|
| `src/hooks/useStrategyLabChat.ts` | **NEW** — shared SSE streaming hook |
| `src/components/strategy-lab/BacktestDashboard.tsx` | **REWRITE** — unified 3-phase backtester |
| `src/components/strategy-lab/BacktestPanel.tsx` | **DELETE** — replaced by unified backtester |
| `src/pages/StrategyLab.tsx` | Remove Backtest Alpha + Code Lab tabs, keep single "Backtester" tab |
| `supabase/functions/strategy-lab/index.ts` | Enhance code_generation prompt for Strategy Tester-ready EAs |

No database changes — reuses `generated_strategies`, `backtest_results`, `simulation_runs`.

