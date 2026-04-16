

# Manually Start a Live Trade (No-EA Users)

## What already exists

Looking at the codebase, the infrastructure is mostly in place:

- **`trades` table** supports `is_open=true` with no exit price/time — that's exactly an open live trade
- **`useOpenTrades`** hook already polls every 15s + subscribes to realtime, so any newly-inserted open trade appears on the Live Trades page automatically
- **`useCreateTrade`** mutation already accepts `is_open` and persists everything needed
- **`ManualTradeForm`** already has `trade_type: "executed"` mode where leaving exit price/time blank creates an open trade (line 90: `isOpen = !exitPrice || !exitTime`)
- **`LiveTradeCompliancePanel`** + **`ModelSelectionPrompt`** then handle live journaling, screenshots, checklist, AI

So technically a user can already start a live trade today by opening "Add Trade" on the Journal page and leaving the exit fields blank. But it's hidden, requires journal navigation, and the form is optimized for after-the-fact logging, not "I just clicked buy in my broker right now."

## The right approach

Add a **dedicated "Start Live Trade" entry point on the Live Trades page itself**, with a streamlined form built for the in-the-moment use case. This is the smallest change that makes manual live trading first-class for non-EA users.

### Key design choices

**Entry point** — on the Live Trades page:
- When there are open trades: a "Start Live Trade" button next to "Refresh" in the header
- When the empty state shows ("No Open Trades"): replace the passive copy with a clear primary CTA "Start Live Trade" + a secondary line "or connect MT5 EA to auto-sync"

**Form (new `StartLiveTradeDialog.tsx`)** — focused only on opening a position:
- Account (auto-selected from current filter)
- Symbol, Direction (buy/sell toggle)
- Entry price (defaults to "now"), Entry time (defaults to current time, editable)
- Stop loss, Take profit
- Risk: choose **Risk %** OR **Lots** (same toggle pattern as ManualTradeForm). Risk % is the default since manual traders typically size by risk.
- Playbook/Strategy (optional — pre-selects the AI compliance flow)
- Submit creates trade with `is_open=true`, `trade_type='executed'`, no exit fields

**After creation** — auto-select the new trade in the right panel so the user immediately sees the compliance/journaling UI for it. Realtime + the existing 15s poll already handle list refresh.

**Closing the trade** — already handled. The existing flow (manual close from journal/dismiss button) and the Trade Detail panel already let users add exit price/time, which flips `is_open` to false. Optional small win: add a "Close Trade" button directly on the live trade card that opens a tiny dialog asking exit price + time + final P&L. This lives next to the existing dismiss button.

### What we are NOT building

- No new tables, columns, RLS, or edge functions
- No price feed / live quotes (out of scope; user inputs the entry price they got from their broker)
- No mid-trade SL/TP modification tracking (the EA path captures that; manual users can edit via the existing Trade Detail panel)
- No changes to the existing `ManualTradeForm` on the Journal page — it stays for after-the-fact logging

## Files

| File | Change |
|------|--------|
| `src/components/live/StartLiveTradeDialog.tsx` | **NEW** — focused open-position form (symbol/direction/entry/SL/TP/risk/playbook), reuses `useCreateTrade` |
| `src/components/live/CloseLiveTradeDialog.tsx` | **NEW** — small dialog for exit price + time + P&L, reuses `useUpdateTrade` to set `is_open=false` |
| `src/pages/LiveTrades.tsx` | Add "Start Live Trade" button in header + improved empty state CTA; auto-select newly created trade |
| `src/components/live/LiveTradeCard.tsx` | Add small "Close" action button (opens `CloseLiveTradeDialog`) |

No DB migrations. No edge function changes. No new dependencies.

