

# Fix Stuck Live Trades + Add Dismiss Button

## Immediate Fix
Run a migration to close the two stuck trades:
```sql
UPDATE trades 
SET is_open = false, 
    exit_time = now(), 
    net_pnl = 0, 
    gross_pnl = 0
WHERE id IN (
  '031a4bc6-bb31-4fe7-926d-624dfdb39c4a',
  'facbc0fd-85a5-4003-953d-6812409977bc'
) AND is_open = true;
```

## Prevent Future Occurrence
Add a "Close Trade" button to each `LiveTradeCard` (small X or context menu) that:
- Sets `is_open = false`, `exit_time = now()`, and flags it as manually closed
- Shows a confirmation dialog ("This trade will be removed from live view")
- Uses the existing `useUpdateTrade` mutation

**Files modified:**
- `src/components/live/LiveTradeCard.tsx` — add close/dismiss button with confirmation
- Database migration — close the two stuck trades

