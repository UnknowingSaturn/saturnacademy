
# Fix weekly reports + upgrade them with quant insights

## Part A — Fix the failing weekly (root cause)

The most recent weekly failed with `error_message = "No tool call returned by model"`. The scheduler ran `generate-report` with `google/gemini-2.5-pro` and strict `tool_choice: { function: "publish_sensei_report" }`. The gateway returned a non-empty completion but no `tool_calls` array — a known intermittent failure mode on the 2.5-pro path now that gemini-3 is the gateway default.

**Fixes in `supabase/functions/generate-report/index.ts → callSensei`:**

1. **Upgrade default models** (one-line each):
   - weekly / monthly → `google/gemini-3-pro-preview`
   - custom → `google/gemini-3-flash-preview`
   - rerun_sensei default → `google/gemini-3-pro-preview`
2. **Retry + fallback ladder.** Wrap the fetch in a small helper:
   - Try primary model (pro).
   - On `429`, sleep 2s and retry once.
   - On any non-2xx OR missing `tool_calls`, fall back once to `google/gemini-3-flash-preview`.
   - On 2nd missing-tool-call, try to parse the assistant's `message.content` as JSON (some models emit the structured output inline despite `tool_choice`) — accept if it validates against the tool schema shape.
   - Only then throw the original `"No tool call returned by model"`.
3. **Persist the actually-used model** in `sensei_model` (currently records the originally-chosen one even after fallback).
4. **Schedule-reports retry once** on transient 5xx from generate-report before writing `status: 'failed'` to `report_schedule_runs`.
5. **One-off backfill:** re-run the failed report `8528bf3b-…` via the rerun path so the user sees Saturday's report. Surface a one-click "Regenerate" affordance in the existing `ReportView` failure state (already partially there — wire it to the `rerun_sensei` action).

## Part B — Elite quant upgrade ("Pair Lab inside the report")

The Sensei narrative today sees clusters, psychology, and behavioral leaks but **none of the Pair-Lab quant primitives** that already power the Strategy Lab (bucket MFE/MAE in R, ideal-SL drift, TP-hit distribution, strategy-replay expectancies, Kelly-sized risk, prop-firm DD constraints). We bolt those into the report so weekly/monthly recaps include the same elite advice the user gets in the Pair-Lab tab — automatically.

### B1. Port the quant primitives to a shared Deno module

Create `supabase/functions/_shared/quant/` with three slim files (logic copy-paste from the audited client libs — no recomputation drift):

- `symbolMapping.ts` — `classifySymbol`, `tickSizeForSymbol`, `pipSizeForSymbol` (≈30 lines).
- `pairLabMath.ts` — `quantile`, `median`, `bootstrapMeanCi`, `quarterKellyPct`, `normalizeSession`, `buildBuckets`, `computeBucket`, `tp1StarFor` (only the pure-functional pieces — no React-y wrappers).
- `pairLabSimulator.ts` — `slDistanceTicks`, `tradeMaeR`, `idealSlScaleFor`, `replayBucket`, `STRATEGY_PRESETS`, `MIN_ELIGIBLE_SAMPLE`, `TRAIL_CAPTURE_FRAC`.

Same unit conventions as the client (MAE/ideal-SL are ticks from TradingView; convert per-trade to R via `|entry − sl_initial| / tickSize`). MFE stays as R. Self-test the port with a Deno test that loads ~5 known trades and asserts the bucket numbers match the client output.

### B2. Compute per-report quant blocks

In `generate-report/index.ts`, after the existing `metricsBlock` / `clusterTrades`:

- **Bucket leaderboard** — call `buildBuckets` on the period's trades. Keep top 3 + bottom 3 buckets (by `expected_r × n`). Per bucket: `n`, `winRate`, `expectedR`, `expectedRCi`, `mfeP75 (R)`, `maeP75 (R)`, `slDrift` (`too_wide` / `too_tight` / `aligned`), `mostCommonTpHit`, `tp1Star`, `suggestedRiskPct`. This is the source of "Gold London is leaving 0.6R on the table — TPs are hitting at 1.2R but MFE p75 is 2.1R, trail or partial higher" insights.
- **Strategy replay** — run `replayBucket` over all `STRATEGY_PRESETS` against the period's trades (Hybrid mode — same as the Ranker by default). Capture `expectancyR`, `winRate`, `n_eligible`, and the **delta vs `current`** preset. Surface the top 2 presets that beat current by ≥ 0.15R/trade.
- **Coverage gauges** — `loggedMaeCoverage`, `loggedMfeCoverage`, `slCoverage` (% trades with `sl_initial + entry_price`). Drives the "we couldn't analyze 40% of your trades — fill SL on these N" advice.
- **Prop-firm context** (optional) — if any account has `firm_name + max_drawdown_dollars`, pass it through so `suggestedRiskPctPropFirm` and `bindingConstraint` are computed and the LLM can recommend a DD-aware risk %.

All of the above is **deterministic** and stored on the report row in a new `quant: jsonb` column. The LLM cites it, never recomputes it.

