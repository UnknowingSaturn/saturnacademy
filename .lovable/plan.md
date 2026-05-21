## Goal

Adapt the markov-hedge-fund-method to your scalping workflow as a **gradual data-collection flywheel**, keeping the skill's core math (transition matrix + stationary ranking) untouched. Swap only the state labeller so it consumes whatever you tag on trades today — and unlocks finer granularity automatically as you log more.

## Approach

1. **Skill stays intact.** No edits to the matrix/stationary code.
2. **New thin labeller** turns each journaled trade into a `context_key` tuple from whichever fields are present (`session`, `playbook_id`, `htf_bias`, `volatility_regime`, plus any `custom_fields` you've tagged). Dimensions are auto-discovered — nothing hardcoded to FVG/HVN/LVN.
3. **One edge function + two Strategy Lab tools** expose the result to the Lab AI and to a small report view.
4. **Verdict policy: Conservative (A) default, UI toggle to Aggressive (B).**

## What gets built

### Edge function — `supabase/functions/scalp-edge-analysis/index.ts`

Inputs: `{ playbook_id?, symbol?, lookback_days?, min_samples?, mode: "conservative" | "aggressive" }`

Pipeline:
- Pull closed trades for the user (+ joins to `trade_reviews`, `trade_features`, `playbooks`).
- Labeller emits `context_key` per trade from present fields only.
- Feed into the skill's existing matrix + stationary code (vendored, unmodified).
- For each cell compute `n`, `win_rate`, `expected_R`, `wilson_low`, `verdict`.
- Verdict thresholds:
  - **Conservative (A, default):** `n ≥ 20` and `wilson_low > 0` → GO; `expected_R < 0` and `n ≥ 20` → SKIP; else REVIEW.
  - **Aggressive (B):** `n ≥ 8` and `expected_R > 0` → GO; `expected_R < 0` and `n ≥ 8` → SKIP; else REVIEW.
- Compute `suggested_next_tag`: the unfilled dimension whose addition would most reduce variance across your top playbooks (simple info-gain heuristic).
- Optional vision pass (gated): only for cells with `n ≥ min_samples`, send up to 5 winner / 5 loser screenshots from `trade_screenshots` to Gemini 2.5 Pro for a short "what's different" note. Cached per context hash.

Output JSON:
```text
{
  dimensions_detected: string[],
  cells: [{ context, n, win_rate, expected_R, wilson_low, verdict, note? }],
  coverage_pct,                 // % trades in confident cells
  suggested_next_tag: string,
  mode: "conservative" | "aggressive"
}
```

### Strategy Lab tools (registered in `supabase/functions/strategy-lab/index.ts`)

- `scalp_edge_report({ playbook_id?, symbol?, lookback_days?, mode? })` — full table.
- `scalp_context_lookup({ context })` — single verdict for the setup you're considering now.

### UI

- `src/components/strategy-lab/ScalpEdgeReport.tsx` — sortable table, verdict chips, toggle for **A ⇄ B**, "show low-confidence cells" toggle, and a one-line `suggested_next_tag` banner.
- Render it as a tool-result block inside `StrategyChat.tsx` via the existing `AppliedChangeCard` pattern.

## Why this is the gradual-collection flywheel

- Every new journaled trade adds one row to the matrix — no extra workflow.
- Coarse cells light up first; fine cells unlock as `n` grows.
- The "suggested next tag" tells you which field to start filling in to unlock the next layer of granularity.
- Vision pass amortises — same context → cached note.

## Out of scope

- No new DB tables, no migrations.
- No edits to the skill's matrix/stationary code (only the labeller is swapped).
- No live price feed, no MQL5 changes.
- No assumption about which custom fields are "the right" ones — auto-detected from your data.

## Files

- `supabase/functions/scalp-edge-analysis/index.ts` (new, ~300 lines)
- `supabase/functions/strategy-lab/index.ts` (register two tools, ~40 added lines)
- `src/components/strategy-lab/ScalpEdgeReport.tsx` (new)
- `src/components/strategy-lab/AppliedChangeCard.tsx` (small case for the new tool result)
