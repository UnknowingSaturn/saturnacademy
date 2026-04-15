

# What You Actually Need vs. What's Noise

## Your Setup (as described)

You trade **continuation setups before London open (~02:00 EST)** when price is **trending on the intermediary timeframe** or when price **reacts from a higher timeframe level (4H/Daily FVG)**. This is a discretionary-mechanical hybrid — the HTF context and level identification are discretionary, but the entry trigger, session filter, risk management, and exit rules are mechanical.

## What Already Works

Your current system already has:
- **Playbook rules storage** (confirmation, invalidation, management, failure modes) — stored in DB
- **AI code generation** (Build phase) — generates MQL5 from playbook context via Lovable AI
- **Alpha Builder flow** — AI asks clarifying questions before generating code
- **Version history** — saves each EA iteration to `generated_strategies`
- **Backtest report upload** (HTML parsing) — extracts metrics from MT5 Strategy Tester reports
- **AI backtest analysis** (Analyze phase) — reviews metrics against playbook expectations
- **Tool calling** — AI can modify playbook rules directly during conversation
- **Journal cross-reference** — AI sees your last 50 trades and review insights when analyzing

## What's Needed vs. Not Needed

### ESSENTIAL — Directly impacts EA quality and backtest robustness

| Feature | Why | Status |
|---------|-----|--------|
| **Multi-platform code gen (MT5 only)** | You trade MT5. MT4/Pine/Python are distractions. Skip them entirely. | Already MT5-only ✅ |
| **Enhanced metric parsing** | Current parser extracts 7 metrics via regex. Need all 14 (Expectancy, Avg Win/Loss, Best/Worst Trade, Avg Duration, Recovery Factor) to properly evaluate an EA. | Needs work |
| **Equity curve chart** | Visual inspection of the equity curve catches problems no single metric reveals — drawdown clustering, regime sensitivity, time decay. Industry standard for any backtest review. | Needs building |
| **Trade distribution charts** | Win/Loss by hour-of-day is critical for YOUR setup — you need to verify the EA only trades in your pre-London window and that edge concentrates there. Day-of-week distribution catches calendar effects. | Needs building |
| **Monte Carlo simulation** | The single most important robustness check. A backtest is one path through history. Monte Carlo reshuffles trade order to show whether your results survive different sequencing. Probability of ruin and expected drawdown range tell you if the EA is deployable. | Needs building |
| **CSV trade log import** | MT5 Strategy Tester also exports CSV/detailed trade lists. Parsing these gives you per-trade data (entry time, exit time, P&L) needed for the equity curve and distribution charts — the HTML report alone only gives summary metrics. | Needs building |
| **Enhanced AI analysis prompt** | Current prompt is generic. Should explicitly output: strengths, weaknesses, session concentration analysis, drawdown clustering detection, curve-fitting verdict, and specific parameter change suggestions. | Needs improvement |

### NOT NEEDED — Adds complexity without improving EA quality

| Feature | Why Skip |
|---------|----------|
| **MT4/Pine Script/Python platform selector** | You use MT5. Adding 3 more platforms bloats the prompt and code surface area. Can always add later. |
| **Walk-forward analysis** | Requires multiple CSV uploads with carefully defined in-sample/out-of-sample windows. This is a Phase 2 feature after you have a working Monte Carlo pipeline. It's also largely manual work in MT5 (running multiple passes). |
| **Playbook Builder restructuring (6 new form sections)** | Your playbook rules are free-text lists right now. The AI reads them as context and generates code from them. Adding 25 dropdown/multi-select fields (HTF bias, entry triggers, SL method, etc.) creates a rigid schema that doesn't match how discretionary-mechanical strategies actually work. Your description — "continuation before London when trending ITF or reacting from 4H FVG" — is better captured as a free-text rule the AI interprets than as 6 separate dropdown values. |
| **"Regenerate with Notes" UI** | The chat already supports follow-up messages. Typing "fix the session filter to use 02:00-06:00 EST" in the chat does exactly what a "regenerate with notes" button would do. |
| **Dark/light mode toggle** | Already dark theme. Cosmetic. |
| **localStorage persistence + JSON export** | Everything already persists in the database. |

## The Plan: Backtest Lab Enhancement Only

Focus on making the **Analyze phase** a proper backtest laboratory. The Build phase and EA generation are already solid.

### What gets built

**1. Enhanced metric parsing** (`ReportUpload.tsx`)
Expand the HTML parser to extract all 14 standard metrics from MT5 Strategy Tester reports. Add fallback patterns for different MT5 report formats.

**2. CSV trade log parser** (new: `backtest/CSVImport.tsx`)
File upload that parses MT5 detailed trade export (Date, Type, Lots, Price, SL, TP, Profit, Balance). Computes all 14 metrics from raw trades. Produces structured trade array for charts.

**3. Metrics grid** (new: `backtest/BacktestMetricsGrid.tsx`)
14-card grid replacing the current 7-card strip. Color-coded thresholds (green/amber/red) based on industry standards: Profit Factor >1.5 green / >1.0 amber / <1.0 red, Max DD <15% green / <25% amber / >25% red, etc.

**4. Equity curve chart** (new: `backtest/EquityCurveChart.tsx`)
Recharts line chart showing balance/equity over time. Toggle overlays: drawdown periods (red shading), individual trade markers. Zoomable via brush component.

**5. Trade distribution charts** (new: `backtest/TradeDistributionCharts.tsx`)
Three charts: Win/Loss by hour of day (bar), P&L distribution histogram, consecutive wins/losses streaks. All Recharts. Critical for validating session-filtered strategies like yours.

**6. Monte Carlo simulation** (new: `backtest/MonteCarloPanel.tsx`)
Client-side: shuffle trade P&L array 1000 times, compute equity paths per shuffle, extract P10/P50/P90 percentile bands. Display: fan chart (Recharts area), probability of ruin (DD >20%), expected max drawdown range, median final equity. Runs in ~200ms for 500 trades.

**7. Tabbed analyze phase** (`BacktestDashboard.tsx`)
Replace current flat layout with tabs: **Overview** (metrics grid) | **Equity Curve** | **Distribution** | **Monte Carlo** | **AI Analysis** (existing chat). CSV import alongside existing HTML upload.

**8. Enhanced backtest analysis prompt** (`strategy-lab/index.ts`)
Update `buildBacktestPrompt` to request structured output: strengths, weaknesses, session concentration analysis, drawdown clustering, curve-fitting assessment, specific parameter recommendations, and a deploy/iterate/abandon verdict.

### Files changed

| File | Change |
|------|--------|
| `src/components/strategy-lab/backtest/BacktestMetricsGrid.tsx` | **NEW** |
| `src/components/strategy-lab/backtest/CSVImport.tsx` | **NEW** |
| `src/components/strategy-lab/backtest/EquityCurveChart.tsx` | **NEW** |
| `src/components/strategy-lab/backtest/TradeDistributionCharts.tsx` | **NEW** |
| `src/components/strategy-lab/backtest/MonteCarloPanel.tsx` | **NEW** |
| `src/components/strategy-lab/BacktestDashboard.tsx` | Tabbed analyze phase, CSV import option |
| `src/components/strategy-lab/ReportUpload.tsx` | Enhanced 14-metric parsing |
| `supabase/functions/strategy-lab/index.ts` | Enhanced backtest analysis prompt |

No database migrations. No new dependencies (Recharts already installed). No playbook schema changes.