**Migration:** `ALTER TABLE public.reports ADD COLUMN quant jsonb;` (no RLS / grant changes — `reports` already has them).

### B3. Add a 6th coaching section: "The Math"

Extend `callSensei`:

- Add `quant` to the userPrompt block.
- Bump the tool schema `sections` min/max from 5/5 → 6/6 and require a 6th heading **"The Math"** that calls out: best/worst bucket by edge, the single highest-leverage parameter change (tighten SL / trail higher / scale risk to Kelly-fraction), and any strategy preset that demonstrably beats current behavior. Hard rule: every claim must reference one of the deterministic quant numbers we just supplied — no recomputation, no invention.
- New banned phrase: "based on my analysis" (we already ban hedging openers).

### B4. New `quant_advice` tool-call block (parallel to narrative)

In addition to "The Math" prose, ask the model to emit a structured `quant_advice` array (already strict-tool-call infra) so the UI can render it as chips/cards even if the prose is short:

```ts
quant_advice: Array<{
  bucket_label: string;        // "London / Gold"
  finding: string;             // "MFE p75 2.1R but most common TP hit 1.2R — leaving 0.9R"
  parameter: "sl" | "tp" | "risk" | "strategy";
  current_value: string;
  suggested_value: string;
  expected_uplift_r: number;   // from replay or tp1Star math
  confidence: "high" | "medium" | "low";
  cited_trade_ids: string[];
}>
```

Persisted on `reports.quant.advice`. Surfaced in `ReportView.tsx` as a new "Quant findings" card above "Sensei notes" (reuse `RecommendationCard.tsx` styling).

### B5. UI surface in `ReportView.tsx`

- Render the new "The Math" section inline with the other 5 (already loops over `sensei_notes.sections`).
- Add a **Quant Findings** Card above Sensei Notes: list `quant_advice` rows with current → suggested, confidence pill, expected uplift in R, citation chips (reuse `CitedTradeChip`).
- Add a **Bucket Leaderboard** mini-table (top 3 / bottom 3) below the Sensei sections — column set: bucket, n, winRate, expectedR ± CI, MFE p75 R, MAE p75 R, SL drift. Click-through to `/pair-lab` with the bucket preselected.
- Coverage banner if `slCoverage < 0.7`, mirroring the existing PairLab banner: "N trades skipped from quant analysis — fill SL/entry on these to unlock more advice."

### B6. `types/reports.ts`

Add:

```ts
export interface QuantAdvice { /* shape above */ }
export interface QuantBlock {
  buckets_top: BucketSummary[];
  buckets_bottom: BucketSummary[];
  strategy_replay: Array<{ preset_id: string; expectancy_r: number; win_rate: number; delta_vs_current: number; n_eligible: number }>;
  coverage: { sl: number; mfe: number; mae: number };
  prop_firm: PropFirmInput | null;
  advice: QuantAdvice[];
}
export interface Report { /* … */ quant: QuantBlock | null; }
```

### B7. Hybrid vs Strict in reports

Use **Hybrid** (per-preset native eligibility) to match what the Lab shows by default — strict-intersection too often collapses sample size below `MIN_ELIGIBLE_SAMPLE = 10` over a single week. We surface `n_eligible` so the LLM can soften when small.

## Files

- `supabase/functions/_shared/quant/symbolMapping.ts` *(new)*
- `supabase/functions/_shared/quant/pairLabMath.ts` *(new)*
- `supabase/functions/_shared/quant/pairLabSimulator.ts` *(new)*
- `supabase/functions/_shared/quant/quant_test.ts` *(new — port sanity)*
- `supabase/functions/generate-report/index.ts` — model upgrade + fallback ladder, quant compute, 6th section, `quant_advice` tool field, persist `quant`
- `supabase/functions/schedule-reports/index.ts` — single-retry on 5xx
- `src/types/reports.ts` — `QuantBlock`, `QuantAdvice`, `Report.quant`
- `src/components/reports/ReportView.tsx` — Quant Findings card, Bucket Leaderboard table, coverage banner
- *Migration* — `ALTER TABLE public.reports ADD COLUMN quant jsonb;`
- *One-off* — re-run failed weekly `8528bf3b-…` via `rerun_sensei`

## Out of scope

- Backfilling old reports with `quant` data (would need a separate batch job — we leave `quant = null` on historical reports and gate the new UI behind `report.quant != null`).
- Changing the Pair-Lab client math — the Deno port mirrors the audited client logic exactly.
- Adding per-account prop-firm fields if not already on the `accounts` table; we read what exists and degrade gracefully.

## Risks

- LLM occasionally still misses a tool call — mitigated by the flash fallback + inline-JSON parse.
- Porting math twice (client + Deno) risks drift; mitigated by the `quant_test.ts` self-test on known fixtures and a comment in both files referencing each other.
- Adding a 6th section grows token usage by ~25%; gemini-3-pro-preview handles it comfortably and is the gateway default.

