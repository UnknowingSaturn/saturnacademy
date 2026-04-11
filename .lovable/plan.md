

# Comprehensive Codebase Review — Findings & Plan

## Summary: Overall Health

The codebase is in **good shape** after the v3.00 EA refactor. Build is clean (no errors or warnings), both EA file copies are identical (checksums match), all database enums are aligned, and edge functions respond correctly. Below are the remaining issues found, organized by priority.

---

## Issues Found

### 1. Position Snapshot — Stale Trade Close Sets `total_lots: 0` Without PnL (MEDIUM)

**File:** `supabase/functions/ingest-events/index.ts` lines 279-286

When the position snapshot closes stale trades, it sets `total_lots: 0` and `exit_time: now()` but does NOT set `net_pnl`, `gross_pnl`, `exit_price`, or `is_open: false` fields correctly. The `exit_time` is set to "now" rather than the actual close time. This creates trades with `is_open: false` but no PnL data — they'll show as 0RR/0PnL in analytics.

**Fix:** When closing stale trades via snapshot, set `net_pnl: 0` explicitly and add a note in `raw_payload` that it was snapshot-closed. The actual PnL was already captured by the exit event (if it was sent by reconciliation). If not, mark the trade with a flag so the user knows the data is incomplete.

### 2. `BuildOpenPositionPayload` Is a Separate Function (LOW — Redundancy)

**File:** `mt5-bridge/TradeJournalBridge.mq5` lines 998-1080

The plan called for consolidating ALL payload builders into `BuildPayload()`. The `BuildOpenPositionPayload()` function still exists as a separate ~80-line function. It's used only by `SyncOpenPositions()` for currently open positions (which need position data, not deal data). This is technically justified since open positions don't have a deal ticket to pass to `BuildPayload()`, but it duplicates JSON construction.

**Fix:** Leave as-is — the separation is architecturally justified. Open position sync reads from `PositionGet*` functions while `BuildPayload` reads from `HistoryDealGet*`. Merging would add unnecessary complexity.

### 3. Browserslist Data Is 10 Months Old (LOW)

**Dev server log:** `caniuse-lite is 10 months old`

**Fix:** Run `npx update-browserslist-db@latest` to update. Non-functional, cosmetic warning only.

### 4. Leaked Password Protection Disabled (WARN — Security)

**Source:** Supabase linter

Leaked password protection checks passwords against known breach databases. Currently disabled.

**Fix:** Enable via Lovable Cloud auth settings (no code change needed — this is a project-level toggle).

### 5. No Google Sign-In (LOW — Best Practice)

The Auth page only supports email/password. Per project guidelines, Google sign-in should be offered unless explicitly excluded.

**Fix:** Add Google OAuth button to the Auth page and configure auth provider.

---

## Verified — No Issues Found

| Area | Status | Details |
|------|--------|---------|
| EA file copies in sync | OK | Both `mt5-bridge/` and `public/` have identical checksums |
| Build output | OK | Vite builds cleanly, no TypeScript errors |
| `NodeJS.Timeout` fix | OK | All instances replaced with `ReturnType<typeof setTimeout>` |
| Database enums | OK | `event_type` includes `modify`, `ea_type` includes `journal/master/receiver` |
| `ingest-events` edge function | OK | Returns 401 without API key, handles heartbeat/modify/snapshot events |
| RLS policies | OK | All tables have user-scoped RLS, no public read on sensitive data |
| Auto-timezone detection | OK | `GetBrokerUTCOffset()` uses `TimeCurrent() - TimeGMT()` with manual override |
| `equity_at_entry` fix | OK | Only sent for live entries, omitted for history sync |
| Binary search for dedup | OK | `IsDealProcessed()` uses binary search, `MarkDealProcessed()` inserts sorted |
| `OnTick()` removed | OK | Line 528 confirms removal |
| Log rotation | OK | `RotateLogIfNeeded()` at lines 1419-1467 |
| Queue integrity checksums | OK | Checksum added on write, validated on read |
| Graceful shutdown flush | OK | `OnDeinit()` calls `ProcessQueue()` |
| Heartbeat event | OK | Sends every N ticks with leverage, margin, EA version |
| SL/TP modification tracking | OK | `HandlePositionModification()` with cached value comparison |
| Spread capture | OK | `SymbolInfoInteger(symbol, SYMBOL_SPREAD)` in `BuildPayload()` and modify handler |
| Realtime subscription | OK | `useOpenTrades` subscribes to `postgres_changes` on trades table |
| Console errors | OK | No errors in dev server log |
| Edge function health | OK | All 13 functions deployed, `ingest-events` responds correctly |

---

## Recommended Actions

### Must Fix (1 item)
1. **Position snapshot stale close** — add `net_pnl: 0` and incomplete-data flag to snapshot-closed trades in `ingest-events`

### Should Fix (1 item)
2. **Enable leaked password protection** — toggle in auth settings

### Nice to Have (2 items)
3. **Add Google sign-in** to Auth page
4. **Update browserslist** — `npx update-browserslist-db@latest`

---

## Implementation Details

The only code change needed is in `supabase/functions/ingest-events/index.ts` (the stale trade close in the `position_snapshot` handler). The password protection and Google auth are configuration changes.

Shall I proceed with fixing the position snapshot handler and enabling leaked password protection?

