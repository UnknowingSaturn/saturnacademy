## What you're actually asking

> *"Is 2% risk with exits at 1:1 + 1:2 better than 1.5% all-out at 2R?"*

This is a **counterfactual replay** question. We already log MFE (how far each trade ran in your favor) and MAE (how far against). That's enough to *replay every closed trade* under any hypothetical exit rule and any risk size, and produce hard numbers — total $ P&L, win rate, expectancy, max drawdown, worst losing streak, and whether the strategy would have busted your prop firm.

The current Pair Lab gives you *one* recommended setup per bucket. What you want is the ability to **compare two or more setups side-by-side**, on your own trades, and see which one would have actually paid more / survived better.

## The approach: deterministic historical replay (no Monte Carlo, no AI guessing)

For each closed trade we already know:
- direction, entry, initial SL distance (pips)
- MFE in R (max favorable excursion)
- MAE in R (max adverse excursion)
- actual outcome (for sanity-check only)

Given a hypothetical strategy `S = { risk_pct, sl_rule, exit_rule }`:

```text
For each trade t:
  hypo_sl_R = sl_rule applied to t  (e.g. "keep original", "tighten to ideal_sl", "1.15 × MAE p75")
  // Did it stop out under the new SL?
  if t.MAE_R >= hypo_sl_R: result = -1R
  else: result = exit_rule applied to t.MFE_R
  // exit_rule examples:
  //   "all_out @2R"          → if MFE>=2 → +2R else +MFE (trailing) OR breakeven
  //   "50% @1R + 50% @2R"    → if MFE>=1 → +0.5R booked; if MFE>=2 → +1R more; else partial + BE
  //   "tp1_star + runner"    → book 50% at tp1*, trail the rest to MFE
  hypo_dollars = result × risk_pct × account_balance
```

Then aggregate across all trades in the bucket: total $, win rate, expectancy R, max equity drawdown (running sum), worst losing streak, days that breach prop-firm daily loss limit, cumulative DD vs prop-firm max.

This is **deterministic** — same trades in, same numbers out. No randomness, no AI hallucination. The AI's only job is to explain *why* one strategy wins.

## What you'll see when this ships

A new **Simulator** tab inside Pair Lab. Looks like this:

```text
┌──────────────────────────────────────────────────────────────────┐
│  Pair Lab → EURUSD · London   (112 trades)                       │
├──────────────────────────────────────────────────────────────────┤
│  Strategy A                       Strategy B                     │
│  ─────────────────                ─────────────────              │
│  Risk:  2.0%                      Risk:  1.5%                    │
│  SL:    keep original             SL:    tighten → ideal_sl      │
│  Exit:  50% @1R + 50% @2R         Exit:  all-out @2R             │
│                                                                  │
│  Total $:    +$4,820              Total $:    +$3,140            │
│  Win rate:   71%                  Win rate:   42%                │
│  Expectancy: +0.38R               Expectancy: +0.52R             │
│  Max DD $:   -$680  (3.4%)        Max DD $:   -$1,210  (6.1%)    │
│  Worst streak: 4 losses           Worst streak: 7 losses         │
│  Prop-firm:  ✓ PASS               Prop-firm:  ✗ BUSTS day 23     │
│                                                                  │
│  → A wins on $ and survival. B wins on per-trade expectancy.     │
│    The 50%@1R partial is what saves the win rate.                │
└──────────────────────────────────────────────────────────────────┘
[+ Add strategy C]   [Run on all sessions]   [Export]
```

Underneath: an equity curve overlay (both strategies on the same chart) and a per-trade table showing where they diverge, so nothing is a black box.

## Strategy presets

Most users won't want to hand-build strategies. Ship a preset library:

- **Quick-flip** — 100% out at 1R
- **Standard scale-out** — 50% @1R, 50% @2R, BE after first TP
- **Runner** — 33% @1R, 33% @2R, 34% trailed to MFE
- **Win-rate-max (TP1\*)** — 100% out at the bucket's computed TP1\*
- **Conservative prop-firm** — risk = `min(kelly, dailyDD/streak)`, all out at TP1\*
- **Your current behavior** — uses your actual avg risk % and actual exits, as the baseline to beat
- **Custom** — sliders for risk%, SL rule, ladder

The grid auto-runs the top 4 presets in the background and shows a one-line winner ("Standard scale-out wins by +$1,680 vs your current behavior").

