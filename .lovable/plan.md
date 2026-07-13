## Trade Journal — deep audit + multi-TP sibling fix

### 1. Root cause of the "duplicate" trades from your position sizer

Your MT5 position sizer opens **one broker position per TP leg**. Confirmed in your live data — for example on 2026‑07‑13 11:18:07 UTC, one GBPUSD sell setup produced three sibling rows:

```
ticket 8374948  lots 4.35  entry 1.33891
ticket 8374949  lots 4.35  entry 1.33891
ticket 8374950  lots 4.34  entry 1.33891
```

Same `account_id`, same `symbol`, same `direction`, same second, same price. To the broker these are three independent positions with distinct `position_id`/`deal_id`, so the ingest pipeline (correctly, at the broker layer) writes three `trades` rows. Everything downstream — Journal counts, win‑rate, avg R, exposure, prop‑firm daily‑loss, Pair Lab buckets — then treats one idea as N trades.

The recent dedup hardening (deal‑id guard) does **not** apply here: these are genuinely different deals, not duplicate deliveries of the same deal.

**Root‑cause fix:** introduce a non‑destructive *group key* that links sibling legs at ingest time, and teach the Journal + Pair Lab to present one logical trade per group while preserving per‑leg rows for auditing.

### 2. Journal audit — real issues found in code

Only items with concrete evidence in the current source. Nothing speculative.

| # | Severity | Where | Problem |
|---|---|---|---|
| J1 | **High** | `tradeEventProcessor.ts:139–144` | `existingTrade` lookup uses `.single()`. When no row exists this throws PGRST116 and the whole event fails; the intended "not found → create" branch is reached only because the surrounding code catches implicitly. Should be `.maybeSingle()`. |
| J2 | **High** | `tradeEventProcessor.ts:279–342` (orphan exit) | When no `raw_payload.entry_price` is present, entry price falls back to `event.price` (= exit price). That creates a fake $0‑move trade whose reported `net_pnl` still contains the broker's real profit — so the row's price fields lie while PnL is real. Should mark `repair_state='needs_entry'` and skip R‑multiple, instead of synthesising `entry_price = exit_price`. |
| J3 | Med | `Journal.tsx:133` | `setCurrentDate` writes `format(next, "yyyy-MM-dd")` in **local tz** then reads it back through `ensureUtcMs` (UTC). Users west of UTC clicking "next month" on the 1st jump two months. Format with UTC parts. |
| J4 | Med | `tradeEventProcessor.ts:351–352` | Partial-vs-full threshold `remainingLots > 0.001` is symbol‑agnostic. Micro‑forex 0.01‑lot closes on a 0.02‑lot position collapse to "full close". Use a per‑symbol epsilon (e.g. `min(0.5 * min_lot_step, 0.001)`). |
| J5 | Med | `tradeEventProcessor.ts:441–457` | R‑multiple recompute on full close uses `existingTrade.sl_initial || existingTrade.sl_final`. If SL was moved to BE mid‑trade, R at close no longer reflects the SL that was actually in force at the risk decision — but for MAE analysis you already use `resolveSlAtMae`. Split: keep `sl_initial` here (correct for planned‑R), but document that this is intentional. Add a comment; no code change. |
| J6 | Low | `useOpenTrades.tsx:19–48` | Realtime subscription invalidates on **every** trade write, then a `refetchInterval: 30000` runs anyway. Under a busy EA that is a lot of duplicate work. Drop the interval, or bump to 5 min as a pure safety net. |
| J7 | Low | `useTrades.tsx` | Uses `.range(offset, offset+999)` in a loop but every page re‑runs the full filter chain. Fine now; will not scale past ~25k. Already capped, keep. |
| J8 | Low | `Journal.tsx:277–370` (`filteredTrades`) | Advanced `activeFilters` re-runs `.filter` in a loop over each condition. Trivial for current volume. Keep. |
| J9 | Low | `tradeTransform.ts:114` | `row.accounts || row.account` — the `useOpenTrades`/`useTrades` `TRADE_SELECT` now uses aliased `account:accounts(*)`, so `row.accounts` never fires. Remove the fallback to make it obvious. |
| J10 | Low | `tradeEventProcessor.ts:161–164` | Modify update writes `sl_final`/`tp_final` only when `event.sl`/`event.tp` are **truthy** — a user setting SL=0 (removing SL) is silently dropped. Compare `!== undefined` and allow 0 as a real value (with a "SL removed" flag). |

Items that **look** wrong but are correct (verified against code):
- Aggregating gross_pnl from `events` on close instead of trade row — deliberate, prevents partial-fill double count (comment T‑10).
- `apply_equity_delta` only on close — matches "equity = balance for closed history" convention documented elsewhere.
- Symbol resolver applied in both Journal filter and `getTradeValue` — deliberate.
- `useTrades` `includeUnassigned: true` default — deliberate, matches Pair Lab.

