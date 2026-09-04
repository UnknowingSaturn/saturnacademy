# Fix duplicated EURUSD trades from the resync

## What I found (verified in the data)

Your 8:50 EURUSD entry is one broker position pair (tickets 11130801 / 11130802) on login **138743**. It produced **6 trade rows across 5 different accounts**, and only one pair grouped ("2 legs").

Three separate defects combined:

**1. The same deal was ingested three times under three different keys.**
The EA sends each deal from three sources — live event, open-position sync, and history sync — and the idempotency key carries the source prefix:

```text
MT5_138743_HolaPrime-_10150340_entry            (live)
MT5_138743_HolaPrime-_openpos_11130801_entry    (open position sync)
MT5_138743_HolaPrime-_history_10150340_entry    (history sync)
```

Same install, same login, same deal 10150340 — but three distinct keys, so dedup never fired and three trades were created.

**2. Those copies landed on the wrong accounts.**
The events arrived at 13:22:25–13:22:28, before the account row for login 138743 was created (13:22:30). With no account for the login, resolution fell back to a sibling account on the same install — and picked a *different* sibling each time (70573, 70581, 70561, 86021). Only the events after 13:22:30 hit the real 138743 account, which is why exactly one pair grouped: grouping is per-account, and the rest were scattered.

**3. A one-hour time skew between sources.**
The history-sync payload reported `broker_utc_offset: 2` while the live event reported `3`, for the same `server_time` of 15:50:52. So the same entry was stored as both 12:50:52Z and 13:50:52Z — that is the stray "9:50 AM" row in your table.

## The fix

**Canonical deal identity.** Build the idempotency key from `install_id : broker_login : deal_id (or position id) : event_type`, with the source prefix dropped, so live / open-position / history copies of one deal collapse into a single event. Add a unique index on the canonical key and normalise legacy keys during the switch.

**Never scatter a login's events across siblings.** When a known install sends a login with no account row yet, create the account for that login immediately (inheriting settings from a sibling as a template) and attach the event to it. A sibling account becomes a settings source only — never the owner of another login's trades.

**Single source of truth for broker time.** Convert `server_time` using the offset stored on the account, and only update that stored offset from live heartbeats (which measure it directly), ignoring the offset embedded in history-sync payloads. Backfilled rows then land on the same clock as live ones.

**Clean up today's mess.** Reassign the misattributed EURUSD rows to account 138743, delete the duplicate copies of deals 10150340 / 10150341 (keeping the live-sourced row of each), and re-run grouping so the entry shows as one trade with 2 legs.

## Technical notes

- `supabase/functions/_shared/` — canonical key builder used by `ingest-events`; migration for the unique index plus a backfill that rewrites existing prefixed keys.
- `accountResolver.ts` — replace the sibling-as-owner fallback with create-account-for-login; sibling stays as the settings template.
- Timestamp conversion moves to the stored `accounts.broker_utc_offset`; heartbeats remain the only writer of that column.
- Cleanup runs as data statements scoped to install `3cf4b051225143bf` and today's date, followed by `regroup_trades()`.
- Regression tests: three source variants of one deal produce one trade; an unknown login on a known install creates its own account rather than borrowing a sibling.
