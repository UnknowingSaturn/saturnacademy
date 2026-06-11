
## Recommended approach

Don't ask AI to "find the best parameters" from the raw trade list — small samples + free-text reasoning produce garbage. Use a **two-layer system**:

1. **Quant layer (deterministic):** compute per-bucket distributions of MFE/MAE/ideal-SL/TP-hit and derive parameter recommendations from those distributions. Fully reproducible, no LLM needed for the numbers.
2. **AI layer (narrative):** feed the *aggregates* (not individual trades) plus a handful of cited example trades to Lovable AI to explain *why* and turn it into actionable changes for your playbooks.

This matches how prop-firm risk desks actually do it, and it works at low sample sizes because it leans on robust statistics (medians, quantiles) instead of means.

---

## Data we already have

In `trades.custom_fields` (per-trade, user-editable today):

| Key | Meaning | Use in math |
|---|---|---|
| `cf_mfe_envl` | Max favourable excursion, in R | TP placement, partial ladder |
| `cf_mae_rpvr` | Max adverse excursion (pips or R) | SL placement, "near-miss" SL hits |
| `cf_tp_reached_qqwi` | Which TPs filled (`1:1`, `1:2`, …) | Expected R per setup, partial sizing |
| `cf_ideal_stop_loss_rnv7` | Ideal SL after the fact | SL drift vs planned |
| `cf_ideal_stop_loss_position_z6qu` | initial / last leg | Structural SL rule |
| `cf_ideal_entry_window_jdl1` | first_30min / last_30min | Entry timing rule |

Plus on the trade row itself: `symbol`, `session`, `direction`, `r_multiple_actual`, `r_multiple_planned`, `sl_initial`, `tp_initial`, `risk_percent`, `equity_at_entry`, `profile` (planned), `actual_profile` (hindsight), `actual_regime`.

23 trades currently have MFE filled — small but workable for descriptive stats; we surface a "confidence" badge so you don't over-fit.

---

## The "Pair Lab" — proposed page

New route `/pair-lab` under the existing Strategy Lab umbrella (sidebar: "Pair Lab"). Three panels:

### Panel 1 — Bucket grid (the quant view)

Pivot table you can re-slice on the fly:

```text
                EURUSD   GBPUSD   XAUUSD   ...
  Tokyo          •         •        •
  London         •         •        •
  NY AM          •         •        •
  NY PM          •         •        •
  All sessions   •         •        •
```

Each cell links to the **Recommendation card** (Panel 2). Cell shows: trades N, win rate, expected R, MFE p75 in R, MAE p75 in R, sample-size badge (🟢 ≥30, 🟡 10–29, 🔴 <10).

Filter chips above the grid: planned profile, actual profile, ideal-entry-window, ideal-SL-position, regime — so you can compare e.g. "NY AM × XAUUSD × Continuation × first_30min" against the cumulative baseline.

### Panel 2 — Recommendation card (per cell)

Computed deterministically from that bucket's sample:

| Output | How it's derived |
|---|---|
| **Suggested SL (pips)** | `max(p75(MAE) × 1.15, median(cf_ideal_stop_loss))` — covers 75 % of historical adverse moves with a small buffer, then takes whichever is wider between MAE-driven and your own hindsight ideal. |
| **TP ladder (R)** | From the empirical CDF of MFE: TP1 at the R level reached by ≥70 % of trades, TP2 at p50, TP3 at p25. Caps each at the most-common `cf_tp_reached` value so we don't recommend a TP you've never actually hit. |
| **Suggested risk % of account** | Kelly-fraction-of-Kelly: `0.25 × (W × avgWinR − L) / avgWinR`, clamped to [0.25 %, 1.5 %]. Quarter-Kelly because samples are small. |
| **Expected R per trade** | `W × p50(MFE_winners) − L × p50(MAE_losers)/avgPlannedSL`. |
| **Edge vs cumulative** | Same metrics vs the all-symbol/all-session baseline, with a color delta. |
| **SL-drift flag** | If `median(cf_ideal_stop_loss) < median(sl_initial)` you're setting stops too wide; opposite = too tight. |
| **Confidence** | Bootstrap 90 % CI on expected R + sample-size badge. Hide numeric recommendations when N < 10, show distributions only. |

