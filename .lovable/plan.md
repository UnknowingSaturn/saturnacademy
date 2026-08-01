
## Root cause

The previous plan treated this as "maybe a stale deploy". Looking again at the evidence, the deeper problem is architectural, and it explains the symptom without needing that guess.

Verified facts:
- `trades`: 503 rows, **16 tagged**, newest tagged `entry_time = 2026-07-13 14:31` — exactly the set written by the backfill migration. **Live ingest has never produced a single grouped row.**
- The untagged pairs are textbook siblings: EURUSD 2026-07-27 13:15:47, tickets 9270991/9270992, both `entry_price = 1.13833`, same account/direction; EURUSD 2026-07-22 11:26:39, 1.14031 / 1.14030. `events` shows both as `event_type = open`, `source = live_event`, ingested 0.9 s apart.
- Grouping lives in exactly one place: `supabase/functions/_shared/tradeEventProcessor.ts:253-297`, inside the `entry` branch, as a **read-then-write in application code**.

That single placement is the root cause, in three compounding ways:

1. **It only covers one of several insert paths.** Any row inserted into `trades` outside that branch — history import, `trade-rebuild`, `trade-repair`, snapshot repair, manually created idea/paper trades — is born ungrouped and stays ungrouped forever. Nothing reconciles it later.
2. **It's a race, not a transaction.** Leg B's sibling `SELECT` and leg A's `INSERT` are separate statements from separate function invocations 0.9 s apart. If either the read is stale or the query errors, grouping is silently skipped — the code discards the query's `error` and just falls through to `groupKey = null`.
3. **It's deploy-coupled.** Grouping correctness depends on a specific edge bundle being live. A redeploy that lags a code change silently disables it, with no signal anywhere. That's precisely the failure shape we're seeing: correct-looking code, zero results in production.

So: patching the epsilon or redeploying may or may not help today, and would leave all three weaknesses in place.

## Redesign: grouping becomes a database invariant

Move sibling grouping out of the edge function and into the database, where it runs for **every** insert path, inside the inserting transaction, with no deploy coupling.

**1. `public.assign_trade_group()` — BEFORE INSERT trigger on `trades`**

For each new executed row with an `account_id`:
- Take `pg_advisory_xact_lock(hashtext('trade_group:' || user_id || account_id || symbol || direction))` so concurrent leg inserts serialize instead of racing.
- Find the newest sibling: same `user_id`, `account_id`, `symbol`, `direction`, `entry_time` within ±30 s, `abs(entry_price - NEW.entry_price) <= greatest(NEW.entry_price * 0.0005, 0.0001)`.
- If a sibling has a `group_key`, adopt it. If it has none, stamp that sibling `group_key = sibling.id::text, group_role = 'leader'` and set `NEW.group_key` to it with `group_role = 'leg'`. If no sibling, leave both NULL (standalone).
- Skip when `trade_type <> 'executed'` (ideas/paper/missed never group) or when `group_key` is already supplied (so the backfill and any explicit regroup stay authoritative).

Uses the existing partial index `trades (user_id, group_key)`; add a supporting index on `(user_id, account_id, symbol, direction, entry_time)` so the sibling probe is an index scan, not a seq scan on 500+ (and growing) rows.

**2. `public.regroup_trades(_user_id uuid, _from timestamptz)` — idempotent reconciler**

Same predicate expressed set-wise (the corrected partitioned-window logic from `20260713165753`), operating only on `group_key IS NULL` rows. This is one function used for three jobs: the historical backfill, a safety net after bulk imports (`trade-rebuild` calls it for the affected window), and a manual repair lever. Running it twice is a no-op.

**3. Strip the logic from the edge function**

Delete the sibling block from `tradeEventProcessor.ts` and stop passing `group_key`/`group_role` on insert — the trigger owns it. Net effect per entry event: **one fewer round-trip and one fewer conditional UPDATE**, and the processor's entry path gets simpler, not more complex. Keep the log line, reading the values back from the insert's `returning`.

**4. Backfill and verify**
- Run `regroup_trades` over all history to catch everything since 13 Jul (the 21–27 Jul EURUSD / NASUSD / XAGUSD / GBPUSD pairs) without touching the 16 already-tagged rows.
- Verify: tagged count jumps and each known pair shares one `group_key` with exactly one `leader`.
- Verify in the app: those rows collapse in the Journal with the `N legs` badge and cumulative R, and the detail panel headline aggregates.
- Insert a synthetic sibling pair directly into `trades` (bypassing ingest entirely) to prove the trigger fires on non-ingest paths, then delete the pair.
- Existing `groupedTrades` unit tests stay green; add a test asserting the client-side epsilon/window constants match the SQL ones so the two can't drift again.

## Why this is more efficient, not just different

- One code path instead of N insert paths each needing its own copy of the rule.
- Grouping is atomic with the insert — the 0.9 s race disappears structurally rather than being narrowed.
- One less network round-trip per entry event in the hot ingest path.
- No silent-failure mode: a trigger can't be "not deployed", and a failing predicate raises instead of falling through to NULL.

## Technical notes

- Window 30 s and epsilon `max(price * 0.0005, 0.0001)` are carried over unchanged, so trigger, reconciler, backfill and the client aggregator all agree.
- `group_key` stays the leader row's `id::text`; no schema change beyond the new supporting index — column, check constraint and partial index already exist.
- Rows remain unmerged: per-leg ticket, SL/TP, PnL and audit trail are untouched; grouping stays a presentation rollup in `useGroupedTrades` / `useTradeGroup`.
- Trigger is `SECURITY DEFINER` with `SET search_path = public`, and touches only `public.trades`.

## Out of scope

Ingest dedup and `awaiting_exit`/repair semantics, and how Pair Lab counts grouped legs (still one row per leg there) — unchanged by this plan.
