

# Fix clipped row dropdowns in Trade Journal

## What's happening

When you open an inline dropdown (Emotion / Model / Session / Alignment) on a trade row, it's clipped by the table container — only options that fit inside the visible table area show. With one trade, there's no room below the row, so most options are cut off.

**Root cause** — two compounding bugs in `src/components/journal/TradeTable.tsx` and `src/components/journal/BadgeSelect.tsx`:

1. `TradeTable`'s outer wrapper has `overflow-x-auto`, which creates a clipping context that traps any absolutely-positioned child both horizontally AND vertically.
2. `BadgeSelect` renders its dropdown with `absolute z-50` — plain CSS positioning, no portal. Because it's a child of the clipped table, it gets cut off no matter how high the z-index.

## Fix — render the dropdown in a portal with auto-flip

Rewrite `BadgeSelect`'s dropdown layer to escape the table's overflow context and intelligently place itself.

### 1. `src/components/journal/BadgeSelect.tsx`
- Replace the inline `<div className="absolute z-50 …">` with a `Popover` from `@/components/ui/popover` (Radix-based, already in the project, renders to a portal).
- Anchor the `PopoverTrigger` to the existing toggle button (`asChild`).
- Move the dropdown options list into `PopoverContent` with `align="start"`, `sideOffset={4}`, and `className="w-48 p-1 z-50"`. Radix auto-flips above when there's no space below — solves the "one trade" case.
- Remove the manual `useEffect` click-outside handler (Popover handles it).
- Keep the existing toggle/clear/select logic intact — only the rendering layer changes.
- Keep the `forwardRef` signature so existing usages keep working.

### 2. `src/components/journal/TradeTable.tsx`
- Change the outer wrapper from `overflow-x-auto` to `overflow-x-auto overflow-y-visible` so vertical popovers (when not portaled, e.g. tooltips) aren't clipped. Belt-and-suspenders since the portal change already fixes it.

### 3. Cleanup (no behavior change)
- Remove the now-dead `internalRef` / `handleClickOutside` block in `BadgeSelect`.

## Files

| File | Change |
|---|---|
| `src/components/journal/BadgeSelect.tsx` | Rewrite open-state rendering using `Popover` + `PopoverContent` (portaled, auto-flip). Remove manual click-outside effect. Preserve all selection/clear logic and `forwardRef` API. |
| `src/components/journal/TradeTable.tsx` | Add `overflow-y-visible` alongside `overflow-x-auto` on the outer table wrapper. |

No DB, backend, schema, or dependency changes. Both `Popover` and `Check`/`ChevronDown` icons are already used elsewhere in the project.

## Validation

1. Journal with 1 trade → click Emotion / Model / Session / Alignment / Profile dropdowns → full option list is visible (auto-flips above the row when below space is tight).
2. Journal with many trades → dropdowns still open below by default, scroll within the popover when list >60vh.
3. Multi-select (Alignment, Entry TF) → still toggles items; popover stays open until click-outside.
4. Clear selection still works for single-select fields.
5. No regression on table horizontal scroll for narrow viewports.

