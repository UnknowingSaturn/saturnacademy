
## Audit — Strategy Lab, against your live data

**Your real R-sample (296 closed trades, Dec 29 → Jun 22):**
- Mean R = **−0.046** (negative)
- SD R = 1.18
- Win rate = 41%
- Profit factor (R) = **0.915** (lose 9 cents per dollar risked, on R basis)
- Trade span: 176 calendar days, 63 active trading days (you trade ~36% of calendar days, not 5/7)

## What's correct

The math primitives are sound:
- **Stationary block bootstrap** (Politis–Romano, block ≈ N^(1/3)) — correct implementation, uniform restarts, no head-of-series bias.
- **Wilson 95% CI** on pass-prob — correct formula, well-behaved at 0/1.
- **CVaR-5%** on final equity — correct (mean of worst 5%).
- **Static vs trailing max-loss** modes — both correct against the reference (starting balance vs running peak).
- **Daily-loss check** uses net intra-day P&L, resets correctly.
- **Per-path risk-of-ruin** (≥1 account busts) is correctly computed; just mislabeled in the UI (see issue G below).
- **Geometric-mean growth** formula `(Π(1+f·r))^(1/N) − 1` is correct.

## What's wrong or misleading (ranked by severity)

### 🔴 Critical: simulator runs on a negative-edge sample with no guard
Your mean R is −0.046. The 95% bootstrap CI on mean R almost certainly straddles zero (likely [−0.18, +0.08]). At **every** risk %, expected long-run growth is negative. The heatmap will still color cells emerald-ish, and the Lab still shows a **"Recommended"** badge for whichever rotation/risk pair busts least. That's not a recommendation — it's "least bad path on a losing system." Last sprint's tier gate only checks n < 30; n = 296 passes, so no warning fires.

**Fix:** add an edge-direction gate alongside the sample-size gate. If bootstrap CI on mean R doesn't clear 0 by some margin, switch the Lab to a different mode: show the heatmap for comparison but replace the "Recommended" badge with **"Edge not positive — sizing analysis suppressed"** and the headline number with mean-R + CI.

### 🟡 Wrong: `autoTradesPerDay` denominator
Code does `spanDays × 5/7` to approximate trading days. Reality: you have 63 active days out of 176 calendar days (~36%, not 71%). For you it computes `296 / 126 ≈ 2.3/day` when actual is `296 / 63 ≈ 4.7/day`. **Pass-prob is biased low because the simulator thinks you trade half as often as you do.**

**Fix:** use `COUNT(DISTINCT entry_date)` directly. One-line change.

### 🟡 Inconsistency: fixed-$ risk vs geometric-growth metric
The path simulator uses constant $ risk (`accountSize × riskPerTradeFrac`), realistic for prop-firm fixed-stake. But the `geometricMeanGrowthPct` metric assumes compounded multiplicative `(1+f·r)`. These describe two different worlds. The number isn't wrong in isolation, but pairing them in one card invites misreading.

**Fix:** either (a) compute geometric growth from realized log-returns inside the same fixed-$ paths, or (b) re-label as "compounded equivalent — what this edge would do under fractional Kelly." Pick (b); cheaper.

### 🟡 Trade-order assumption in block bootstrap
`extractRSample` filters but doesn't sort by `entry_time`. Block bootstrap's autocorrelation-preservation claim only holds if the input is time-ordered. If `trades` arrives sorted (verify), fine. If not, the block bootstrap degenerates to plain bootstrap and the block-size logic is theatre.

**Fix:** sort by `entry_time` inside `extractRSample`, or add an assertion + comment that the caller must pre-sort.

### 🟢 Label: "Risk of ruin" vs what's measured
`riskOfRuin` is `P(≥1 account busts in a path)`. For numAccounts=1 that *is* RoR; for >1 it's "any-bust prob." Stat tooltip already exposes the per-account version. Just rename the headline label to **"Any-account bust prob"** to match the math.

### 🟢 `simultaneous` rotation assumes perfect cross-account correlation
The same R is applied to every live account in `simultaneous` mode. That's correct if you literally mirror-trade; over-conservative (max joint bust) otherwise. Worth a single-line tooltip note, not a math change.

## Recommended minimal fix set (in order)

1. **Edge-direction gate** in `StrategyLab.tsx` — compute bootstrap CI on mean R, replace "Recommended" with "Edge not positive" when CI lower bound ≤ 0 (or upper bound < some small ε). Add a clear "Your edge isn't statistically positive — fix the playbook before tuning size" message. This is the user-asked-for guard.
2. **Active-days fix** in `autoTradesPerDay` — use distinct entry dates.
3. **Time-sort** `extractRSample`.
4. **Rename** `riskOfRuin` label and add the simultaneous-correlation tooltip note.
5. **Re-label** geometric growth as "compounded equivalent."

No changes to the core math primitives — they're correct. The bugs are at the **decision/presentation layer** where the engine doesn't refuse to recommend on a losing sample.

## Files touched
- `src/lib/propFirmMonteCarlo.ts` — sort in `extractRSample`, expose a tiny `meanRWithCI` helper
- `src/components/pair-lab/StrategyLab.tsx` — edge gate, active-days TPD, relabel, tooltip

## Out of scope
- Bayesian shrinkage of mean R toward 0 (would help here but adds priors-tuning surface).
- Switching to a regime-aware bootstrap (overkill at N=296).
- Replacing fixed-$ risk with compounding (changes contract; ask separately).

## Decision needed
Proceed with the 5-item minimal fix, or only the critical edge gate (item 1) plus active-days (item 2)?
