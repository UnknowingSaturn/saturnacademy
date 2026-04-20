

# Reports — your weekly/monthly trading sensei

Replace the widget-heavy Analytics page with **Reports**: long-form, periodic narrative analyses generated automatically every Saturday (weekly) and on the 1st of each month (monthly), grounded entirely in *your* journal data — no generic advice, no hallucinations.

## The vision in one paragraph

Every Saturday morning, a report is waiting for you. It opens with a one-line verdict — *"Your edge this week was London-session NAS shorts when calm; you bled it back on Friday revenge trades on EU."* Below: a narrative built from your trades, your reviews, your emotional notes, your screenshots — written like a senior trader debriefing you over coffee. Every claim cites a trade ID, a number, a date. Nothing is invented. At the bottom: *"Add a `time_since_last_loss` field to your journal — it would have flagged 4 of your 6 worst losses this month."*

---

## 1. What changes

### Remove
- Current widget grid on `/analytics` (overview cards, playbook table, symbol panel, session matrix, journal insights, day-of-week, risk panel, behavioral cards, AI insights blocks).

### Replace with
- **`/reports`** — a route that lists historical reports (weekly + monthly) in a left sidebar and renders the selected report as a long-form document on the right.
- The existing `Analytics` route redirects to `/reports`.

### Keep
- Dashboard widgets stay (they're the "live ops" view). Reports are the "post-game film".

---

## 2. Report types & cadence

| Report | Generated | Covers | Trigger |
|---|---|---|---|
| **Weekly Sensei** | Saturday 09:00 user-local | Mon–Fri of the week just ended | pg_cron → edge function |
| **Monthly Sensei** | 1st of month 09:00 user-local | Previous calendar month | pg_cron → edge function |
| **On-demand** | Manual | Any custom range | "Generate report" button |

Reports are persisted in a new `reports` table — generated once, read forever (cheap, no re-LLM cost).

---

## 3. The report structure (what makes it not generic)

Each report is a **living document** with these sections, every one grounded in computed metrics + cited trade IDs:

### Section 1 — The Verdict (1 sentence + grade)
Single line + letter grade (A–F). Example: *"B-. You proved your London short edge (avg +1.8R, 7 trades) but gave half of it back to two FOMO entries on Friday afternoon."*

### Section 2 — The Numbers That Matter
Compact table — only metrics that *changed materially* vs prior period. P&L, R, trade count, win rate, profit factor, expectancy, max drawdown, % of trades meeting checklist. Each cell shows delta vs prior week/month.

### Section 3 — What Worked (the edge)
**Bulleted, citation-rich.** Each bullet:
- *"London session, NAS100 shorts, calm/focused state → 7 trades, 6 wins, +12.4R total. Your highest-edge cluster this week."* [trades #1247, #1251, #1259...]

Computed by clustering trades on (session × symbol × emotion × playbook) and surfacing clusters with ≥3 trades AND positive expectancy.

### Section 4 — What Bled (the leaks)
Same structure, opposite sign. Each leak names the **specific behavioral pattern**, not the playbook:
- *"Trades opened within 30 min of a prior loss → 5 trades, 1 win, –4.2R. Revenge pattern. Worst offender: Friday 14:23 EUR long after the 13:51 NAS loss."* [trades #1264, #1271...]

### Section 5 — Consistency Audit
Computed metrics, narrative wrap:
- **Time discipline**: stddev of entry hour per session — high stddev = "you're trading outside your defined windows"
- **Pair concentration**: HHI on symbol distribution — flags over-trading one pair
- **Risk consistency**: stddev of risk_percent — flags variable sizing
- **Frequency drift**: trades/day vs your 90-day baseline — flags overtrading days

### Section 6 — Psychology Pattern Recognition
Cross-references `trade_reviews.emotional_state_before/after`, `psychology_notes`, `thoughts`, `mistakes` arrays:
- Top 3 emotional states by frequency this period + their avg R
- Most common phrase from `mistakes` array (lemmatized) + cost in R
- Emotion → outcome correlations (only if n≥5 per state)
- Identifies "tilt sequences": runs of ≥3 trades after a loss with deteriorating reviews

### Section 7 — Sensei's Notes (the LLM section)
**This is the only LLM-generated free-form text.** Strict prompt:
- Receives ONLY the precomputed metrics + every trade's review text + a ban-list of generic phrases
- Must produce 3–5 paragraphs of *coaching*, each citing specific trade IDs and numbers from the input
- Tool-call-style structured output: `{ sections: [{ heading, body, cited_trade_ids[] }] }` — we then render with markdown and link trade IDs to the journal
- Anti-hallucination guardrails (see §5)

### Section 8 — Journal Schema Suggestions
The killer feature. Computed, not LLM-guessed:
- Inspects the user's `user_settings.live_trade_questions` and current trade columns
- Cross-references with patterns the report *couldn't fully explain* due to missing data
- Example: *"4 of your 6 worst losses had no `news_risk` field set, but their entries cluster within 15 min of red-folder NFP/CPI windows. Add a 'pre-news entry' boolean to your live questions."*
- Or: *"You journal `mistakes` consistently but never tag the underlying *cause* (technical vs psychological). Adding a 'mistake_category' select would let next month's report attribute leaks more precisely."*

### Section 9 — Goals for Next Period
3 concrete, measurable, behavioral goals derived from the leaks. Not "trade better" — *"Reduce post-loss trades opened within 30min from 5 to ≤1"*. These get persisted and the next report grades whether they were met.

---

## 4. Architecture

### Database (new migration)

```sql
-- reports table
create table reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  account_id uuid,                        -- null = all accounts
  report_type text not null,              -- 'weekly' | 'monthly' | 'custom'
  period_start timestamptz not null,
  period_end timestamptz not null,
  generated_at timestamptz default now(),
  
  -- precomputed metrics (jsonb so we can evolve)
  metrics jsonb not null,                 -- §2 numbers + deltas
  edge_clusters jsonb not null,           -- §3 what worked
  leak_clusters jsonb not null,           -- §4 what bled
  consistency jsonb not null,             -- §5
  psychology jsonb not null,              -- §6
  
  -- LLM section
  sensei_notes jsonb,                     -- structured: [{ heading, body, cited_trade_ids }]
  sensei_model text,                      -- 'google/gemini-2.5-pro'
  
  -- Recommendations
  schema_suggestions jsonb,               -- §8
  goals jsonb,                            -- §9 (with status field)
  prior_goals_evaluation jsonb,           -- did last period's goals get met?
  
  verdict text,                           -- §1 one-liner
  grade text,                             -- 'A'..'F'
  
  status text default 'completed',        -- 'generating' | 'completed' | 'failed'
  error_message text
);

-- RLS: user_id = auth.uid() (standard pattern)

-- report_schedule_runs (idempotency for cron)
create table report_schedule_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  report_type text not null,
  period_start timestamptz not null,
  attempted_at timestamptz default now(),
  status text not null,                   -- 'success' | 'failed' | 'skipped_no_trades'
  unique (user_id, report_type, period_start)
);
```

### Edge functions

- **`generate-report`** — given `{ user_id, period_start, period_end, report_type }`:
  1. Pull trades + reviews + playbooks + user_settings for the window
  2. Compute all sections 2–6 + 8 deterministically (extends existing `trade-analytics` aggregations — reuse `computeBehavioralAnalytics` etc.)
  3. Build the strict LLM context and call **Lovable AI (`google/gemini-2.5-pro`)** for §7 + §1 verdict + §9 goals — using **tool-calling for structured output** (no JSON-in-text parsing)
  4. Validate every cited trade ID exists in the input set; strip any that don't (anti-hallucination)
  5. Insert into `reports`, return the row
  6. Streaming optional but not required — generation runs in background

- **`schedule-reports`** — invoked by pg_cron every hour. For each user:
  - If it's Saturday in their broker tz and a weekly hasn't been generated for the just-ended week → enqueue
  - If it's the 1st of the month in their broker tz and a monthly hasn't been generated → enqueue
  - Calls `generate-report` per user; uses `report_schedule_runs` for idempotency

### pg_cron

One hourly job calling `schedule-reports`. Per-user timing handled inside the function so we don't fan-out cron jobs.

### Frontend (`src/pages/Reports.tsx`)

- Left sidebar: list of past reports grouped by year → month → week, badges show grade
- Right pane: rendered report (sections 1–9) using `react-markdown` for `sensei_notes.body`
- Header: "Generate report now" button → opens dialog with date-range + type picker → calls `generate-report` directly with `report_type='custom'`
- Each cited trade ID is a clickable chip → opens the trade in the Journal panel
- Empty state: "Your first weekly report will be ready Saturday morning."

### Sidebar nav

`Analytics` link renamed to **`Reports`**, route changed `/analytics` → `/reports`. Old Analytics page deleted along with `useTradeAnalytics` hook (the underlying `trade-analytics` aggregation logic is moved into `generate-report` since it's the only consumer left).

---

## 5. Anti-hallucination guardrails (your "no generic advice" requirement)

1. **Structured output via tool-calling** — LLM cannot return prose; must fill a typed schema. Generic filler has nowhere to go.
2. **Citation requirement** — every `body` paragraph must include `cited_trade_ids[]`; we strip paragraphs with zero citations or unknown IDs.
3. **Numeric grounding** — system prompt forbids any percentage / R-value / count not present in the precomputed metrics object passed in.
4. **Banned phrases list** — "stay disciplined", "trust the process", "manage risk", "you got this", "trading is a journey", "consistency is key", etc. Post-process strips any paragraph containing these.
5. **Sample-size gating** — same thresholds as today (no playbook judgment <10 trades, no "avoid X" <20 trades), enforced both in prompt and in a post-validation pass.
6. **Model**: `google/gemini-2.5-pro` for weekly/monthly (deeper reasoning, narrative quality), `gemini-2.5-flash` for custom on-demand (cost). User can override per-report.
7. **No invented entities** — playbook names, symbols, emotions all whitelisted from the input data; LLM-output values not in the whitelist are dropped.

---

## 6. The schema-suggestion engine (the cool bit)

Deterministic, runs server-side in `generate-report`:

```text
For each leak cluster in §4:
  attempt to attribute it to existing journal fields
  if attribution_confidence < 0.6:
    inspect what fields would have explained it
    propose: {
      missing_field: 'time_since_last_trade_minutes',
      reason: '4 of 6 worst losses lack timing context vs prior trade',
      example_trades: [...],
      proposed_widget: 'numeric input on live trade form'
    }
```

Suggestions appear in §8 with one-click "Add to my journal" — adds a question to `user_settings.live_trade_questions` (already-supported flow in `LiveTradeQuestionsPanel`).

---

## 7. File-by-file plan

| File | Action |
|---|---|
| `supabase/migrations/<ts>_reports.sql` | **NEW** — `reports`, `report_schedule_runs` tables + RLS |
| `supabase/functions/generate-report/index.ts` | **NEW** — full report builder + LLM + validation |
| `supabase/functions/schedule-reports/index.ts` | **NEW** — hourly per-user cadence checker |
| `supabase/config.toml` | Register both new functions |
| pg_cron | Insert hourly cron job (via insert tool, not migration) |
| `src/pages/Reports.tsx` | **NEW** — list + detail view |
| `src/components/reports/ReportSidebar.tsx` | **NEW** |
| `src/components/reports/ReportView.tsx` | **NEW** — renders sections 1–9 |
| `src/components/reports/SchemaSuggestionCard.tsx` | **NEW** — with "Add to journal" action |
| `src/components/reports/CitedTradeChip.tsx` | **NEW** — clickable trade ID |
| `src/hooks/useReports.tsx` | **REWRITE** — list/get/generate via `reports` table + edge fn (replaces current local-only hook) |
| `src/hooks/useTradeAnalytics.tsx` | **DELETE** |
| `src/pages/Analytics.tsx` | **DELETE** |
| `src/App.tsx` | Replace `/analytics` route with `/reports`; redirect `/analytics` → `/reports` |
| `src/components/layout/AppSidebar.tsx` | Rename "Analytics" → "Reports", icon `FileText` |
| `supabase/functions/trade-analytics/index.ts` | **DELETE** (logic absorbed into `generate-report`) |
| `src/types/reports.ts` | **NEW** — TS types matching jsonb shapes |

---

## 8. Validation

1. Backfill: hit "Generate report now" with a 30-day range → report appears with all 9 sections, no fabricated trade IDs, no banned phrases.
2. Cron: run `schedule-reports` manually on a Saturday → weekly report inserted, idempotent on re-run.
3. Schema suggestion → click "Add to journal" → new question appears in Live Trade panel.
4. Cited trade chip → opens trade in Journal panel.
5. Empty week (no trades) → `report_schedule_runs.status = 'skipped_no_trades'`, no report row.
6. LLM down/failed → row inserted with `status='failed'`, error message visible, retry button works.
7. Compare prior weekly's goals against current week's metrics → §9 shows "Met / Missed" badges.

---

## What this isn't

Not real-time, not a dashboard, not interactive widgets. It's a Saturday morning email-without-the-email — a thing you *read* once a week the way pros review tape.

