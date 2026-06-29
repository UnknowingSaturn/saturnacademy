# Phase T — Cross-Page Root-Cause Remediation

A read-only audit of every non-PairLab surface found 12 real defects (1 critical, 5 high, 4 medium, plus low-severity polish). They cluster around three root causes: (1) inverted streak iteration, (2) un-paginated Supabase queries silently capped at 1 000 rows, and (3) timezone handling that bypasses the user's settings.

## Critical

**T-1. Dashboard "current streak" returns the oldest run, not the current one.**
`src/hooks/useDashboardMetrics.tsx:54` loops `i = 0 → n` over ascending-sorted trades and breaks on the first direction change, so it reports the streak that *opens* the account history instead of the live tail. Reverse the loop (`i = sorted.length - 1; i >= 0; i--`).

## High

**T-2. Reports max-consecutive-wins/losses computed on reverse-sorted trades.**
`useReports.tsx:60` walks `filteredTrades` (newest-first from `useTrades`) without re-sorting. Sort ascending by `entry_time` before the loop. Same metric is surfaced by `ReportMetricsGrid`.

**T-3. `usePlaybookStats` silently capped at 1 000 trades.**
`usePlaybookStats.tsx:175` issues an unbounded `.select()` so every playbook win-rate, equity curve, avgR, profit-factor, and streak is wrong above 1 k closed trades. Apply the same paginated `.range()` loop used in `useTrades` (S4.1).

**T-4. `useArchivedTrades` silently capped at 1 000 rows.**
`useTrades.tsx:283`. Paginate the same way.

**T-5. `generate-report` edge function silently capped at 1 000 trades.**
Both primary trade queries in `supabase/functions/generate-report/index.ts` (~lines 1311 and 1483) lack `.range()`. Reports for active months render on truncated data. Add the paginated loop in both branches.

**T-6. `useOpenTrades` compliance check ignores user's session timezone.**
`useOpenTrades.tsx:72` calls `detectSessionFromUtc` which hardcodes `America/New_York` (`src/lib/time.ts:106`). UK/EU traders see false session-filter violations in the live compliance ring. Add a client `classifySession` that reads the user's `session_definitions` rows (already loaded by the edge function) and use it here.

## Medium

**T-7. Reports period boundaries use browser-local week/month.**
`useReports.tsx:37` compares UTC entry_time against `startOfWeek(new Date())` which is local-midnight. Non-UTC users get a 1-day boundary mismatch on the W/M/Q toggle. Compute boundaries in UTC.

**T-8. `schedule-reports` defaults `broker_utc_offset` to `+2` for unset accounts.**
`supabase/functions/schedule-reports/index.ts:55`. Default to `0` (or `user_settings.display_timezone`) so UTC users get reports at 09:00 UTC, not 07:00 UTC.

**T-9. `get-shared-report` `shared_report_trades` query un-paginated.**
`supabase/functions/get-shared-report/index.ts:62`. Add `.range(0, 4999)` (curated reports rarely exceed this, but the silent truncation must go).

**T-10. `tradeEventProcessor` double-counts commission/swap after snapshot-repair re-close.**
`supabase/functions/_shared/tradeEventProcessor.ts:428` seeds `totalCommission = existingTrade.commission` then adds every fill's commission again. Zero-initialize and accumulate from fills only, matching the orphan-exit path (~line 291).

## Low (rolled in opportunistically)

- **T-11.** Replace direct `Date.parse(...)` with `ensureUtcMs` in `src/lib/tradeMath.ts:127` and `supabase/functions/_shared/quant/pairLabMath.ts:274,278` for parity with the S4.2 sweep.
- **T-12.** Add `.range(0, 999)` to `useOpenTrades` query (`useOpenTrades.tsx:53`) — copier slaves can exceed 1 k open positions.
- **T-13.** Dashboard per-account filter should include `account_id === null` to match `useTrades`' `includeUnassigned: true` convention (`src/pages/Dashboard.tsx:31`).
- **T-14.** Compute `readAccuracy` in `usePlaybookStats` derived-metrics loop (it's currently always 0%, displayed by `PlaybookHealthCard`).
- **T-15.** Replace `text-white` in `src/pages/Accounts.tsx:165` with a semantic token.

## Out of scope (flagged, not fixed)

- `useBalanceHistory` N+1 baseline query — perf only, no correctness issue.
- Full RLS audit on `shared_report_trades` — needs DB-level confirmation; current code path is sound via owner-only insert RLS.

## Verification per item

After edits, run `bunx tsgo --noEmit`, then targeted smoke checks:
- T-1/T-2: unit-style assertion on a constructed trade array (newest vs oldest streak).
- T-3/T-4/T-5/T-9: log the row count returned vs `count: 'exact'` to confirm pagination terminates correctly.
- T-6/T-7/T-8: log the resolved session key / period boundary against a non-ET timezone fixture.
- T-10: replay a snapshot-repair fixture and assert `net_pnl === gross + commission + swap` once, not twice.
