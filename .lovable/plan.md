# Coach: fix the broken data layer first

## Diagnosis (verified against the live schema, not inferred)

The Coach isn't limited by design — its tools query **columns that don't exist**, so PostgREST errors and the model answers from thin air.

| Coach queries | Real column |
|---|---|
| `trades.outcome` | absent — derive from `net_pnl` |
| `trades.r_multiple` | `r_multiple_actual` |
| `playbooks.archived` | `is_active` |
| `session_definitions.days` | absent |
| `trade_comments.body` | `content` |
| `ai_reviews.summary/strengths/weaknesses/recommendations` | `technical_review`, `mistake_attribution`, `psychology_analysis`, `actionable_guidance` |
| `user_settings.timezone` / `base_currency` | `display_timezone` / absent |

That breaks `getUserContext`, `searchTrades`, `getTradeDetail`, `getRecentPerformance`, `getPlaybookStats` — i.e. every factual tool.

Same bug in `_shared/coachEmbed.ts`, which is why `trade_embeddings` has **0 rows** while `coach_embed_queue` holds **66** pending jobs: every drain fails, so `recallSimilarTrades` silently falls back to "here are your last 5 trades". That fallback is also why the failure was invisible.

Screenshots: 159 reviews have them, but `getTradeDetail` returns them as URLs inside a JSON blob. The model is vision-capable only for images you attach in chat, so it never actually looks at trade charts.

## The fix — three changes, no new architecture

**1. One shared trade projection, used everywhere.**
Add a single `TRADE_SELECT` + `normalizeTrade()` in `coachTools.ts` (real columns, `outcome` derived from `net_pnl`, `r` = `r_multiple_actual ?? r_multiple_planned`) and use it in all five tools *and* `coachEmbed.ts`. Today the same wrong column list is copy-pasted in six places — that duplication is the actual root cause, not the individual typos. Fix the shape once and the drift can't recur per-tool.

**2. Stop swallowing failures.**
- Tools return the error; the chat loop appends a one-line "tools that failed" note to the reply when any call errored. A broken tool must be visible, not degrade into vagueness.
- Delete the "no embeddings → show recent trades" fallback in `recallSimilarTrades`; return an honest `not indexed yet` so the model says so instead of pretending it recalled something.

**3. Let it see the charts.**
`getTradeDetail` returns screenshot URLs; the chat loop injects them as `image_url` blocks (cap 4/turn, `trade-screenshots` is already a public bucket). Include the review prose the user actually writes — `thoughts`, `mistakes`, `did_well`, `to_improve`, `psychology_notes`, comments — which is currently fetched but unusable because the joins error out.

## Then, and only then: two tools that add real quant capability

Deliberately not seven. Everything else (equity curve, drawdown, session/day-of-week breakdowns) is derivable by the model from `searchTrades` once it returns correct rows — adding pre-baked tools for each is surface area, not capability.

- **`getBreakdown(dimension)`** — expectancy / win-rate / sample grouped by symbol, session, weekday, hour, direction or emotional state. One tool, one parameter, replaces five hypothetical ones and guarantees the aggregation math is consistent.
- **`getOpenTrades()`** — live positions with SL/TP and R at risk. Not derivable from `searchTrades` (which filters `is_open = false`), so it's genuinely missing.

Skipping for now: Pair Lab, reports, notebook. Each is a separate data model and worth adding once you've seen the Coach work correctly with the journal — bolting them on before the base layer is verified repeats the mistake that got us here.

## Prompt changes (minimal)

Add to the system prompt: always state sample size with any stat, flag N < 20 as low-confidence, cite trade date + symbol. Raise `MAX_TOOL_STEPS` 8 → 12 so a multi-tool answer doesn't truncate. Nothing else — the existing prompt is good.

## Verification

- Deno test in `supabase/functions/coach-chat/` that runs every executor against a real user and asserts `ok: true`. This is the guard that would have caught the original bug, and it's ~40 lines.
- Drain the 66 queued embeddings and confirm `trade_embeddings` is non-zero and recall returns real matches.
- One live chat asking for a stat, a specific trade with a screenshot, and a fuzzy recall — check `tool_calls` in the reply show `ok: true`.

## Technical notes

- All tools stay service-role with hard `user_id` filtering; model args never determine ownership.
- Read-only. No migrations, no schema changes.
- `coach-uploads` keeps signed URLs; `trade-screenshots` is public so its URLs pass straight through.
