## Goal
Make the Fields settings symmetric and robust: every system field that has a meaningful single-cell representation should be toggleable for **both** the table view and the detail panel. Today, fields like Direction, P&L, Status, and Closes only exist in the detail catalog — there's no way to enable them as table columns.

## Root cause
`FieldsPanel` derives the "Show in table" toggle from `DEFAULT_COLUMNS`. Several detail-catalog keys (`direction`, `pnl`, `status`, `closes`) are missing there, so the toggle is permanently unavailable. `TradeTable` already renders `direction` and `net_pnl` if asked, but `status` and `closes` have no table renderer, and `pnl` (detail key) and `net_pnl` (table key) are split — same canonical-key bug pattern fixed last round for `symbol`/`entry_time`/`r_multiple_actual`.

## Changes

### 1. `src/types/settings.ts` — add the missing table columns

Add these entries to `DEFAULT_COLUMNS` (all `hideable: true`, **not** in `DEFAULT_VISIBLE_COLUMNS` so behavior is unchanged for existing users):

- `direction` — `type: 'badge'`, sortable, `width: minmax(70px, 0.7fr)`, category `calculated`
- `net_pnl` — `type: 'number'`, sortable, `width: minmax(80px, 1fr)`, category `calculated`
- `status` — `type: 'badge'`, sortable, `width: minmax(80px, 0.9fr)`, category `calculated`
- `closes` — `type: 'number'`, not sortable, `width: minmax(60px, 0.7fr)`, category `calculated` (shows fill count)

Update `COMPUTED_DISPLAY_COLUMNS` to include `direction`, `net_pnl`, `status`, `closes` so they're treated as display-only (no erase action).

### 2. Canonical-key alignment for P&L (mirror previous `symbol`/`entry_time` fix)

- In `DETAIL_FIELD_CATALOG`, rename `pnl` → `net_pnl` (label stays `"P&L"`).
- In `LEGACY_DETAIL_KEY_MIGRATION`, add `pnl: ['net_pnl']`.
- In `useUserSettings.tsx` `LEGACY_KEY_MAP`, add `pnl → net_pnl` so saved `column_order`/`visible_columns`/label-overrides keep working.
- In `TradeProperties.tsx`, rename the switch case `'pnl'` → `'net_pnl'`.

### 3. `src/components/journal/TradeTable.tsx` — add missing renderers

- Add `case 'status'` rendering the same OPEN / WIN / LOSS / BE badge used in the detail panel (small, centered).
- Add `case 'closes'` rendering `getRealPartialCloses(trade).length + 1` (or `—` when no fills) — matches what the detail panel shows.
- Existing `direction` and `net_pnl` cases stay as-is.

### 4. Verify FieldsPanel auto-picks them up

No code change needed — once a key is in `DEFAULT_COLUMNS`, `pushSystemKey` will set `isInTable: true` and the "Show in table" switch becomes available. Confirm by re-reading the `tableKeys` derivation.

## Out of scope
- No new detail-catalog entries for table-only fields (`trade_number`, `account_pct`, `result`, `trade_type`, `read_quality`) — user only flagged the table-side gap. Can be added in a follow-up if desired.
- No DB / schema changes.
- No changes to filtering, sorting beyond plugging the new columns into the existing pipeline.
- No visibility defaults change — new columns are opt-in.
