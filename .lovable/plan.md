

# Best architecture for trade times — and why "Apply Timezone Correction" is a workaround, not a solution

## The actual industry-standard answer

**Always store UTC. Always display in the user's chosen timezone (default ET). Never store local time.**

This is what every serious trading platform does (TradingView, NinjaTrader, ThinkOrSwim, MT5 Terminal itself in its history reports). Display ≠ storage. The "broker server time" is a UI quirk — it should never bleed into your database.

You already have the right architecture in 80% of the system. The current breakage is in the legacy backfill path and an outdated assumption that `broker_utc_offset` is a static account-level constant.

## What's actually happening today (mapped end-to-end)

```
EA (broker server time)
  ├─ Auto-detects offset live: TimeCurrent() - TimeGMT()  → per-event correct, DST-aware
  ├─ Sends timestamp ALREADY converted to UTC: TimeCurrent() - brokerOffset*3600
  ├─ Sends broker_utc_offset PER event in raw_payload (already there!)
  └─ Sends server_time as a debug field
        ↓
ingest-events stores event_timestamp (UTC) + raw_payload.broker_utc_offset (per-event)
        ↓
trades.entry_time / exit_time = UTC (correct since EA did the math live)
        ↓
Frontend displays via formatToET() in ET — correct, DST-aware
```

So **for any trade ingested via the live EA**, times are already correct and DST-aware automatically. No correction needed.

The "Apply Timezone Correction" button only matters for two legacy cases:
1. CSV imports from MT5's history export (no per-event offset captured).
2. Old EA versions (pre-v3.00) that may have stored broker-local instead of UTC.

For these, applying a single static offset is wrong across DST boundaries — confirming your concern.

## Recommended architecture (the smart approach)

### Tier 1 — Live EA trades (already correct, no work needed)
Trust `event.event_timestamp` (UTC) and `raw_payload.broker_utc_offset` (per-event). Don't touch them. Don't expose a "correction" button for accounts whose trades came from the EA — there's nothing to correct.

### Tier 2 — CSV / historical imports (the real problem to solve)
On import, attempt to recover UTC at row level using the broker's known DST schedule, not a single offset:

- **Most MT5 brokers** run on one of two known schedules:
  - **EET/EEST** (UTC+2 winter / UTC+3 summer, switches with EU DST) — IC Markets, Pepperstone, FTMO, FXPro, most ECN brokers
  - **GMT/BST** (UTC+0/+1) — a few UK brokers
  - **Fixed UTC+3** (no DST) — some US-friendly brokers

- Store a `broker_dst_profile` enum on the account (`EET_DST`, `GMT_DST`, `FIXED_PLUS_3`, `FIXED_PLUS_2`, `MANUAL`).

- During import, look up the offset *for that specific timestamp's date* using the profile, not a single account-wide value. This handles DST correctly across mixed history.

### Tier 3 — Display layer (already correct)
`src/lib/time.ts` already does the right thing: stored UTC → display in `America/New_York`. Add a user setting `display_timezone` (default ET) so non-US users can switch to London/Tokyo/local.

## Architectural changes (concrete)

### A. Deprecate static `accounts.broker_utc_offset`
Keep the column for backward compat, but stop relying on it for new logic. Source of truth is now per-event `raw_payload.broker_utc_offset` (live EA) or per-date DST profile (imports).

### B. Add `accounts.broker_dst_profile` (enum)
Auto-detect on first EA heartbeat: observe `broker_utc_offset` over multiple events; if it switches between +2/+3 across EU DST dates → `EET_DST`. If constant → `FIXED_PLUS_N`.

### C. Rebuild "Apply Timezone Correction" as "Re-derive UTC times"
Two distinct modes, picked by data source:

**Mode A — EA-sourced trades:** No-op. Show toast: "Trade times for this account are auto-corrected by the live bridge — no manual correction needed." No backend call.

**Mode B — CSV-imported trades (no events row):** Show modal: "Pick your broker's timezone profile (EET/EEST, fixed UTC+3, etc.)". Then for each trade, compute the right offset *for that trade's date* (DST-aware) and write back UTC. Handles your mixed-DST history correctly with one click.

### D. Per-event preview in EditAccountDialog
Replace "Apply correction with offset N" with a 5-row preview table: `entry_time stored | broker_offset_at_event | UTC after correction | ET display`. User sees DST switches visually before confirming.

### E. Add `display_timezone` to `user_settings`
Default `America/New_York`. Wire `time.ts` formatters to read it. Lets EU/Asia users see local time without changing storage.

## What this fixes vs. the option-2/3 plan

| Concern | Date-range split | Per-event offset | This approach |
|---|---|---|---|
| Mixed DST history | User clicks twice | EA change required | Auto-handled via DST profile |
| Future trades stay correct | No (manual every time) | Yes | Yes (already works via EA) |
| CSV imports | Manual per range | N/A | Auto via DST profile |
| Confusing UX | Yes (two clicks) | Hidden | Single click, preview shown |
| Code complexity | Medium | High (EA + schema) | Low (one new column + lookup table) |

## Files

| File | Change |
|---|---|
| `supabase/migrations/<new>` | Add `accounts.broker_dst_profile` enum (`EET_DST`, `GMT_DST`, `FIXED_PLUS_3`, `FIXED_PLUS_2`, `MANUAL`); add `user_settings.display_timezone` text default `'America/New_York'` |
| `supabase/functions/restore-trade-times/index.ts` | Branch on data source: if events exist with `raw_payload.broker_utc_offset` → trust those (no-op or refresh from raw); if missing → use `broker_dst_profile` + per-trade-date DST lookup. Add IANA `Europe/Athens`-style resolution (built-in `Intl.DateTimeFormat` with `timeZone`) instead of fixed offset arithmetic |
| `supabase/functions/ingest-events/index.ts` | After N heartbeats, auto-set `broker_dst_profile` based on observed offsets; backfill column if `MANUAL` |
| `src/components/accounts/EditAccountDialog.tsx` | Replace single-offset input with profile picker + 5-trade preview table; hide "Apply correction" entirely for EA-sourced accounts (events exist) |
| `src/lib/time.ts` | Read `display_timezone` from user_settings hook; fall back to ET |
| `src/hooks/useUserSettings.tsx` | Expose `display_timezone` |

## Validation

1. EA-sourced account, mixed DST trades from 2023+2024 → no correction needed; all times already in correct ET.
2. CSV-imported account from IC Markets (EET) covering Mar 2024 DST switch → pick `EET_DST` profile → trades before Mar 31 use −2h, after use −3h, ET display correct on both sides.
3. User in London switches `display_timezone` to `Europe/London` → all journal/report times re-render in BST/GMT without DB change.
4. New broker with weird offset → `MANUAL` profile + numeric input still works as escape hatch.

