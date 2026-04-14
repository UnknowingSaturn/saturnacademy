

# Strategy Lab Overhaul: From Chat to Full Trading Workbench

## The Problem

The current Strategy Lab is a single-panel chat interface. It's functional for conversations but lacks the workspace feel needed for serious strategy development — no code editor, no backtest viewer, no dedicated agent modes, no visual analysis.

## The Solution: Multi-Panel Workbench with Specialized AI Agents

Transform `/strategy-lab` into a tabbed workspace with distinct modules, each powered by a purpose-built AI agent mode. The single edge function stays but routes to different system prompts based on the active mode.

```text
┌─────────────────────────────────────────────────────────────┐
│  Strategy Lab                                    [Playbook ▼]│
├──────┬──────┬──────┬──────┬──────┐                          │
│ Chat │ Code │ Back │ Anal │ Gaps │  ← Tab bar               │
│      │ Lab  │ test │ ysis │      │                          │
├──────┴──────┴──────┴──────┴──────┴──────────────────────────┤
│                                                             │
│  Each tab = full-height panel with its own UI + AI agent    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Five Workbench Modules

### 1. Strategy Chat (existing, enhanced)
- What it is now, but scoped as the "general advisor" tab
- AMT discussion, playbook refinement, rule tweaks with tool calling
- Conversation persistence stays as-is

### 2. Code Lab (NEW)
- **Split-pane**: AI chat on left, live code editor on right
- Code editor with MQL5 syntax display, line numbers, copy/download
- AI agent mode: `code_generation` — system prompt focused exclusively on producing and iterating MQL5 EAs
- Workflow: describe what you want → AI generates full EA → displayed in editor → ask for changes → AI patches the code
- Version history: each generated EA saved to new `generated_strategies` table
- Download button produces `.mq5` file ready for MT5

### 3. Backtester (NEW)
- Upload MT5 Strategy Tester HTML reports (reuse existing `ReportUpload` parser)
- Parsed metrics displayed in a dashboard: equity curve chart, key stats cards (Profit Factor, Sharpe, Max DD, Win Rate, Total Trades)
- Compare multiple backtest runs side-by-side
- AI agent mode: `backtest_analysis` — analyzes uploaded results against playbook rules and journal performance, suggests parameter tweaks
- Results saved to new `backtest_results` table

### 4. Performance Analysis (NEW)
- Auto-loads journal trade data for selected playbook
- Visual dashboard: win rate by session, by symbol, equity curve, R-multiple distribution
- AI agent mode: `performance_analysis` — deep-dives into patterns, correlations, edge decay
- "Ask about my performance" chat embedded below the charts

### 5. Gap Analysis (NEW)
- One-click full playbook audit
- Structured output: checklist of all rule categories with pass/fail/warning
- Shows gaps as cards: "Missing invalidation for entry rule #3", "No failure mode for news events"
- AI can auto-fix gaps with tool calling (same tools already built)
- Displays a completeness score (e.g., 72% — 18/25 criteria met)

## Database Changes

### New table: `generated_strategies`
```sql
- id UUID PK
- user_id UUID FK → auth.users
- playbook_id UUID FK → playbooks (nullable)
- name TEXT
- version INT DEFAULT 1
- mql5_code TEXT
- parameters JSONB
- notes TEXT
- created_at TIMESTAMPTZ
```

### New table: `backtest_results`
```sql
- id UUID PK
- user_id UUID FK → auth.users
- strategy_id UUID FK → generated_strategies (nullable)
- playbook_id UUID FK → playbooks (nullable)
- name TEXT
- metrics JSONB (profit_factor, sharpe, max_dd, win_rate, total_trades, etc.)
- equity_curve JSONB (array of {date, equity} points)
- report_html TEXT (raw upload for re-parsing)
- created_at TIMESTAMPTZ
```

Both tables get RLS: users can only access their own rows.

## Edge Function Changes

Update `strategy-lab/index.ts` to accept a `mode` parameter:
- `chat` (default) — current behavior
- `code_generation` — stripped-down prompt focused on MQL5 code output, no tool calling
- `backtest_analysis` — prompt includes uploaded metrics, focuses on interpreting results
- `performance_analysis` — prompt emphasizes journal data patterns
- `gap_analysis` — non-streaming, returns structured JSON gap report via tool calling

## Frontend Files

| File | What |
|------|------|
| `src/pages/StrategyLab.tsx` | Overhaul: tab-based layout, shared playbook selector, route each tab to its module |
| `src/components/strategy-lab/StrategyChat.tsx` | Minor: scoped as "Chat" tab |
| `src/components/strategy-lab/CodeLab.tsx` | **NEW** — split pane with chat + code editor + version list |
| `src/components/strategy-lab/CodeEditor.tsx` | **NEW** — enhanced code viewer with line numbers, larger display |
| `src/components/strategy-lab/BacktestDashboard.tsx` | **NEW** — upload, metrics cards, equity curve chart, comparison, AI chat |
| `src/components/strategy-lab/PerformancePanel.tsx` | **NEW** — auto-loaded charts + journal stats + AI Q&A |
| `src/components/strategy-lab/GapAnalysis.tsx` | **NEW** — one-click audit UI with score ring + gap cards + auto-fix |
| `src/components/strategy-lab/StrategyVersionList.tsx` | **NEW** — sidebar list of saved EA versions |
| `supabase/functions/strategy-lab/index.ts` | Add mode routing, add code-gen and gap-analysis prompt variants |
| DB migration | 2 new tables + RLS policies |

## Implementation Order

1. **Database**: Create `generated_strategies` and `backtest_results` tables with RLS
2. **Edge function**: Add `mode` routing with specialized prompts for each agent
3. **Page overhaul**: Convert `StrategyLab.tsx` to tabbed layout
4. **Code Lab tab**: Split-pane code generation + version management
5. **Backtest tab**: Upload, parse, display metrics, AI analysis
6. **Performance tab**: Journal data visualization + AI Q&A
7. **Gap Analysis tab**: Structured audit + auto-fix

This keeps everything within the existing `/strategy-lab` route — no new pages needed. The single edge function handles all modes, keeping deployment simple.

