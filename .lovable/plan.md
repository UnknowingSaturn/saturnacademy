

# Account Selection in Trade Entry: What's Right

## Direct answers to your three questions

### 1. "Can I not add trades if there are no accounts?"

**Right now:** Both `ManualTradeForm` (Journal) and `StartLiveTradeDialog` (Live Trades) render normally with an empty account dropdown. Submission is blocked silently because `accountId` is empty — confusing dead-end with no guidance.

**Industry standard:** Yes, you MUST have at least one account to log a trade. Every serious tool (Tradervue, Edgewonk, TraderSync, MT5) requires it. A trade without an account has no balance, no risk %, no equity curve — half the analytics break.

**Fix:** When `accounts.length === 0`, both dialogs should show an empty-state with a "Create Account" CTA that opens the account creation flow (or links to `/accounts`). Don't render the form fields at all.

### 2. "Is it industry standard to add an 'all accounts' option" (in the entry form)?

**No.** This is a clear convention across the industry:

- **Filtering / viewing** = "All Accounts" makes sense (you want aggregated stats). You already have this in `AccountFilterContext`.
- **Creating a trade** = always exactly ONE account. A trade is a real position on a real broker — it has one account_id, one balance impact, one ticket, one P&L stream.

Every platform (Tradervue, Edgewonk, MT5, cTrader, TradingView) does it this way. Adding "All" to the create form would force you to invent fake aggregate semantics that break P&L, R-multiple, and risk %.

**No change needed.** Keep entry forms as single-select.

### 3. "Selecting multiple at the same time to avoid duplicates" — your real workflow

I think you're describing this scenario: **you place the same trade on 2+ accounts simultaneously** (e.g., personal + 2 prop firms, or a copier setup), and you don't want to type the same setup data three times.

**Industry standard solution:** "Mirror trade to multiple accounts" — multi-select that creates **N separate trade rows**, one per account, sharing the symbol/direction/entry/SL/TP/playbook, but with each account's own lot size (computed from its own balance × risk %). This is exactly what your desktop copier does for live execution; we'd mirror the pattern for manual entry.

This is NOT the same as "all accounts" — it's an explicit multi-select where you pick which 2-3 accounts to mirror to.

**What this prevents:**
- Typing the same trade 3 times
- Forgetting to log on one of the mirrored accounts (the duplicate-avoidance you mentioned)
- Mismatched entry prices / playbooks across accounts

**What it correctly preserves:**
- One trade row per account (so each account's equity curve, P&L, balance updates independently)
- Per-account lot sizing (different balances → different lot sizes for same risk %)
- Per-account ticket numbers (when added later from broker)

## Plan

### A. Empty-state when no accounts (both dialogs)

When `accounts.length === 0`:
- Replace the form body with a centered empty-state: icon + "Create an account first" message + "Create Account" button that navigates to `/accounts`
- Disable the submit button
- Apply to both `ManualTradeForm` and `StartLiveTradeDialog`

### B. Multi-account mirroring in `StartLiveTradeDialog`

Replace the single account `Select` with a **multi-select** (checkbox dropdown):
- Default: the currently filtered account (or first account)
- User can tick additional accounts to mirror to
- Show a small badge: "Mirroring to 3 accounts"
- On submit: loop `useCreateTrade.mutateAsync` once per selected account, with per-account computed lot size (each account's own `balance_start × risk%` / stop distance)
- Toast: "Live trade opened on 3 accounts"
- After creation: select the trade on the **currently filtered account** (or the first one if "all" is filtered)

Keep the "Risk %" sizing mode as the default — it's the only mode where mirroring makes sense (each account gets its right size). In "Lots" mode, force single-account (mirroring fixed lots across different-balance accounts is a bug-magnet — show a hint: "Switch to Risk % to mirror across accounts").

### C. Multi-account mirroring in `ManualTradeForm` (Journal)

Same multi-select pattern, but only for `trade_type === "executed"`. For `idea`/`paper`/`missed` it stays single-select (hypothetical trades belong to one account context).

When mirroring on the Journal form:
- Lots mode disabled when 2+ accounts selected (same reason as above)
- Risk % mode required for multi-select
- Same loop-create-trades-per-account pattern

### D. No DB changes

Each mirrored trade is a normal row in `trades` with its own `account_id`. No new tables, no shared-trade-id concept. RLS, analytics, and edge functions all keep working as-is.

## Files

| File | Change |
|------|--------|
| `src/components/live/StartLiveTradeDialog.tsx` | No-accounts empty state; replace single Select with multi-account picker (checkboxes); per-account lot calculation; loop `mutateAsync`; "Lots" mode forces single-select |
| `src/components/journal/ManualTradeForm.tsx` | No-accounts empty state; multi-account picker for `executed` type only; same per-account loop |
| `src/components/accounts/QuickConnectDialog.tsx` or new tiny `NoAccountsEmptyState.tsx` | Reusable empty state component (icon + copy + CTA → `/accounts`) |

No migrations. No edge function changes. No new dependencies — checkbox + popover already in shadcn.

