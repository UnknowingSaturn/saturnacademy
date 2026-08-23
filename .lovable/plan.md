# Ideal Entry Window / Ideal Stop-Loss: nothing was lost

## What the database actually holds

I queried your trades directly before writing this:

- 503 trades total, 102 with custom field values
- 97 trades have an **Ideal Entry Window** value (`first_worked`, `first_failed_second_worked`, ...)
- 71 trades have an **Ideal Stop-Loss Position** value (`last_leg`, `initial_leg`)
- 70 trades have an **Ideal Stop-Loss** number

The four field definitions are also intact and active, with their correct option lists (9 options for Ideal Entry Window, 2 for Ideal Stop-Loss Position). No migration deleted anything — there is nothing to recover.

## What went wrong on screen

The dropdown in your screenshot is showing every system property option merged together (Great, 1min, Consolidation, Tokyo, London, New York AM...). That is the "all properties" list returned when a select cell is asked for options without naming a property. It happens when a custom field is rendered through the *system* select cell instead of its own cell: the system cell then has no option list of its own, falls back to everything, and your saved value (`first_worked`) isn't in that list, so the cell looks empty.

That routing was fixed earlier today — custom fields now render through `CustomFieldCell` with their own options. The screenshot most likely predates the fix, or is a stale tab.

## Plan

1. Verify in the running app that the Ideal Entry Window / Ideal Stop-Loss Position columns now show their own coloured options and their stored values (checked against the exact trades I found values on in the database).
2. Add a hard guard so this failure mode cannot silently return: a select cell with no configured options property renders a dash instead of the merged list of every system option, and `usePropertyOptions` requires a property name.
3. Add a regression test asserting a custom select field resolves to its own option list and never to the merged system list.
4. If step 1 shows values still missing on screen, trace the read path (`readFieldValue` for `custom` sources through the grouped-leg reducer) and fix it — the values are in the database, so any remaining gap is display only.

## Technical notes

- Files touched: `src/hooks/useUserSettings.tsx` (`usePropertyOptions` guard), `src/lib/journalFields/FieldCell.tsx` (`SelectCell` fallback), plus a new test under `src/lib/__tests__/`.
- No migration and no data writes are needed.
