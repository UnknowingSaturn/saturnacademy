## Problem

Session colors don't match what's set in Settings → Sessions because **three separate sources of truth** exist:

1. `session_definitions` table — what the user actually edits in Sessions panel (e.g. London = `#3B82F6`, NY PM = `#F97316`).
2. `property_options` table — used by the journal `BadgeSelect` for the Session dropdown (different colors, e.g. London = `#F59E0B`).
3. Hard-coded `sessionConfig` in `SessionBreakdown.tsx` and hard-coded CSS classes (`session-london`, `session-tokyo`, `session-newyork`) in `BadgeSelect.tsx` — fixed colors that ignore both tables.

Result: the dashboard and journal show different/wrong colors than the Sessions settings.

A few related small bugs surfaced while auditing:
- `BadgeSelect` references `--session-overlap` which is not defined in `index.css` → that branch renders unstyled.
- `TradeTable.formatOptions` hex→key map only handles ~7 hex codes; any other color (most user choices) falls back to `muted` (gray).
- `SessionBreakdown` falls back to a single hard-coded blue for any custom session key.
- New `property_options` for "session" can drift from `session_definitions` (two places to edit colors/labels).

## Fix — single source of truth

Make `session_definitions` the canonical source for session label + color everywhere session is displayed. Remove the parallel `property_options` "session" rows and the hard-coded color tables.

### 1. New shared hook: `useSessionLookup`
`src/hooks/useUserSettings.tsx` — small selector built on `useSessionDefinitions()`:
```ts
useSessionLookup() → {
  byKey: Record<string, { name: string; color: string; sort_order: number }>,
  options: { value, label, customColor }[]   // for BadgeSelect
}
```
Includes a built-in "Off Hours" entry (gray) so trades with `session = 'off_hours'` always render.

### 2. `SessionBreakdown.tsx` (dashboard)
- Drop `sessionConfig` and the `session-london` / `session-tokyo` / `session-newyork` CSS classes.
- Look up label + color via `useSessionLookup().byKey[session]`.
- Render the badge inline using the user's hex color (same pattern `BadgeSelect` already uses for custom colors: `bg ${color}26 / text ${color} / border ${color}66`).
- Sort sessions by the user's `sort_order` instead of trade count.
- Bar fill + glow uses the user's hex.

### 3. `BadgeSelect.tsx`
- Remove the dead `tokyo / london / newyork / overlap` entries from `colorClasses` (the `--session-overlap` token doesn't exist).
- No behavior change for other badges; keeps `customColor` path which is what session options will use.

### 4. `TradeTable.tsx` + `TradeProperties.tsx` Session field
- Replace `usePropertyOptions('session')` for the Session field with `useSessionLookup().options`.
- Drop the hard-coded fallback list `[NY AM, London, Tokyo, NY PM, Off Hours]` (use the user's sessions; if empty, show a single "No sessions configured — add one in Settings" hint).
- Remove the `getColorKey` hex→key map for session; sessions go through `customColor` directly.

### 5. Remove the duplicate `property_options` rows for `session`
Migration:
```sql
delete from property_options where property_name = 'session';
```
And in `useUserSettings.tsx` auto-init code (around line 480–509) remove `session` from the seeded property list so it never gets re-created. Sessions are now managed only in Settings → Sessions.

### 6. Editor `SharedReportEditor` / Reports `SymbolBreakdownTable`
- `SymbolBreakdownTable.sessionLabels` (hard-coded NY AM/London/Tokyo map) → look up via `useSessionLookup`, fallback to humanized key.
- `ReportView` `flagged_sessions` display → same lookup for the label.

### 7. Cleanup leftover dead CSS
`src/index.css` — drop `.session-tokyo`, `.session-london`, `.session-newyork`, `.session-badge`, and the `--session-tokyo / --session-london / --session-newyork` tokens. Nothing else references them after step 2/3.

## Files touched

- `src/hooks/useUserSettings.tsx` (add `useSessionLookup`, stop seeding `session` property options)
- `src/components/dashboard/SessionBreakdown.tsx`
- `src/components/journal/BadgeSelect.tsx`
- `src/components/journal/TradeTable.tsx`
- `src/components/journal/TradeProperties.tsx`
- `src/components/reports/SymbolBreakdownTable.tsx`
- `src/components/reports/ReportView.tsx` (label only)
- `src/index.css` (remove dead tokens/classes)
- New migration: `delete from property_options where property_name='session'`

## Out of scope (for this pass)

- Session classification logic in edge functions — already correct (uses `session_definitions`).
- Other badge color mismatches (profile/regime/etc.) — those already use `customColor` from `property_options` correctly. Only the **session** field had a parallel table.
