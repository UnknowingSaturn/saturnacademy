

# Cleanup & Validation: Live Trade Dialogs

## Findings

### Console warnings (real bug)
Two `Function components cannot be given refs` warnings fire on `LiveTrades` page:
- `StartLiveTradeDialog` (rendered in `LiveTrades.tsx`)
- The Radix `Dialog` it wraps (cascades from the same root cause)

Cause: `lovable-tagger` injects refs into top-level page components and dialogs. The codebase already solves this via `src/lib/withForwardRef.tsx` (used in `App.tsx` for `QueryClientProvider`, `BrowserRouter`, etc., and in `useAuth.tsx`). The two new dialogs — `StartLiveTradeDialog` and `CloseLiveTradeDialog` — were created as plain function components and need the same wrapping.

### P&L estimate quality (minor UX)
`CloseLiveTradeDialog` auto-fills `netPnl` with `diff × lots × 10`, which is only correct for 4-decimal major FX pairs. For JPY pairs, indices (NAS100, SP500), metals (XAUUSD), and crypto, this estimate is wildly wrong. The current copy says "Auto-estimated. Override with the actual broker P&L" but the bad pre-fill nudges users to accept it.

### Verified clean
- `useCreateTrade` mutation accepts all fields passed (`is_open`, `trade_type`, `playbook_id`, `risk_percent`, `sl_initial`, `tp_initial`)
- `useMemo` in `StartLiveTradeDialog` IS used (`defaultAccountId`, `computedLots`) — not dead code
- RLS on `trades` is correct (`auth.uid() = user_id` per user, scoped) — no changes needed
- No unused edge functions introduced; no tables to drop
- `LiveTradeCard` close-action wiring is correct (`stopPropagation`, dialog open state)

## Fixes

### 1. Wrap new dialogs in `forwardRef` to silence warnings
Convert `StartLiveTradeDialog` and `CloseLiveTradeDialog` from plain `function` exports to `React.forwardRef` components (matching the pattern used in `useAuth.tsx`'s `AuthProvider`). The ref is discarded; only purpose is satisfying `lovable-tagger`.

### 2. Improve P&L auto-estimate in `CloseLiveTradeDialog`
Drop the misleading auto-prefill. Replace it with:
- Leave `netPnl` empty by default
- Show a small inline hint below the field: `Δ price: 0.00200 × 0.10 lots` (raw delta + size, no fake $ figure)
- Keep the field required so the user has to type the actual broker P&L

This removes the bad-by-default value while still giving the user reference info.

### 3. No DB / edge function changes
Database, RLS, and edge functions remain untouched.

## Files

| File | Change |
|------|--------|
| `src/components/live/StartLiveTradeDialog.tsx` | Wrap export in `React.forwardRef` |
| `src/components/live/CloseLiveTradeDialog.tsx` | Wrap in `forwardRef`; remove fake P&L auto-prefill, replace with raw delta hint |

No other files affected. No migrations. No edge function redeploys.

