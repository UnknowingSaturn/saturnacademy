# Execution Plan — Phases A → D

You approved Phase D and the CopierPreview deletion. Questions 3 and 4 are folded into the phases below with defaults I'll use unless you say otherwise:
- **Q3 (LiveTradeCard zero-PnL dismiss):** removed entirely. Replaced in Phase D with `repair_state = 'advisory_closed'` — no fabricated PnL ever written.
- **Q4 (stuck trades on Hola Prime 70561):** one-time SQL fix in Phase A, then the repair UI is deleted in Phase D once `snapshot_closed` rows are gone.

---

## Phase A — Safe cleanup (no behavior change)

**Deletes**
- `src/pages/CopierPreview.tsx`
- `src/components/copier-preview/` (entire folder, 10 files)
- `src/types/copier-preview.ts`
- `/copier-preview` route from `src/App.tsx`
- `supabase/functions/backfill-trades/` (zero callers, duplicate of reprocess-trades)
- `supabase/functions/trades-overlay/` (zero callers)
- `src/types/analytics.ts` (zero imports)
- `src/lib/withForwardRef.tsx` (pointless HOC)
- `src/components/ui/use-toast.ts` (dead re-export)
- `src/components/strategy-lab/StrategyLabConversationsGroup.tsx` + `ConversationList.tsx` (never imported)
- Orphaned interfaces in `src/types/trading.ts` (`OverlayTrade`, `TradingPattern`, `PatternMiningResult`, `CSVImportRow`, etc.)

**Extracts (no logic change)**
- `supabase/functions/_shared/admin.ts` — service-role client factory (used by all 22 remaining functions)
- `supabase/functions/_shared/sessions.ts` — `DEFAULT_SESSIONS` + classifier
- `supabase/functions/_shared/resolveAccount.ts` — account/api-key resolution cascade
- `src/lib/tradeTransform.ts` — single `transformTrade` (fixes latent ordering divergence between `useTrades`/`useOpenTrades`)

**Hardening**
- Add `<ErrorBoundary>` at App root + per route in `src/App.tsx`
- Add `user_id` ownership check to `reprocess-trades` body params
- One-time SQL: heal the Hola Prime 70561 stuck trades using sibling exit events, then mark `repair_reason = 'phase_a_one_shot'`

---

## Phase B — Schema integrity

**Migration: add the missing foreign keys**

Targets (all currently FK-less):
```text
trades.account_id          → accounts(id) ON DELETE CASCADE
trades.user_id             → auth.users(id) ON DELETE CASCADE
events.account_id          → accounts(id) ON DELETE CASCADE
account_balance_snapshots.account_id → accounts(id) ON DELETE CASCADE
account_balance_snapshots.user_id    → auth.users(id) ON DELETE CASCADE
terminal_accounts.account_id, user_id
terminal_snapshots.account_id, user_id
shared_report_trades.trade_id → trades(id) ON DELETE CASCADE
shared_report_trades.shared_report_id → shared_reports(id) ON DELETE CASCADE
copier_executions.master_account_id, receiver_account_id, user_id
copier_symbol_mappings.master_account_id, receiver_account_id, user_id
copier_receiver_settings.receiver_account_id, user_id
setup_tokens.user_id, master_account_id
ai_reviews.user_id, trade_id
ai_feedback.user_id, ai_review_id
```

**RLS performance fix**
- Rewrite `events` RLS from subquery-join to direct `auth.uid() = user_id` (after adding `events.user_id` column populated from `accounts`)
- Same for `trade_reviews`

**Drop dead tables**
- `trade_features`, `session_definitions`, `ai_prompts`, `property_options`
- Drop `events.processed` column (set but never read)

**Replace `mark-dormant-accounts` edge function with `pg_cron`**
```sql
SELECT cron.schedule('mark-dormant-accounts', '*/5 * * * *',
  $$UPDATE accounts SET live_state='dormant'
    WHERE last_heartbeat_at < now() - interval '15 minutes'
      AND live_state='live'$$);
```
Then delete the edge function.

---

## Phase C — Component decomposition

Split the 12 files > 500 lines. Same behavior, smaller surface:

| File | Lines | Split into |
|------|-------|-----------|
| `FieldsPanel.tsx` | 1305 | FieldList / FieldEditor / FieldDefaults / hooks |
| `TradeTable.tsx` | 907 | TradeRow / TradeTableHeader / TradeTableFilters / repair Popover |
| `Playbooks.tsx` | 880 | PlaybooksList / PlaybookForm / PlaybookFilters |
| `ColumnConfigPanel.tsx` | 687 | ColumnList / ColumnEditor |
| `PlaybookDetailSheet.tsx` | 673 | tabs already exist, extract per-tab |
| `TradeDetailPanel.tsx` | 593 | TradeDetail{Overview,Reviews,Screenshots,Modifications} |
| `CopierDashboardView.tsx` | 590 | StatusPanel/ReceiverList/ExecutionsList |
| `useUserSettings.tsx` | 562 | split into useUserPreferences + useUserDisplaySettings |
| `LiveTradeCompliancePanel.tsx` | 524 | LiveTradeRules / LiveTradeChecks |
| `EditAccountDialog.tsx` | 522 | tabs: Identity / Connection / Risk |
| `BacktestDashboard.tsx` | 514 | metrics, equity, distribution tabs |
| `ReportView.tsx` | 509 | header / metrics / sections / sidebar |

