## Review of the current plan

The plan fixes six real symptoms, but three of them share one root cause it doesn't name, and the "journaled vs everything" idea you raised is the missing structural piece.

**What holds up:** the citation rule, the unassigned bucket, the recency window, and the funded-account simulator are all correct and needed.

**Where it stops short:** it patches each tool one at a time. That's the same pattern that produced the gap in the first place — every tool hand-rolls its own filter, computes stats in TypeScript, and hands the model a bag of numbers with no provenance. So:
- Wrong numbers (63.8% vs 59.0%) aren't a rounding bug — the model is free to re-narrate figures because nothing marks them as immutable facts.
- Fabricated quotes aren't a prompt failure alone — prose and statistics arrive in the same undifferentiated blob, so quoting and inventing look identical to the model.
- The 355 unlabeled trades aren't one missing bucket — *every* tool silently defines its own population, so "your edge" means a different set of trades in each answer.

---

## Revised architecture

### A. Trade tiers — make "journaled" a first-class concept

Your database contains two different things that the Coach currently averages together:

| Tier | Definition | Your data |
|---|---|---|
| `journaled` | has a playbook **and** a `trade_reviews` row | the +0.456R NY Continuation world |
| `partial` | playbook or review, not both | mixed |
| `raw` | broker-synced, never journaled | 355 trades, **-49,777**, 34% WR |

Add a `journal_trade_tier` SQL view deriving this tier per trade. Every cohort the Coach builds defaults to **`journaled` + `partial`**, because that's the trading you actually intend to do — and every single answer returns the `raw` tier's size and P&L alongside, as a mandatory "what you're not counting" line.

This directly answers your question: yes, the Coach should analyze journaled data for *edge*, but it must never hide the unjournaled block, because that block is where your money goes. Silently excluding it would make the Coach more wrong, not less.

### B. One cohort engine, not nine tools

Replace the per-tool SQL with a single RPC:

```
journal_cohort(filters) -> { trades, stats, coverage, provenance }
```

Filters: tier, playbook, symbol, session, direction, date window, note-text match, semantic match. Every existing tool (`getPlaybookStats`, `getBreakdown`, `searchTrades`, `analyzeCohort`, `getRecentPerformance`) becomes a thin preset over this one call. One definition of a population, one definition of expectancy, computed in SQL — the model never sees raw rows it could average itself.

### C. Fact blocks — statistics the model may quote but not compute

Every cohort result returns a `facts` array of pre-rendered, immutable strings with ids:

```
f1: "NY Continuation | journaled | 90d | n=50 | WR 60.0% | avg 0.458R"
f2: "raw tier | 90d | n=151 | WR 27.8% | avg -0.391R | -18,412"
```

System prompt: numbers may appear in the answer **only** as verbatim copies of a fact string, tagged with its id. No arithmetic, no rounding, no combining. This kills the 63.8% class of error mechanically rather than by asking the model to be careful.

### D. Quote blocks — prose the model may cite but not paraphrase as evidence

Same treatment for notes: `searchJournal` returns `q1..qn` with `note_key`, trade id, date, and verbatim body. Quotation marks are only permitted around a `q*` body, tagged with its key. If no `q*` supports a psychological claim, the Coach must write "no journal note supports this." That is exactly the guardrail the June 15 / July 8 fabrications bypassed.

### E. Sufficiency gate before advice

Cohort results carry `confidence`: `n < 10` → `anecdotal`, `n < 30` → `indicative`, else `established`. The prompt forbids prescriptive language ("trade exclusively", "stop immediately") on anything below `established`. XAUUSD's +1.38R over 6 trades was sold to you as a rule; it's a hint.

### F. Account and challenge math (as planned, unchanged)

- `getRiskProfile` — realized R distribution, consecutive-loss runs, worst drawdown in R and currency.
- `simulateChallenge({ balance, maxDd, target, riskPerTrade, accounts, rotateOnLoss })` — reuses the existing prop-firm Monte Carlo, driven by the **journaled-tier** R distribution, and reports pass probability for one account and for the 5-account rotation. Your 2000 DD / 3000 target / 250-400 risk plan becomes a number instead of encouragement.
- `getSessionBreakdown` — clock-time expectancy, so "only NY" is verified independently of playbook labels.
- `getExecutionQuality` — checklist adherence vs outcome, which is the only honest basis for process-over-outcome coaching.

### G. Verification

Extend `coachTools_test.ts`: assert every stat in a tool result exists as a `facts` entry; assert `coverage` is non-null on every cohort; assert tier totals reconcile to the full trade count; assert simulator probabilities are bounded. Then replay your exact conversation and diff every figure against direct SQL — the NY Continuation line must read 61 / 59.0% / +0.456R.

### Technical notes
- New: one migration for `journal_trade_tier` view + `journal_cohort` and `journal_facts` RPCs (read-only, security definer, `auth.uid()`-scoped).
- Rewrite: `supabase/functions/_shared/coachTools.ts` — tools become presets over the cohort RPC; add the four account/process tools.
- Update: `supabase/functions/coach-chat/index.ts` — fact/quote citation contract, tier disclosure rule, sufficiency gate.
- `npm run quant:sync` to vendor the Monte Carlo module (repo-root `shared/` imports break edge deploys).

### Deliberately out of scope
Backfilling playbooks onto the 355 raw trades. It's the highest-value thing you could do for every future answer, but it's data entry, not architecture — I'd add a Journal bulk-assign flow as a separate follow-up.
