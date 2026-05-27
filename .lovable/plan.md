## Why some trades still say "Awaiting repair"

Looking at your DB: 5 trades are stuck. All sit on account `Hola Prime - 70561`, all marked `snapshot_closed`, none `repaired_*`. Two failure modes are mixed in:

**Mode A — repairable now, but repair looks in the wrong place (1 trade)**
Ticket `4453439` (EURUSD, 2026-05-26) has a real `close` event in `events`… but it was ingested against account `Hola Prime - 86021` (the login active on that install at the time), not against `70561` (where the trade row lives). `repair-snapshot-closed` filters events with `eq("account_id", account_id)`, so it never sees the close and the trade stays stuck forever.

**Mode B — genuinely awaiting MT5 reconnect (4 trades)**
Tickets `4147852`, `4067842`, `3426371`, `2955219` have **no** exit event anywhere — the EA never streamed history for them after the snapshot zeroed them out. These will only heal when you next log MT5 back into login `70561` (and `70583`/`76034` for any of theirs). That's expected behaviour; the issue is just that it's invisible to you per-trade.

There is also no automatic re-attempt: `repair-snapshot-closed` only runs when you click the button in DriftTray, and DriftTray only lists *currently open drifted* trades, not historical `snapshot_closed` ones — so once a trade falls into "Awaiting repair" it has no UI path back to healing.

## Plan

### 1. Fix `repair-snapshot-closed` to look across siblings on the same install
When searching `events` for an exit, also include events on **other accounts that share the same `mt5_install_id`** as the trade's account. If we find an exit on a sibling account, reassign the event-derived data and move the trade to the correct account if the deal's recorded account login matches a sibling. Specifically:

- Load the trade's account → its `mt5_install_id`.
- Look up sibling accounts (same `user_id`, same `mt5_install_id`).
- Query `events` with `.in("account_id", [self, ...siblings])` + `.eq("ticket", trade.ticket)` + `.in("event_type", ["close","partial_close"])`.
- On match: apply the repair fields as today, and if the exit event's `account_id !== trade.account_id`, also update `trade.account_id` to that sibling so the trade ends up filed under the right login. This is the only way to fix Mode A (ticket 4453439).

### 2. Auto-repair on ingest
In `ingest-events`, when a `close` / `partial_close` event arrives, after the normal processing also do a sweep: find any `snapshot_closed` trades on **any sibling account on the same install** with the same ticket and no `repaired_*` marker. If found, immediately apply the same repair logic (and reassign account_id if needed). This kills the race for free — no manual click required next time.

### 3. Per-trade visibility & manual trigger in Journal
Right now "Awaiting repair" is a dead-end pill. Add a small popover/tooltip on that badge in `TradeTable` that:

- explains *why* (snapshot from another login on the same install zeroed it out, exit not yet received),
- shows which login the snapshot came from (`partial_closes[0].account_login`),
- offers a **Try repair now** button that invokes `repair-snapshot-closed` for that trade's account (with the cross-sibling fix from step 1 this will resolve Mode A trades instantly).

For Mode B trades the same popover should say "Will heal automatically when MT5 next logs into login {X}" — i.e. honest about needing the reconnect.

### 4. Surface the stuck list in DriftTray
Extend `trades-drift` (and the dormant section of DriftTray) so users see a count of `snapshot_closed`-but-not-repaired trades grouped per dormant login, e.g. *"Hola Prime 76034: 1 trade awaiting MT5 reconnect"*. No new card needed — same DriftTray, new line.

## Technical notes

- Files touched: `supabase/functions/repair-snapshot-closed/index.ts`, `supabase/functions/ingest-events/index.ts` (close/partial_close branch only), `supabase/functions/trades-drift/index.ts`, `src/components/journal/TradeTable.tsx` (badge → popover), `src/components/journal/DriftTray.tsx` (extra line in dormant section).
- No schema change. No migration.
- Existing `idx_trades_snapshot_closed` index already supports the sweep queries.
- Backfill: after deploying, one click of "Try repair now" on ticket 4453439 will clear it; the other four require you to log MT5 back into the respective logins, which is the intended design.

## Out of scope

- Forcing the EA to re-pull deal history without an MT5 reconnect (would need a new EA RPC).
- Cross-broker repair (sibling lookup is scoped to same `mt5_install_id` only — safe).
