# Fix: column dropdown colors don't match the picked color

## Cause
`src/components/journal/TradeTable.tsx` runs every property option's hex color through a small `getColorKey` lookup that only recognises 7 specific hex values (profit/loss/breakeven/primary/muted/tokyo/newyork) and falls back to `'muted'` for everything else. Any hex outside that set renders as grey in the table.

The detail panel (`TradeProperties.tsx`) does it correctly — it passes the hex straight through as `customColor`, and `BadgeSelect` already supports rendering arbitrary hex backgrounds/borders/text.

## Change
- In `TradeTable.tsx`, replace `formatOptions` so each option carries `customColor: o.color` (the user's chosen hex), matching what `TradeProperties` does. Keep `color: 'primary'` as a neutral fallback for the theme path.
- Delete the lossy `getColorKey` / `colorMap` hex-to-theme map.
- Apply the same fix anywhere else in the journal that converts a property option's hex through that bucket map (audit `formatOptions`-style helpers in TradeTable and any sibling table file).

## Out of scope
- No changes to BadgeSelect's rendering (already correct), session colors, playbook colors, or settings UI.

## Risk
- Visual only. Existing default options use the recognised hex values, so they'll look identical; user-picked colors will now actually appear.
