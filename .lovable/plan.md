

# Backtester: Interactive Alpha Builder via Chat

## The Problem

The current Simulator tab fires a single API call that asks AI to guess take/skip decisions — no user interaction, no iterative refinement, no real backtesting. You want a **conversational alpha builder** where the AI chats with you to understand your playbook rules deeply, converts them into a deterministic alpha, then runs it against your trade history as a proper backtest.

## The Solution: Two-Phase Backtester Tab

Replace the current "Simulator" tab with a "Backtest" tab that has two phases:

```text
Phase 1: Alpha Builder (Chat)          Phase 2: Backtest Results
┌──────────────────────────────┐       ┌──────────────────────────────┐
│ AI: "Your playbook has 3     │       │ ┌─────────────────────────┐  │
│ confirmation rules. Let's    │       │ │ Equity Curve Chart      │  │
│ convert each one. Rule 1:    │       │ │ (alpha vs actual)       │  │
│ 'Price reclaims VAL' — what  │       │ └─────────────────────────┘  │
│ defines reclaim? A close     │       │ Win: 62% | PF: 1.8 | DD: 3%│
│ above? A wick?"              │       │ Sharpe: 1.2 | Trades: 47    │
│                              │       │                              │
│ You: "Close above on M5"    │       │ Trade Log:                   │
│                              │       │ ✅ EURUSD Buy +2.1R          │
│ AI: "Got it. Rule 2:         │       │ ❌ NAS100 Sell -1R (skipped) │
│ 'Volume above average' —     │       │ ✅ GBPUSD Buy +0.8R          │
│ what multiplier?"            │       │                              │
│                              │       │ [Refine Alpha] [Export]      │
│ [Build Alpha & Run Backtest] │       │                              │
└──────────────────────────────┘       └──────────────────────────────┘
```

### How It Works

1. **User selects playbook** and clicks "Build Alpha"
2. **AI reads the playbook rules** and asks clarifying questions one by one — "What exactly counts as reclaiming VAL?", "What's your volume threshold?", "How do you define the entry zone?"
3. **User answers** in natural language
4. **AI generates a structured alpha definition** (JSON with deterministic filter rules) and shows it for confirmation
5. **User confirms** → AI runs the alpha against their trade history
6. **Results display** with equity curve, metrics, trade-by-trade log
7. **User can refine** — "skip trades where R:R is below 2" → re-runs

### Alpha Definition Format

The AI produces a structured JSON alpha (not executable code, but a rule set the edge function can evaluate deterministically):

```json
{
  "filters": {
    "symbols": ["NAS100", "EURUSD"],
    "sessions": ["london", "new_york_am"],
    "min_rr": 2.0,
    "require_sl": true,
    "max_trades_per_day": 3
  },
  "entry_rules": [
    { "rule": "direction_matches_session_bias", "weight": 1.0 },
    { "rule": "sl_distance_within_atr", "params": { "max_atr_multiple": 1.5 } }
  ],
  "exit_rules": [
    { "rule": "tp_at_least_2r" }
  ]
}
```

Rules we CAN evaluate deterministically from trade data: symbol, session, R:R ratio, SL presence, daily trade count, direction, time-of-day. Rules we can't verify (chart-based like "reclaims VAL") get marked as **assumed_met** with a note.

## Changes

### Edge Function: `simulate-alpha`
- Accept a new `mode` parameter: `"build_alpha"` (streaming chat) or `"run_backtest"` (compute + return JSON)
- `build_alpha` mode: Streams a conversation where AI asks about each rule, builds the alpha definition iteratively
- `run_backtest` mode: Takes the finalized alpha JSON, runs deterministic filters against trade history, computes metrics
- Deterministic evaluation (no AI guessing take/skip) — filters are applied programmatically

### Frontend: Replace `SimulatorPanel` → `BacktestPanel`
- **Phase 1 UI**: Chat interface where AI asks about rules, shows the alpha definition being built, "Run Backtest" button when alpha is ready
- **Phase 2 UI**: Results dashboard (reuse existing metrics cards, equity chart, trade log from current SimulatorPanel)
- **Refinement loop**: After results, user can type changes → AI updates alpha → re-runs

### StrategyLab.tsx
- Rename "Simulator" tab to "Backtest"
- Swap `SimulatorPanel` for `BacktestPanel`

## Files to Modify

| File | Action |
|------|--------|
| `supabase/functions/simulate-alpha/index.ts` | Rewrite: add `build_alpha` streaming mode + deterministic `run_backtest` mode |
| `src/components/strategy-lab/SimulatorPanel.tsx` | Replace with `BacktestPanel.tsx` — chat-based alpha builder + results dashboard |
| `src/pages/StrategyLab.tsx` | Rename tab, swap component |

No database changes — uses existing `simulation_runs` table.

