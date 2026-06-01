## 1. Sections tab — enable deleting system rows

Today the **Fields** tab lets you delete (soft-delete) system fields via `deleted_system_fields`, but the **Sections** tab (`DetailLayoutPanel.tsx`) only exposes a visibility toggle. The same rows therefore look "stuck" — you can hide them but not remove them from the list.

**Changes in `src/components/journal/settings/DetailLayoutPanel.tsx`**
- Add a trash icon button to each `SortableRow` in the **Properties sidebar** group.
- Clicking it:
  - For **system fields** → append the key to `deleted_system_fields` and strip it from `detail_visible_fields` / `detail_field_order` (same pattern as `FieldsPanel.confirmDelete → system-soft`).
  - For **custom fields** → mark the custom field `is_active: false` (mirrors `custom-soft`).
- Show a small confirm popover ("Remove from journal? You can restore from the Fields tab") to avoid accidental deletes.
- Leave the **Review sections** group toggle-only (those are fixed system blocks like Notes / Screenshots / AI Review — hide-only makes sense there, restoring them would have nowhere to live). Optional: add a tooltip explaining why they're toggle-only.
- Restoration continues to happen on the Fields tab (already implemented), so behavior stays consistent.

## 2. Drift banner — calmer, context-aware messaging

Today `DriftTray` shows a loud amber **"1 trade need attention"** with a **Repair** CTA the moment the active terminal stops reporting an open ticket. In practice the most common causes are benign (MT5 closed, you switched login, broker session ended) and a manual repair is rarely the right first move.

**Goal:** infer *why* the trade went missing and surface the matching soft suggestion. Only escalate to the wrench when nothing else explains it.

**New classification in `supabase/functions/trade-repair/index.ts` (`runListDrift`)** — for each drift trade, attach a `reason` field:

| Reason | Signal | Suggested message / CTA |
|---|---|---|
| `mt5_offline` | `terminal_accounts.last_active_at` > ~10 min ago, or no recent heartbeat | "MT5 isn't running — open the terminal and we'll resync automatically." No Repair button. |
| `login_switched` | `snapshot.active_login` is set and doesn't match `account.account_number` | "You're logged into login #{active_login} on this terminal. Log back into #{account.account_number} to sync this trade." No Repair button. |
| `broker_session_closed` | snapshot fresh, login matches, but symbol's market is closed (weekend / out-of-hours) | "Markets are closed for {symbol}. Trade likely closed at the broker — we'll confirm when MT5 reconnects to the live session." Soft Repair link. |
| `likely_broker_closed` | snapshot fresh, login matches, market open, ticket missing > 2 min | "Broker likely closed this trade. Pull the real close from MT5 deal history." Repair button (current behavior). |
| `recent` | trade entered < 2 min ago | suppress from list entirely (already partially done). |

`mt5_offline` and `login_switched` get folded into the existing "awaiting next login" / dormant list instead of the red drift list.

**`src/components/journal/DriftTray.tsx`**
- Drop the amber "trade need attention" framing; use a neutral muted card by default.
- Render per-trade message based on `reason`, with the appropriate CTA (Repair only for `likely_broker_closed` and `broker_session_closed`).
- Title becomes contextual: e.g. "1 trade syncing once you reconnect" vs "1 trade may need repair".

## Technical notes

- `deleted_system_fields` already exists in `user_settings` and is honored by `DetailLayoutPanel` / `TradeProperties` / `FieldsPanel` — no schema/migration needed.
- Reason classification stays server-side in the existing `trade-repair` edge function so the client just renders. Market-hours check can reuse symbol metadata already on the trade row (fall back to `likely_broker_closed` if unknown).
- No changes to the underlying repair flow or DB schema.