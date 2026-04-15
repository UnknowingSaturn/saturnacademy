

# Playbook-to-Alpha Simulation Engine

## What This Does

Adds a new **Simulator** tab to Strategy Lab that converts your playbook rules into an executable trading alpha (a set of deterministic signal functions), runs simulations against your actual historical trade data and synthetic price data, and shows results — all powered by AI code generation + server-side script execution.

## Architecture

```text
┌──────────────────────┐     ┌──────────────────────────────┐
│  Simulator Tab (UI)  │     │  simulate-alpha Edge Function │
│                      │     │                               │
│  Playbook Selector   │────▶│  1. AI converts playbook →    │
│  Run Simulation btn  │     │     TypeScript alpha function  │
│  Parameter Tweaks    │     │  2. Runs alpha against trade   │
│  Results Dashboard   │◀────│     history (from DB)          │
│  Equity Curve Chart  │     │  3. Returns simulation results │
│  Trade-by-Trade Log  │     │     (metrics + equity curve +  │
│  AI Analysis Chat    │     │      trade list)               │
└──────────────────────┘     └──────────────────────────────┘
```

## How It Works

### Step 1: Playbook → Alpha Function (AI-Generated)

The AI (Gemini 2.5 Pro) reads the playbook's rules and converts them into a deterministic TypeScript signal function:

```typescript
// AI generates this from playbook rules
function shouldEnter(candle, profile, context): Signal | null {
  // From confirmation_rules: "Price reclaims VAL with volume"
  if (candle.close > profile.val && candle.volume > profile.avgVolume * 1.2) {
    // From entry_zone_rules: { min_percentile: 20, max_percentile: 40 }
    if (context.pricePercentile >= 0.2 && context.pricePercentile <= 0.4) {
      return { direction: 'buy', sl: profile.val - atr, tp: profile.poc };
    }
  }
  return null;
}
```

This alpha code is saved to `generated_strategies` so it can be iterated on.

### Step 2: Simulation Engine (Edge Function)

A new edge function `simulate-alpha` that:

1. **Fetches the user's closed trades** from the DB as the price/event dataset
2. **Runs the alpha function** against each trade's entry conditions to see if the alpha would have taken the same trades (or different ones)
3. **Computes metrics**: hit rate, average R, profit factor, max drawdown, Sharpe ratio
4. **Returns structured results** as JSON (not a stream — simulations are compute-bound, not conversational)

The simulation uses the user's actual trade history as the ground truth dataset — comparing "what my alpha would have done" vs "what I actually did." This is the most valuable backtest because it uses real market conditions you actually traded in.

### Step 3: Results Dashboard

Visual display of simulation output:
- **Metrics cards**: Win rate, PF, Sharpe, max DD, total trades filtered vs taken
- **Equity curve**: Chart comparing alpha equity vs actual equity
- **Trade log**: Table showing each trade with alpha signal (take/skip), actual result, and whether the alpha agreed
- **Agreement score**: How often the alpha agrees with your actual entries (measures rule-following)

### Step 4: AI Refinement Loop

After simulation results come back, the AI can:
- Analyze where the alpha diverged from actual trades
- Suggest rule tweaks to improve the alpha
- Re-run simulation with modified parameters
- Compare multiple alpha versions side-by-side

## Database Changes

### New table: `simulation_runs`
```sql
id UUID PK
user_id UUID FK
playbook_id UUID FK (nullable)
strategy_id UUID FK → generated_strategies (nullable)
alpha_code TEXT — the TypeScript alpha function
parameters JSONB — tunable inputs
results JSONB — metrics, equity curve, trade signals
status TEXT — 'running' | 'completed' | 'failed'
created_at TIMESTAMPTZ
```
RLS: users can only access their own rows.

## Files to Create/Modify

| File | What |
|------|------|
| `supabase/functions/simulate-alpha/index.ts` | **NEW** — AI alpha generation + simulation engine |
| `src/components/strategy-lab/SimulatorPanel.tsx` | **NEW** — Simulator tab UI with parameter controls, results dashboard, equity chart, trade log |
| `src/pages/StrategyLab.tsx` | Add Simulator tab |
| DB migration | `simulation_runs` table with RLS |

## Why This Approach

1. **No external data feeds needed** — uses your own trade history as the dataset
2. **No paid services** — runs on the existing edge function + Lovable AI
3. **Closed loop** — alpha comes from your playbook, tests against your trades, AI suggests improvements, you tweak the playbook, re-run
4. **Deterministic** — the alpha function is plain TypeScript, inspectable and editable
5. **Comparable** — "would my rules have filtered out my losing trades?" is the most actionable question for a discretionary trader refining a playbook into a systematic strategy

## Implementation Order

1. Database migration for `simulation_runs`
2. Edge function: AI alpha generation + simulation execution
3. Simulator tab UI with results visualization
4. Wire AI analysis of simulation results into the chat