Card shows the underlying distribution as a small histogram (MFE, MAE) and lists the 3 best and 3 worst trades in the bucket as `CitedTradeChip` links into the journal.

### Panel 3 — AI report ("Quant note")

One-click **"Generate quant note"** button calls a new edge function `pair-lab-report`. It receives the *aggregates and recommendations* for the currently-selected slice (never the raw trade table) and a small set of cited trade IDs. Lovable AI returns a structured note:

```text
1. What's working (cite specific bucket)
2. What's leaking (cite specific bucket + trades)
3. Parameter changes to test next week (SL/TP/risk, per bucket)
4. Playbook rule edits to consider (optional — opens Playbook Assistant prefilled)
```

The note is saved to the existing `reports` table with `report_type='custom'` and `sensei_notes.kind='pair_lab'` so it shows up alongside weekly reports.

---

## Why this beats "ask AI to optimise"

- Deterministic recommendations are auditable and don't change between runs.
- Quantile-based SL/TP is robust to outliers — important when N is tiny.
- Quarter-Kelly bounds risk-sizing so a single hot bucket can't blow the account.
- LLM cost stays low: one structured note per slice, not per trade.
- Plays nicely with what already exists: `reports.edge_clusters`/`leak_clusters`, `playbook-assistant`, `CitedTradeChip`, `useReports`.

---

## Technical sketch

### Files to add
- `src/pages/PairLab.tsx` — route + layout
- `src/components/pair-lab/BucketGrid.tsx` — pivot grid
- `src/components/pair-lab/RecommendationCard.tsx` — Panel 2
- `src/components/pair-lab/DistributionChart.tsx` — MFE/MAE histogram (recharts)
- `src/components/pair-lab/QuantNotePanel.tsx` — Panel 3
- `src/hooks/usePairLab.tsx` — pulls trades + custom fields, builds buckets client-side
- `src/lib/pairLabMath.ts` — pure functions: `bucketize`, `quantile`, `bootstrapCI`, `kellyFraction`, `recommendSL`, `recommendTPLadder`
- `supabase/functions/pair-lab-report/index.ts` — Lovable AI call, `google/gemini-3-flash-preview`, structured `Output` schema. Persists to `reports`.
- `src/integrations/lovable/index.ts` — add invoke helper

### Files to touch
- `src/components/layout/AppSidebar.tsx` — add "Pair Lab" link
- `src/App.tsx` — register `/pair-lab` route

### Math runs client-side
All bucketing/quantiles run in the browser on the existing `useTrades` payload — no schema or backend changes needed for Panel 1 & 2. The edge function is only for the AI narrative.

### Field-key resolution
`pairLabMath.ts` resolves the user's custom-field keys at runtime via `useCustomFields()` (they're per-user — `cf_mfe_envl` etc. are this user's keys but other users will differ). We match by `label === 'MFE (RR)'`, `'MAE'`, `'TP Reached'`, `'Ideal Stop-Loss'`, `'Ideal Stop-Loss Position'`, `'Ideal Entry Window'`, falling back to key prefixes.

---

## Phased delivery

1. **Phase 1 (this PR):** Pair Lab page with Panel 1 (bucket grid) + Panel 2 (recommendation card), no AI. Validates the math against trades you already have.
2. **Phase 2:** Panel 3 — `pair-lab-report` edge function + AI quant note saved to `reports`.
3. **Phase 3:** "Apply to playbook" hand-off — opens the existing Playbook Assistant prefilled with the recommended SL/TP/risk for that symbol×session, so changes flow into your rules instead of staying in a report.

I'd ship Phase 1 first so we can sanity-check the recommendations against real trades before wiring the AI.

## Out of scope
- Capturing MFE/MAE automatically from M1/tick data (currently manual via custom fields — separate effort if you want it auto-filled).
- Backtesting recommended parameters against historical data — different module (Strategy Lab already covers MT5 backtest HTML parsing).
- Per-user-fixed schema for the excursion fields (they stay in `custom_fields` for now).