### 3. Fix plan for the multi‑TP position sizer

Non‑destructive grouping, so you can still see and edit every broker leg.

#### 3a. Schema (one migration)

```sql
ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS group_key text,           -- deterministic hash
  ADD COLUMN IF NOT EXISTS group_role text           -- 'leader' | 'leg'
    CHECK (group_role IN ('leader','leg'));

CREATE INDEX IF NOT EXISTS trades_group_key_idx
  ON public.trades (user_id, group_key)
  WHERE group_key IS NOT NULL;
```

`group_key` format: `sha1('{account_id}:{symbol}:{direction}:{floor(entry_epoch/window)}:{round(entry_price/tick,0)}')` where `window = 30s`, `tick` = the symbol's price step (fall back to a symbol-class default when unknown). The first leg written wins `'leader'`, subsequent siblings become `'leg'`.

Migration then back‑fills existing rows in place using the same key, so your historical siblings collapse retroactively.

#### 3b. Ingest change (`tradeEventProcessor.ts`, ENTRY branch)

Before inserting the new open trade, look up any trade on the same `(user_id, account_id, symbol, direction)` opened within 30 s at a price within 1 tick and still `is_open = true`. If found, compute the same `group_key`, tag the new row as `group_role='leg'`, tag the existing row as `'leader'` if still null. **No merging** — separate `trades` rows are preserved so per‑leg TP/SL, per‑leg close PnL, and modification history stay accurate.

#### 3c. Journal presentation

Add a `useGroupedTrades()` selector layered over `useTrades()`:

- One card per `group_key` (or per row when `group_key` is null).
- Header shows aggregate: total lots, VWAP entry, aggregate net PnL, aggregate R (risk‑weighted by planned SL distance), earliest entry_time, latest exit_time, `is_open` = any leg open.
- Expand shows the underlying legs unchanged (existing `TradeDetailPanel` per leg).
- Filters (result, session, symbol, model) still key off the leader row.
- Table `net_pnl` and win/loss counts use aggregate.

Add a per‑user setting `journal.group_multi_tp_siblings` (default **on**). Off = current per‑leg view.

#### 3d. Pair Lab / Prop‑firm / Dashboard

They all read via `useTrades`. Route them through the same grouped selector guarded by the same setting so:

- Win‑rate, avg R, trade count = per‑group.
- Prop‑firm daily loss / Monte Carlo = per‑group aggregate PnL per broker‑day (unchanged formula, different rows).
- Kelly / OOS / walk‑forward = per‑group (a 3‑leg 3R idea is one sample, not three).

No math changes — only the row set changes.

#### 3e. Tests

- Unit: grouping helper — three rows same second, same price ± tick → one group with correct VWAP/aggregate PnL; four rows split across 40 s → two groups.
- Ingest: fixture with three sequential opens 5 s apart at 1‑tick spread → one `leader` + two `leg`.
- Regression: existing `serverReplayParity` and `kellyServerParity` suites must stay green (they don't touch grouping, but confirm nothing else moved).
- Backfill dry‑run script: report how many current rows collapse into groups per account, so you can eyeball the diff before applying.

### 4. Journal audit fixes (bundled with the same PR)

- J1: swap `.single()` → `.maybeSingle()` in `processEvent`.
- J2: orphan exit no longer synthesises `entry_price = exit_price`; sets `repair_state='needs_entry'`, leaves `entry_price` null, skips R‑multiple.
- J3: `Journal.tsx` date param uses `format(new Date(Date.UTC(y,m,d)), 'yyyy-MM-dd')` via UTC helpers.
- J4: per‑symbol epsilon for partial vs full.
- J6: drop the 30 s open‑trades poll; realtime already covers it.
- J9: remove `row.accounts` fallback in `transformTrade`.
- J10: modify branch treats `sl === 0` as "SL removed" (writes null + records modification).

### 5. Order of work

1. Migration (schema + backfill) — reversible, one edit.
2. Ingest changes + Journal audit fixes J1/J2/J4/J10 in one PR.
3. `useGroupedTrades` + Journal UI expandable rows + setting toggle.
4. Wire Pair Lab / Prop Firm / Dashboard to the grouped selector behind the same toggle.
5. Frontend cleanups J3/J6/J9.
6. Test pass + backfill dry‑run report.

### 6. Explicit non‑goals (won't do)

- Won't merge sibling rows into a single row (destructive, breaks per‑leg TP audit and the Trade Copier's per‑ticket tracking).
- Won't retro-edit already-closed sibling `net_pnl` values — they stay per leg; grouping happens at read time.
- Won't touch equity‑delta logic, snapshot repair, or the MT5 EAs.
