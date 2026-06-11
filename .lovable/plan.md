## Goal

Lift win rate against prop-firm constraints by giving Pair Lab two things it's missing:

1. **Symbol aliasing** — collapse `EURUSD / EURUSD+`, `NAS100 / NASUSD / NDX100 / US100.cash`, `SP500 / SPX500 / SPXUSD / US500.cash`, `XAUUSD / XAUUSD+`, etc. into one canonical symbol per user. Today these are split into tiny low-confidence buckets (visible in your screenshot — N=1, N=2 cells everywhere).
2. **Prop-firm-aware recommendations** — the engine already suggests SL / TP-ladder / risk %, but it optimizes expected R, not win rate, and it ignores prop-firm DD budgets. We add a win-rate-first target and a prop-firm safety layer.

## What you'll see when this ships

- **Pair Lab grid** shows one row per canonical pair (one `EURUSD` row aggregating 85 + 27 = 112 trades, one `NAS100-family` row aggregating ~34 trades). Sample sizes jump, confidence badges flip from low → medium/high, the noisy N=1 cells disappear.
- **Symbol Aliases manager** (new tab inside Pair Lab) auto-detects duplicates and proposes a canonical name. One click confirms.
- **Recommendation card** gains a "Prop-firm mode" toggle. When on:
  - Suggested risk % is the smaller of ¼-Kelly and `(daily_loss_budget / max_consecutive_losses_p95)` for that bucket.
  - TP ladder gains a **TP1 = "win-rate maximizing"** target — the R level where cumulative win-rate × R is highest in the MFE distribution. This is the lever for raising win rate without giving back edge.
  - A red flag appears if the bucket's worst observed losing streak would breach the account's daily/total DD at the suggested risk.
- **AI quant note** receives the prop-firm context and writes its parameter changes against that constraint instead of pure expected-R.

## Approach

### 1. Symbol aliasing (new `symbol_aliases` table)

User-scoped table mapping raw broker symbol → canonical symbol. Pair Lab reads it and groups by canonical. No backfill, no edit to existing trade rows — purely a presentation/aggregation layer.

```
symbol_aliases(user_id, raw_symbol, canonical_symbol, source, created_at)
unique(user_id, raw_symbol)
```

`source` = `'auto'` (suggested by the detector) or `'manual'` (user confirmed/edited). Auto rules cover the common cases:

- Strip trailing `+`, `.`, `.cash`, `.pro`, `.r`, `.m`, `_i`, `-pro`.
- Family map for indices: `{NAS100, NASUSD, NDX100, US100, US100.cash} → NAS100`; `{SP500, SPX500, SPXUSD, US500, US500.cash} → SP500`; `{US30, DJ30, US30.cash, DOW} → US30`; `{GER40, DE40, DAX40} → GER40`; etc.
- Anything ambiguous stays unaliased and surfaces in the manager for the user to resolve.

The detector runs on the user's own `trades.symbol` distinct list — no global hard-coding beyond the family map.

### 2. Pair Lab grouping uses canonical symbol

`buildBuckets` in `src/lib/pairLabMath.ts` gets a `symbolResolver: (raw) => canonical` argument. `usePairLab` fetches the alias table once and passes the resolver in. Grid rows, recommendation card, and AI note all key off canonical names. Raw broker names show as a small subtitle ("EURUSD · across EURUSD, EURUSD+") so nothing is hidden.

### 3. Win-rate-first TP target

Today's TP ladder uses MFE quartiles (p70/p50/p25 of winners → 3 R targets). That's optimal for expected R but not for win rate.

Add a fourth derived value, **TP1\***, computed from the empirical MFE distribution of *all* trades in the bucket (not just winners):

```
For r in [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0]:
  hit_rate(r)   = fraction of trades whose MFE ≥ r
  win_rate(r)   = hit_rate(r)  // a trade that reaches r before stop is bookable as a partial win
  expectancy(r) = hit_rate(r) × r − (1 − hit_rate(r)) × avg_MAE_R

TP1* = argmax over r of  (hit_rate(r) × log(r))   // win-rate-weighted, log-scaled to avoid 0.25 always winning
```

Display: "TP1 (win-rate maxing) = 0.6R · hits 72% of trades" alongside the existing expected-R ladder. The user can pick which target the playbook should adopt.

### 4. Prop-firm safety layer (account-aware)

Reuse `accounts` + `prop_firm_rules` already in the database. For the active account:

```
daily_loss_budget_R    = account.daily_drawdown_limit / planned_R_dollar_value
total_dd_budget_R      = account.max_drawdown / planned_R_dollar_value
worst_losing_streak    = longest run of consecutive losses observed in the bucket
suggested_risk_pct_pf  = daily_loss_budget_R / max(3, worst_losing_streak_p95) × 100
```

Final suggested risk = `min(¼-Kelly, suggested_risk_pct_pf)`, clamped to `[0.1%, account.risk_per_trade_cap]`. If the cap binds, the card says "limited by prop-firm DD budget, not edge".

### 5. AI quant note context

Pass `propFirm: { name, dailyDDR, totalDDR, currentEquityR, observedWorstStreak }` into the existing `pair-lab-report` edge function. The system prompt gains one rule: *"If propFirm is set, your parameter changes must respect dailyDDR. Prefer raising win rate via TP1\* over chasing expected R."* No model swap.

### Out of scope (for this plan)

- Backtesting / forward-walk validation of the new TP1\* on held-out trades — useful later, separate plan.
- Editing existing `trades.symbol` rows. Aliasing is a view, not a rewrite.
- Multi-account aggregation across different prop firms — Pair Lab still respects the account filter.

## Files

**New**
- `supabase/migrations/<ts>_symbol_aliases.sql` — table + GRANTs + RLS.
- `src/hooks/useSymbolAliases.tsx` — read/upsert aliases.
- `src/lib/symbolAliasing.ts` — auto-detect rules + family map + `applyAliases(rawList, aliases)`.
- `src/components/pair-lab/SymbolAliasManager.tsx` — list of detected raw symbols, suggested canonical, accept/edit/reject.
- `src/components/pair-lab/PropFirmGuard.tsx` — small card on the recommendation showing DD-budget math and the binding constraint.

**Edited**
- `src/lib/pairLabMath.ts` — accept `symbolResolver` and `propFirmContext`; compute `tp1Star`; expose `worstLosingStreak`.
- `src/hooks/usePairLab.tsx` — load aliases + active account + prop firm rules; pass into `buildBuckets`.
- `src/pages/PairLab.tsx` — tabs (`Grid` | `Aliases`), prop-firm toggle, raw-symbol subtitle.
- `src/components/pair-lab/RecommendationCard.tsx` — render TP1\* and prop-firm constraint.
- `supabase/functions/pair-lab-report/index.ts` — accept `propFirm` and `tp1Star`, update system prompt.

## Phasing

- **Phase A (small):** symbol aliases table + auto-detect + manager UI + grid grouping. This alone fixes the screenshot.
- **Phase B:** TP1\* + prop-firm safety layer + AI note context.

Ship A first so the grid is usable, then B.