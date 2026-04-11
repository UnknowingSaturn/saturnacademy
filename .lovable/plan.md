

# Add Settings Access to Live Trades Page

## Problem
The "Live Q's" configuration tab is only accessible from Journal → Settings dialog. There's no way to reach it from the Live Trades page where those questions are actually used.

## Solution
Add a Settings (gear) button to the Live Trades page header that opens a focused settings dialog with the Live Questions panel — reusing the existing `LiveQuestionsPanel` component.

## Changes

### `src/pages/LiveTrades.tsx`
- Import `JournalSettingsDialog` (or create a smaller `LiveTradeSettingsDialog`)
- Add a gear icon button next to the "Refresh" button in the header
- Wire it to open the settings dialog, defaulting to the "Live Q's" tab

### `src/components/journal/JournalSettingsDialog.tsx`
- Accept an optional `defaultTab` prop so it can open directly on "live"
- When opened from Live Trades, default to the Live Q's tab

Two small edits, no new files needed.

