# Ranker copy — make the strict-sample caveat honest

## What's happening in the screenshot

The numbers are mathematically correct but easy to misread. Every preset is scored on the **same 13 strict-eligible trades** (closed trades with MFE, MAE, initial SL, and entry price logged). Those 13 happen to all be winners in your journal — that's why almost every preset shows **100% WR and $0 Max-DD**. The other 49 trades are silently absent, so:

- **Win %** = win rate on the strict sample, not on your book
- **Max DD** = drawdown on the strict sample's replay, not on your book
- **Total $** = simulated $ on the strict sample only
- **Expectancy (BCa)** = the actual ranking signal, and the only number that survives comparison across presets

You already decided (this turn) to keep the sample strict and not mix in no-MFE/MAE trades. So this plan is a **copy-only** pass. No simulator, math, or scoring changes.

## Why not backfill the missing 49

Presets like Tighten-SL, Adaptive-TP, and Scale-out all *require* MFE/MAE to counterfactually replay a trade. Backfilling those 49 with actual `net_pnl` would compare apples (13 replayed) to oranges (49 as-executed) inside the same row, which breaks apples-to-apples ranking. The right place for a "whole-book reality check" is the Overview / Journal, not the ranker.

## Changes (5 spots in `src/components/pair-lab/StrategyRanker.tsx`)

1. **Header blurb (line ~414)** — add one sentence: "Win %, Max-DD, and Total $ below reflect only the strict-eligible sample (13/62 here). They will not match your journal totals."

2. **Provisional banner (line ~545)** — extend the current text so it names the artifact explicitly: "Only 13 of 62 trades have MFE + MAE logged. If those 13 are mostly winners in your journal, every preset that doesn't stop earlier than reality will show ~100% WR and ~$0 DD — that's a sample artifact, not evidence of edge."

3. **Column header tooltips** — add `title` attributes to the `<th>` cells for:
   - **Win %** → "Win rate on the strict-eligible replay sample (N shown in the N column), not on your full journal."
   - **Max DD** → "Peak-to-trough drawdown of the simulated equity curve on the strict-eligible sample only."
   - **Total $** → "Simulated $ P&L on the strict-eligible sample at the current Sim $ and Risk %. Not your journal P&L."

4. **Crown summary line (line ~516)** — append " on {N} strict-eligible trades" after the WR figure so the winner card can't be read as a whole-book claim.

5. **Footnote (line ~785)** — add one more line under the existing walk-forward note: "Win %, Max-DD, and Total $ are properties of the strict-eligible replay only. Use the Overview tab for whole-book metrics."

## Out of scope (explicit)

- No changes to `pairLabSimulator.ts`, `pairLabMath.ts`, or the server twin.
- No change to which trades enter the sample, the bootstrap, BCa CIs, or the composite score.
- No new "portfolio baseline" row (rejected in the clarifying question).
- No hybrid per-preset scoping (rejected).

## Verification

- `tsgo --noEmit` — should stay clean (copy + `title` attrs only).
- Screenshot `/pair-lab?tab=strategy` after the change to confirm the caveat is visible above the fold and the column tooltips render.
- No test changes needed; the ranker's numeric outputs are unchanged.

## Answers to your two questions, plainly

**Is it accurate?** Yes, given its stated scope. The 100% WR / $0 DD rows are correct for the 13-trade strict sample; they are not claims about your whole book. The current copy under-communicates that, which is what this plan fixes.

**Should WR and DD include no-MFE/MAE trades?** No, not inside the ranker. Doing so would either (a) require assumptions (e.g. "the preset wouldn't have changed this trade") that are false for tighten-SL / adaptive-TP, or (b) mix samples across presets and break the ranking. The honest interpretation of those 49 trades is: they're missing the inputs any counterfactual replay needs. The fix is to log MFE/MAE going forward (the Exclusion panel already tells you how many are missing each), and to read whole-book WR/DD off the Overview tab, where every closed trade with a `net_pnl` is included.
