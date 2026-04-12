

# Codebase Review & Cleanup Plan

## Summary of Findings

After reviewing the codebase, the recent refactor (replacing custom Live Trade Questions with direct journal integration via `TradeProperties` and `TradeScreenshotGallery`) was implemented correctly. However, there is leftover/unused code that should be cleaned up.

## Issues Found

### 1. Orphaned `questionAnswers` in LiveTradesContext
`src/contexts/LiveTradesContext.tsx` line 16 still has `questionAnswers?: Record<string, string>` in the `ComplianceState` interface. This field is no longer populated by any component since the custom questions were removed from `LiveTradeCompliancePanel`.

**Fix:** Remove `questionAnswers` from the `ComplianceState` interface.

### 2. Live Questions Panel still referenced but no longer used by Live Trades
The `LiveQuestionsPanel` component and the `live_trade_questions` settings are still rendered in `JournalSettingsDialog` under the "Live Q's" tab, and the Settings button on the Live Trades page opens to this tab. However, the Live Trades panel no longer uses these custom questions — it uses `TradeProperties` and `TradeScreenshotGallery` directly.

**Options:**
- **Remove the "Live Q's" tab entirely** since it's now dead configuration, OR
- **Repurpose it** as a general "Live Trades Settings" tab (but there's nothing to configure since journal components handle everything)

**Recommendation:** Remove the "Live Q's" tab from the settings dialog and the Settings button from the Live Trades page (since it now opens to a tab that configures nothing useful). The `LiveTradeQuestion` type and `DEFAULT_LIVE_TRADE_QUESTIONS` in `src/types/settings.ts` can also be removed, along with the `LiveQuestionsPanel` component.

### 3. `live_trade_questions` DB column is unused
The `user_settings.live_trade_questions` column in the database is no longer consumed by any component. It can remain for now (no migration needed to remove it — it's harmless as a nullable JSONB column), but the code references should be cleaned up.

### 4. JournalSettingsDialog `defaultTab` doesn't reset on reopen
`JournalSettingsDialog` uses `useState(defaultTab || "sessions")` which only sets the initial state. If the dialog is opened from Journal (no defaultTab), closed, then opened from Live Trades (defaultTab="live"), it won't switch tabs because React doesn't re-initialize state on prop changes for an already-mounted component. This is a minor bug.

**Fix:** Add a `useEffect` to sync `activeTab` when `defaultTab` changes, or key the dialog.

### 5. No console errors detected
The app runs cleanly with no runtime errors.

## Plan

### Step 1: Clean up LiveTradesContext
- Remove `questionAnswers` from `ComplianceState` interface in `src/contexts/LiveTradesContext.tsx`

### Step 2: Remove unused Live Questions infrastructure
- Delete `src/components/journal/settings/LiveQuestionsPanel.tsx`
- Remove `LiveTradeQuestion` interface and `DEFAULT_LIVE_TRADE_QUESTIONS` from `src/types/settings.ts`
- Remove `live_trade_questions` from the `UserSettings` interface in `src/types/settings.ts`
- Remove `live_trade_questions` references from `src/hooks/useUserSettings.tsx`
- Remove the "Live Q's" tab from `src/components/journal/JournalSettingsDialog.tsx` (change to 4-column grid)

### Step 3: Remove Settings button from Live Trades page
- Remove the Settings button, `settingsOpen` state, and `JournalSettingsDialog` import from `src/pages/LiveTrades.tsx`

### Step 4: Fix JournalSettingsDialog defaultTab bug
- Add `useEffect` to update `activeTab` when `open` or `defaultTab` changes

### Files Modified
| File | Change |
|------|--------|
| `src/contexts/LiveTradesContext.tsx` | Remove `questionAnswers` from interface |
| `src/types/settings.ts` | Remove `LiveTradeQuestion`, `DEFAULT_LIVE_TRADE_QUESTIONS`, and `live_trade_questions` from `UserSettings` |
| `src/hooks/useUserSettings.tsx` | Remove `live_trade_questions` references |
| `src/components/journal/settings/LiveQuestionsPanel.tsx` | Delete file |
| `src/components/journal/JournalSettingsDialog.tsx` | Remove Live Q's tab, fix defaultTab bug |
| `src/pages/LiveTrades.tsx` | Remove Settings button and dialog |

No database migrations needed. No edge function changes needed.

