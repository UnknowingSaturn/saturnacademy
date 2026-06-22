# Feature-list audit + minimum additions

Most of this is already shipped. Below is what you have, what's missing, and the smallest set of additions to close the gap.

## Already covered — do nothing

| Spec item | Where it lives today |
| --- | --- |
| Trade fields (date, pair, session, direction, setup, market condition, entry/stop/target, risk %, R, MAE, MFE, notes, screenshot) | `trades` table (48 cols) + Journal page + custom fields |
| CSV import with column mapping | `src/pages/Import.tsx` |
| Win rate, avg winner/loser, expectancy, profit factor, avg R, P&L, current streak, per-session breakdown | `useDashboardMetrics` + `SessionBreakdown` |
| Equity curve | `components/dashboard/EquityCurve.tsx` |
| Exit-strategy comparison (Strategies A–E + custom) | Pair Lab **Auto-ranker** with 12 presets, walk-forward, equity overlay, prop-firm verdict, per-strategy SL/TP detail panel (just shipped) |
| MAE/MFE analysis per bucket + AI recommendation ("stops too tight / wide") | `QuantNotePanel`, `BucketGrid`, `pairLabMath.ts` (`driftBadge`, SL drift) |
| Insights engine (best session/setup/RR, recommendations) | `QuantNotePanel` per-bucket AI note + Reports `TradeHighlights` |
| Single-risk-% prop-firm sim with bust verdict | Pair Lab Auto-ranker (risk slider, pass/bust badge) |

## Missing — add these (5 focused pieces)

### 1. Dashboard metric expansion *(small)*
Extend `useDashboardMetrics` and add three small cards/charts to Dashboard:
- Sharpe ratio, recovery factor, max consecutive wins, max consecutive losses, max drawdown $/% (currently only "current streak" exists).
- **Monthly returns** heatmap (year × month grid).
- **Win/Loss distribution** histogram (R-multiple bins).

### 2. MAE/MFE cross-tab page *(small)*
New tab under Dashboard (or a section in Pair Lab) showing a matrix:
- Rows = setup type, Columns = session, Cell = avg MAE / avg MFE in R.
- One verdict line per row: "Stop too wide / too tight / aligned" using the existing `driftBadge` math in `pairLabMath.ts`.
- Reuses everything from `pairLabMath`; pure presentation layer.

### 3. Challenge Planner card *(small — Accounts page)*
For each account flagged as prop-firm, render one card:
- Inputs (already on `accounts` table or `prop_firm_rules`): daily-loss %, max-loss %, phase target %.
- Live outputs: current equity, distance to target (%, $), remaining DD (%, $), **required net R to pass** at the account's average risk %, **historical pass probability** = % of past N-trade windows in the user's journal that hit the target without breaching limits (bootstrap over closed trades).
- No Monte-Carlo here — just empirical resampling. Fast, deterministic, no new infra.

### 4. Risk Optimization grid *(new — Pair Lab tab)*
New tab "Risk lab" in `PairLab.tsx`:
- Fixed rows: 1.0%, 1.25%, 1.5%, 2.0% (configurable list).
- Columns: expected return, prob. of challenge pass, avg days to pass, **risk of ruin**, max expected DD.
- Engine: bootstrap the user's actual per-trade R sample (`r_multiple_actual`) into 5000 synthetic equity paths per risk %, applying the active prop-firm limits and target. Reuse `bootstrapMeanCi` infrastructure from `pairLabMath.ts`.
- Output a single "Recommended" pill on the best row by `pass_prob × (1 − risk_of_ruin)`.

### 5. Rotation Simulator *(new — Pair Lab tab, the marquee piece)*
New tab "Rotation lab" in `PairLab.tsx`:
- Inputs: # accounts, account size, risk %, daily-loss %, max-loss %, target %, rotation model.
- Rotation models: `one_only`, `simultaneous`, `stay_on_winner_switch_on_loss`, `round_robin`, `custom` (later).
- Engine: Monte-Carlo (default 2000 paths) sampling per-trade R from the user's actual journal (same bootstrap pool as Risk Optimization). Each path simulates account selection per rotation model and tracks per-account equity, daily and total caps.
- Outputs: pass probability, avg days to pass, avg DD, account survival rate, failure probability — plus a small distribution chart of final equity per account.

## Shared engine

One new file `src/lib/propFirmMonteCarlo.ts` houses the bootstrap + per-rule simulator, consumed by **#3, #4, #5**. Single source of truth so a change to "risk of ruin" math updates every surface.

## Out of scope (explicitly)

- No new exit-strategy presets — Auto-ranker already covers A–E and 7 more.
- No new MAE/MFE math — `pairLabMath.ts` already computes percentiles & drift badges.
- No standalone "Insights Engine" page — existing `QuantNotePanel` AI note already lists best session / best setup / best RR with citations.
- No design overhaul — reuse existing tokens, cards, and the institutional dark theme already in place.

## Open question (one) before I build

The Rotation Simulator and Risk Optimization engines both need 2,000–5,000 Monte-Carlo paths per change. Two options:

- **(a) Run in browser** with a Web Worker — instant, no infra, ~200 ms per recompute on a 300-trade sample.
- **(b) Run in a Supabase edge function** — keeps `PairLab.tsx` thin, can cache results, easier to share via reports later.

My recommendation is **(a)** for v1 — faster iteration, no cold starts, identical math to existing client engines. We can promote to an edge function later if reports need it. Confirm (a) or pick (b).

## Verification

After build: Playwright on `/dashboard`, `/accounts`, `/pair-lab` (Risk lab + Rotation lab tabs) — confirm metric cards render, MC outputs converge across re-runs, no console errors.
