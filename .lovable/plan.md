# Risk-aware Strategy Ranker — plain-English version

## The one-line goal

For every strategy, answer: **"At what risk % would this have grown my account fastest without a scary drawdown?"** — and compare that to what you're doing now.

## What you'll see

Same Ranker table you have today, plus **two new columns** and **one verdict chip**. No new charts, no sliders in your face, no new vocabulary.

```text
Strategy              Result at your risk (1.5%)      Suggested risk   Verdict
                      +$/trade   Worst drop           
Runner                +$12       -$180 (-1.8%)        0.9%  ↓          Too risky — cut to 0.9%
Scale-out 50/50       +$9        -$90  (-0.9%)        1.5%  =          You're already dialed in
All-out @2R           +$14       -$260 (-2.6%)        1.1%  ↓          Slightly too hot
Quick-flip @1R        +$6        -$60  (-0.6%)        2.4%  ↑          You could risk more safely
Widen SL → 2R         +$8        -$310 (-3.1%)        —              Too fat-tailed for a safe risk
```

**Columns explained (in the UI, right next to the header, as a small "?" tooltip):**

- **Suggested risk** — The risk % that would have made you the most money over your sample without your worst losing streak going past your comfort zone. Arrow shows if it's higher (↑), lower (↓), or the same (=) as what you're using.
- **Verdict** — Plain-English one-liner. Green = "you're fine", amber = "consider adjusting", red = "this strategy is dangerous at your current risk".

That's it. No probability numbers, no ratios, no charts by default.

## The one setting you control

A single question at the top of the Ranker (not a slider, just a dropdown), because "comfort zone" has to come from you:

```text
Biggest drawdown you'd stay calm through:   [ -5% ▼ ]  ( -3% / -5% / -10% / -15% )
```

Default: **-10%** for personal accounts, **auto-matches your prop-firm cap** when prop-firm mode is on. Saved per user so you set it once.

## What we hide (but keep available)

Click "Show details" on a row → reveals the pro view:

- The risk-vs-growth curve chart
- Bust probability at each risk level
- The exact numbers behind the verdict
- Note: "This is based on N=X trades. Fewer trades = less reliable suggestion."

Casual users never see it. Detail-oriented users can dig in.

## The verdict logic (kept simple)

| Condition | Verdict | Color |
|---|---|---|
| Suggested risk within ±15% of your current | "You're already dialed in" | green |
| Suggested risk > your current × 1.15 | "You could risk more safely" | blue |
| Suggested risk < your current × 0.7 | "Slightly too hot — consider {X}%" | amber |
| Suggested risk < your current × 0.5 | "Too risky at your current % — cut to {X}%" | red |
| No risk % keeps drawdown within your comfort zone | "Too fat-tailed for a safe risk" | grey |

## Technical (unchanged from the pro plan, just hidden from the UI)

Under the hood this is still Monte Carlo simulation with compounding, over the strategy's R-outcome sample, at horizon = your eligible trade count, sweeping a fixed risk grid, picking the risk % with the highest median terminal equity **subject to peak drawdown ≤ your comfort setting**.

- Reuse `runMonteCarlo` in `src/lib/propFirmMonteCarlo.ts`.
- New worker `src/workers/rankerRiskMC.worker.ts` (pattern from `strategyLabMC.worker.ts`).
- Grid: `[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3]%` clipped to `sim_hard_cap_pct`, 2000 paths per rung, fixed seed per `(strategyId, riskPct)` for stable output.
- Ruin-probability ceiling internal-only, fixed at 5% (not user-facing — the drawdown comfort setting is easier to reason about).
- Expose `rSample: number[]` on `RankerRow` if not already there.
- Sort order of the table doesn't change — still ranked by BCa lower bound of expectancy R.

**Persistence**
```sql
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS ranker_comfort_dd_pct numeric DEFAULT 10;
```
(`user_settings` already granted.)

**Server parity** — mirror in `supabase/functions/_shared/quant/pairLabSimulator.ts`, extend `serverReplayParity.test.ts` with fixed-seed MC parity.

**Tests** (`pairLabRobust.test.ts`)
- Suggested risk on a linear (constant expectancy) sample = highest feasible grid rung.
- Suggested risk on a fat-tailed sample < hard cap.
- No feasible rung → verdict is "Too fat-tailed", suggested = null.
- Verdict thresholds fire at correct multipliers.

## Out of scope

- Strategy Lab (already does risk sweeps) — untouched.
- Preset list, SL rules, per-symbol ideal-SL table — untouched.
- Any new terminology like "Kelly", "ruin probability", "Sharpe" in the default view.