**Consolidate the 3 MT5 setup flows** (`MT5SetupDialog`, `QuickConnectDialog`, `ImportHistoryDialog`) into one stepper `MT5ConnectWizard` with branches.

**Pick one of each duplicated module**
- Equity curve: keep `EquityCurve.tsx`, delete `BacktestEquityCurveChart` duplicate + inline `calculateEquityCurve`
- Symbol normalization: keep `symbolMapping.ts`, fold `symbolAliases.ts` into it

---

## Phase D — The redesign (the actual long-term fix)

### D.1 Schema

```sql
-- Tag events with stable identity (already in raw_payload, promote to columns)
ALTER TABLE events  ADD COLUMN install_id text;
ALTER TABLE events  ADD COLUMN broker_login text;
ALTER TABLE trades  ADD COLUMN install_id text;
ALTER TABLE trades  ADD COLUMN broker_login text;
ALTER TABLE trades  ADD COLUMN repair_state text
  DEFAULT 'none' CHECK (repair_state IN ('none','pending_exit','advisory_closed','reconciled'));

-- Typed replacements for the partial_closes JSONB blob
CREATE TABLE trade_partial_fills (
  id uuid PRIMARY KEY, trade_id uuid REFERENCES trades(id) ON DELETE CASCADE,
  ticket bigint, lots numeric, price numeric,
  profit numeric, commission numeric, swap numeric, occurred_at timestamptz);
CREATE TABLE trade_modifications (
  id uuid PRIMARY KEY, trade_id uuid REFERENCES trades(id) ON DELETE CASCADE,
  field text, old_value numeric, new_value numeric, occurred_at timestamptz);
CREATE TABLE trade_repair_events (
  id uuid PRIMARY KEY, trade_id uuid REFERENCES trades(id) ON DELETE CASCADE,
  action text, source text, applied_at timestamptz, metadata jsonb);

-- Identity is resolved at read time, not at write time
CREATE VIEW trade_view AS
SELECT t.*,
  (SELECT a.id FROM accounts a
    WHERE a.user_id = t.user_id
      AND a.account_number = t.broker_login
      AND a.mt5_install_id  = t.install_id
    LIMIT 1) AS resolved_account_id
FROM trades t;
```

### D.2 Ingestion cutover

Collapse the 14 mutation paths into one materializer in `ingest-events`:
```text
EA event
  ├─ INSERT into events (install_id + broker_login tagged)
  └─ if deal event → upsert trade
       entry → insert open trade
       partial → insert trade_partial_fills row
       exit → close trade (only path that ever flips is_open=false)
  if snapshot/heartbeat → advisory only, never mutates trades
```

**Deleted after cutover** (one PR, once production runs 7 days clean):
- `repair-snapshot-closed` edge function
- `tryRepairSiblingSnapshotClosed` helper
- repair-on-reopen and repair-on-close branches
- `sync-account-state`'s destructive auto-close (path 9 in the audit)
- `LiveTradeCard.handleCloseTrade` zero-PnL write
- DriftTray "Try repair" button
- `idx_trades_snapshot_closed` workaround index
- `terminal_accounts.is_currently_active` (resolved at read time)
- All `snapshot_closed` / `repaired_*` JSON markers
- `partial_closes` JSONB column (after backfill to typed tables)

### D.3 Frontend cutover

- `useTrades` / `useOpenTrades` read from `trade_view` instead of `trades`
- `trades.account_id` reads become `resolved_account_id`
- Advisory closes render a muted "unconfirmed close — waiting for broker confirmation" badge instead of a fake PnL row

### D.4 Migration order (zero-downtime)

1. Add new columns nullable. Backfill `install_id` + `broker_login` from `events.raw_payload`.
2. Deploy new `ingest-events` that writes both old paths + new columns (dual-write).
3. Build `trade_view`. Switch frontend reads.
4. After 7 days clean ingestion, drop destructive code paths + repair UI + snapshot markers.
5. Backfill `partial_closes` → `trade_partial_fills`. Drop the JSONB column.
6. Make `install_id` + `broker_login` NOT NULL. Drop `trades.account_id`.

---

## Risk + rollback

- Every phase is independently shippable. Phases A–C are pure refactors; rollback = revert the PR.
- Phase D is gated on dual-write working for 7 days. The `partial_closes` column survives until the typed-table backfill is verified. The view-based account resolution is reversible by reinstating writes to `trades.account_id`.
- DB migrations are forward-only by Lovable convention, but data is preserved at every step.

---

## What I'll do once you say "go"

I'll execute Phase A in a single pass (deletes + extractions + the one-shot SQL heal for Hola Prime 70561), then stop and confirm before moving to B. If you'd rather batch A+B together to save round-trips, say so and I'll do that instead.