## Why this is better than just "guess and toggle"

- **Grounded in your trades**, not simulated coin flips. If your MFE distribution shows 70% of EURUSD-London trades reach 1R but only 30% reach 2R, the simulator will reflect that. The AI report we already ship can't tell you the *dollar* difference between two specific strategies — it can only describe the bucket.
- **Prop-firm-aware by construction**. Each strategy carries a pass/fail flag against your active account's daily/total DD. You stop having to guess.
- **Composable with the existing Pair Lab**. Buckets, aliases, filters all reuse the same code path. Only the exit-rule engine is new.

## Honest limits (state these in the UI)

- Replay assumes MFE was reachable as a stop-and-take — i.e. price actually printed there. That's the standard assumption in journal replay; it slightly *over*-estimates partial-out strategies because it doesn't model slippage on the partials. We surface this caveat on every result card.
- Win rate is bookable: a trade that hits TP1 and then reverses to BE counts as a winner with the booked portion. This matches how you'd actually trade it.
- Sample-size confidence carries over: a strategy that "wins" on a 6-trade bucket gets a "low confidence — N=6" badge and is excluded from the auto-ranker.
- We can't replay strategies that depend on info we don't capture (e.g. "exit before NFP"). Out of scope.

## Phasing

### Phase 1 — Replay engine + 2-strategy compare UI
Ship the core: pure `replayBucket(trades, strategy)` function, a side-by-side compare card with presets, the equity-curve overlay, prop-firm pass/fail. This alone answers your "2% / 1R+2R vs 1.5% / 2R" question.

### Phase 2 — Auto-ranker + AI explanation
Run the 4 default presets in the background for every bucket. Show "Best strategy for this bucket" in the recommendation card alongside the existing parameter suggestions. Hand the top-2 strategies to the existing `pair-lab-report` edge function so the AI note explains *why* one wins (e.g. "A's 50%@1R captures the 71% of trades that touch 1R but reverse before 2R").

### Phase 3 — Cross-pair / cross-session optimizer
"Find the best strategy per (pair × session)" — runs replay over the full preset list for every bucket, returns one optimal strategy per cell. Useful once Phase 1 is proven.

## Out of scope (separate plans)

- Walk-forward / out-of-sample testing (split trades into train/test, optimize on first half, score on second). Useful for avoiding overfitting once the basic simulator is in.
- True Monte Carlo (resample trades with replacement to get DD distributions). Adds bands to the equity curve. Not needed for the first version.
- Slippage and commission modeling per broker.
- Time-of-day / news-window filters as part of the strategy.

## Technical sketch (for reference)

**New file** `src/lib/pairLabSimulator.ts`
```ts
export interface ExitRule {
  partials: Array<{ atR: number; fraction: number }>;  // sums to ≤1
  runner?: "trail_to_mfe" | "all_out_at_last_partial" | "be_after_first_tp";
}
export interface Strategy {
  id: string;
  label: string;
  riskPct: number;
  slRule: "original" | "tighten_to_ideal" | "widen_to_mae_p75_x_1_15";
  exitRule: ExitRule;
}
export interface ReplayResult {
  strategy: Strategy;
  totalDollars: number;
  expectancyR: number;
  winRate: number;
  maxDrawdownDollars: number;
  worstLosingStreak: number;
  equityCurve: Array<{ tradeIndex: number; equity: number }>;
  propFirmVerdict: "pass" | "bust_daily" | "bust_total" | "n/a";
  perTrade: Array<{ tradeId: string; resultR: number; dollars: number }>;
}
export function replayBucket(
  trades: Trade[], keys: PairLabFieldKeys, strategy: Strategy,
  account: { balance: number }, propFirm: PropFirmContext | null,
): ReplayResult;
```

**New files**
- `src/components/pair-lab/StrategyCompare.tsx` — side-by-side compare card
- `src/components/pair-lab/StrategyPresetPicker.tsx` — preset dropdown + custom sliders
- `src/components/pair-lab/EquityCurveOverlay.tsx` — recharts overlay
- `src/lib/pairLabPresets.ts` — the 6 presets above

**Edited**
- `src/pages/PairLab.tsx` — add a "Simulator" tab and surface auto-ranker result in the existing recommendation card
- `supabase/functions/pair-lab-report/index.ts` (Phase 2) — accept `topStrategies: ReplayResult[]` and reference them in the note

No DB changes. Everything runs client-side on already-fetched trades.
