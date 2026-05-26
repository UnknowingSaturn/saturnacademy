## Audit of current tabs

Strategy Lab has **two layers** of tabs.

**Top-level (`StrategyLab.tsx`)**

| Tab | What it does | Data source | Verdict |
|---|---|---|---|
| Chat | Free-form chat with the strategy LLM | None / playbook | **Redundant** — every other tab embeds its own `StrategyChat`. Keeps users in a dead-end conversation that has no metrics or report context. |
| Backtester | Build → Run in MT5 → Analyze pipeline | HTML report / CSV trade log | **Crucial** — the only place backtest data actually lives. Keep and expand. |
| Performance | Stats on live `trades` table | `public.trades` (live broker data) | **Misplaced** — has nothing to do with backtesting. Belongs in Reports/Journal. In Strategy Lab it's confusing (it ignores the report you just uploaded). |
| Gap Analysis | Playbook completeness score + chat | `playbooks` row | **Useful but mis-scoped** — it's a playbook-quality check, not a backtest tool. Belongs next to playbook editing. |

**Inside Backtester (analyze phase)**

| Tab | Data | Verdict |
|---|---|---|
| AI Analysis | Uses parsed metrics string | Keep — primary interpretation surface |
| Equity Curve | CSV trades only (idx-based X axis) | Keep but **rebuild** — walk-forward needs a **date axis** and **IS/OOS split marker**, not trade #. |
| Distribution | Hour/Day/PnL histogram/Streaks from CSV | Keep Hour/Day/Histogram. Streaks is noise. **Add monthly-returns heatmap** — the single most useful walk-forward view. |
| Monte Carlo | Random shuffle of trades | Keep, but **add block-bootstrap option** (preserves regime ordering, which is what walk-forward cares about) and let user set the ruin threshold (currently hard-coded 20%). |

## What's missing for walk-forward backtesting

1. **No IS / OOS split** — user can't mark where in-sample training ends and out-of-sample starts. This is the whole point of walk-forward.
2. **Equity curve plots on trade index, not date** — can't see regime decay over time.
3. **No rolling metrics** — no rolling Sharpe / win-rate / profit-factor to spot edge erosion.
4. **No monthly / period returns table** — standard walk-forward output.
5. **No IS-vs-OOS comparison card** — net profit, PF, Sharpe, max DD on both halves side-by-side.
6. **CSV import drops symbol & duration** — so "Avg Duration" and any per-symbol view are permanently blank in `BacktestMetricsGrid`.
7. **Metrics grid missing** CAGR, Calmar, Sortino, MAR — standard walk-forward acceptance metrics.

## Plan

### 1. Prune top-level tabs (`src/pages/StrategyLab.tsx`)
- **Remove** the standalone `Chat` tab. The Backtester's AI tab and Gap Analysis's chat already cover it.
- **Move** `Gap Analysis` out of Strategy Lab → render it inside the Backtester's `build` phase as a collapsible "Playbook Health" panel above the chat. The user already needs to see gaps before generating an EA.
- **Move** `Performance` out of Strategy Lab → it belongs on the Reports/Journal page (live trade analytics). If we want to keep something similar here, replace it with a **"Live vs Backtest"** comparison tab that joins the imported backtest with the user's live `trades` for the same playbook — that *is* walk-forward-relevant.
- Result: top-level becomes just **Backtester** (with optional **Live vs Backtest** later). The phase stepper (Build / Run / Analyze) becomes the primary navigation.

### 2. Backtester — Build phase
- Embed the existing `GapAnalysis` score + cards above the chat (collapsible, defaults open when score < 80%).
- Keep the 3-panel layout (versions / chat / code).

### 3. Backtester — Analyze phase, metrics header
- Extend `TradeRecord` with `symbol`, `closeDate`, `durationSec`; populate them in `CSVImport.tsx` (look for `symbol`/`instrument`, `close time`/`exit time`, compute duration from open→close).
- Extend `BacktestMetricsGrid` with **CAGR**, **Calmar**, **Sortino**, **MAR**, **Exposure %**. Compute in `computeMetrics`.
- Add a **date range picker** + **IS/OOS split slider** (defaults to 70/30). Selection is stored in component state and feeds all sub-tabs.

### 4. Analyze sub-tabs

**a. AI Analysis** — pass the IS/OOS split summary into the prompt so the LLM critiques OOS, not the whole period.

**b. Equity Curve (`EquityCurveChart.tsx`)** — rebuild:
- X axis = date (fallback to idx only if no dates).
- Vertical reference line at the IS/OOS split.
- Drawdown overlay stays.
- Drop "Trade markers" (visually noisy at >100 trades) — replace with a "Highlight worst 5 drawdowns" toggle.
- Add a small **rolling Sharpe (60-trade)** line below the equity panel.

**c. Distribution (`TradeDistributionCharts.tsx`)** — keep Hour, Day, Histogram. Replace Streaks with:
- **Monthly returns heatmap** (year × month grid, green/red intensity by % return).
- **IS vs OOS bar chart** (Net P&L, PF, Sharpe, MaxDD side-by-side bars).

**d. Monte Carlo (`MonteCarloPanel.tsx`)** —
- Add a method toggle: **IID shuffle** (current) vs **Block bootstrap** (block size = user input, default 5) — preserves local serial correlation, more honest for walk-forward.
- Make ruin threshold (currently 20) a small numeric input.
- Run only on the **OOS slice** by default with a toggle to run on full set.

### 5. Polish pass
- Disabled tabs show a tooltip explaining what to import (currently they're just greyed out).
- Replace ad-hoc `text-green-500` / `text-red-500` with the existing semantic tokens (`text-success`, `text-destructive`) — search audit shows ~25 hits across the four files.
- The "Refine EA" button currently jumps to Build but loses the report — keep it but also pass `rawMetricsStr` to the chat as context.
- The phase stepper buttons are clickable even when invalid — disable visually instead of silently no-op'ing.

### 6. Out of scope (will not touch)
- Live `trades` schema, journal pipeline, copier.
- The scalp-edge analysis already shipped last turn.
- Backend edge functions (only the existing `strategy-lab` function gets a new `mode: "walk_forward"` payload field added).

## Verification

After implementation, with a sample CSV trade log loaded:
- Top-level tab bar shows only **Backtester** (and Live-vs-Backtest if we kept it).
- Build phase shows the playbook gap score inline.
- Analyze header shows CAGR/Calmar/Sortino/MAR alongside the existing metrics, plus a working IS/OOS slider.
- Equity curve is date-based with a visible IS/OOS divider and rolling Sharpe.
- Distribution shows a monthly heatmap and an IS-vs-OOS comparison.
- Monte Carlo lets the user pick block size and runs on OOS by default.
- No "neutral / dash" cells where data was silently dropped (symbol, duration now populated).

## Question for you before I implement

A few of these moves are opinionated — confirm direction:
- OK to **delete** the top-level Chat tab outright?
- **Move** Performance to Reports page, or **replace** it in-place with a "Live vs Backtest" panel?
- **Move** Gap Analysis into the Backtester Build phase, or keep it as its own tab but rename it "Playbook Health"?
