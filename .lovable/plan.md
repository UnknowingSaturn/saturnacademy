## Verdict on the previous plan

It fixes the immediate complaint (screenshot descriptions unreachable) but not the root cause. Two structural problems remain:

1. **Per-question tools over JSON blobs.** Every Coach capability is a hand-written query against `trade_reviews.mistakes`, `.screenshots`, `trade_comments.content`, etc. Adding `searchJournalText` makes it seven bespoke queries instead of six. The next unanswerable question needs an eighth.
2. **Trade-level embedding granularity.** `buildTradeContent` concatenates header + mistakes + did_well + psychology + up to 1500 chars of AI review into **one** vector. A 12-word screenshot caption ("price found value about the previous HVN to continue higher") is diluted to near-invisibility in that blob. Backfilling 503 trades at this granularity improves coverage but not precision — recall would still miss the exact phrasing you asked about.

Verified facts behind this: 159 reviews carry screenshot arrays with `description` + `timeframe`; `trade_embeddings` holds 11 rows against 177 reviews with prose; `coach_embed_queue` is empty (backfill never enqueued); `coachEmbed.ts` never reads the `screenshots` column at all.

## Redesign: one retrieval layer, note-level granularity

### 1. `journal_notes` — a normalized prose surface
A view (materialized only if it measures slow) that explodes every piece of user prose into one row per note:

```
trade_id | user_id | source        | field         | label   | body | occurred_at
         |         | review        | mistakes      | –       | ...  |
         |         | screenshot    | description   | 4H      | ...  |
         |         | comment       | content       | –       | ...  |
         |         | ai_review     | technical     | –       | ...  |
```

Screenshots unnest from the JSONB array so `timeframe` becomes a real, filterable column. One definition replaces the copy-pasted JSON traversal in `coachTools.ts` **and** `coachEmbed.ts` — the exact duplication that caused the earlier `trades.outcome` class of bug.

### 2. Hybrid search on that surface
- `tsvector` GIN index (English) for keyword recall, plus `pg_trgm` for fuzzy/misspelled terms like "HVN"/"hvn zone".
- Embeddings move to **note granularity**: `note_embeddings(note_key, trade_id, user_id, embedding)`, one vector per note instead of one per trade. Short chart captions become their own retrievable units.
- One RPC, `search_journal(user_id, query_text, query_embedding, filters, k)`, does reciprocal-rank fusion of keyword + vector hits and returns note + parent trade in a single round trip. Cosine ranking currently happens in Deno over up to 1000 rows pulled from the DB (`tool_recallSimilarTrades`); this moves it into the index.

### 3. Cohort stats in SQL, not in the model
`journal_cohort_stats(user_id, query, filters)` returns n, win rate, expectancy, mean/median R, best/worst for the trades matching a search. This is what turns "avoid HVN reactions?" into a statistic instead of the single anecdote the Coach gave you. Sample size is returned as a first-class field so the model cannot quote a cohort without it.

### 4. Collapse the tool surface
Replace `recallSimilarTrades` (and absorb the ad-hoc prose paths) with:
- `searchJournal({ query, source?, timeframe?, symbol?, dateFrom/To, k })` — hybrid retrieval, returns matched snippet + field + timeframe + normalized trade.
- `analyzeCohort({ query | trade_ids, groupBy? })` — stats for that cohort.

`getTradeDetail`, `getBreakdown`, `getOpenTrades`, `searchTrades`, `getPlaybookStats`, `getUserContext` stay as-is. Net tool count is unchanged, but the prose path is now one indexed surface rather than N hand-written traversals.

### 5. Backfill, properly
Enqueue every trade with any `journal_notes` row (~177+, vs 11 embedded today) and drain in batches until pending is zero. Because notes are hashed individually, re-embedding after an edit only re-embeds the changed note, not the whole trade.

### 6. Prompt + guardrails
- System prompt: screenshot captions and timeframes are searchable; run `searchJournal` before ever saying a style can't be isolated; every cohort claim carries n; n < 5 is labelled anecdotal.
- Extend `coachTools_test.ts`: assert `journal_notes` returns screenshot rows for a known trade, that `searchJournal` on a phrase present in a caption finds it, and that `analyzeCohort` sample sizes match a direct SQL count. A schema drift then fails loudly instead of degrading answers silently.

## Cost of the redesign vs the patch

The patch is ~2 files + 1 migration. This is ~4 files + 3 migrations (view, indexes + note_embeddings table, RPCs) and one behavioural change: `recallSimilarTrades` is replaced, so its embeddings table is superseded by `note_embeddings`. No frontend changes; the new Coach UI renders the tool strip and citations unchanged. Trade screenshots keep flowing to the vision model via `getTradeDetail` — this plan adds the text layer that makes them findable in the first place.

**Recommendation: take the redesign.** The patch would need to be partly undone the first time you ask a question the seventh bespoke tool doesn't cover.
