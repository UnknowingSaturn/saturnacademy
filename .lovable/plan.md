# Fix: option label input is invisible / unusable in column editors

## The bug

In the **Add column / Edit column** dialog (`src/components/journal/settings/CustomFieldDialog.tsx`), each option row renders, inline on one line:

1. The option label `<Input>` (`flex-1`)
2. All **18** color swatches from `COLOR_PALETTE` (`w-4` each + gaps)
3. A delete `<Button>`

In a `max-w-md` (~448 px) dialog, the swatch strip alone consumes ~330 px, squeezing the `flex-1` input down to a few pixels — that's why your screenshot shows what looks like an empty black square where the label should be. You can technically type, but it's invisible.

The same cramped pattern exists, to a lesser degree, in:

- `src/components/journal/settings/fields/CustomOptionsEditor.tsx` (inline 8 swatches per row)
- `src/components/journal/settings/fields/SystemOptionsEditor.tsx` `OptionRow` (inline 8 swatches per row in the narrow Fields panel)

## Fix

Replace the inline swatch strip with a single **color-dot button that opens a Popover** containing the full palette grid. This:

- Gives the label input the room it actually needs
- Exposes all 18 colors (not just the first 8) in the inline editors
- Keeps a single visual language across all three editors

### Files to change

1. **New** `src/components/journal/settings/fields/ColorSwatchPicker.tsx`
   - Small reusable component: a `Popover` trigger rendered as a `w-5 h-5` rounded color dot showing the current color, with a 6-column grid of `COLOR_PALETTE` swatches inside `PopoverContent`. Selecting a swatch calls `onChange` and closes the popover.

2. **Edit** `src/components/journal/settings/CustomFieldDialog.tsx`
   - In the option-row map, replace the inline `COLOR_PALETTE.map(...)` block with `<ColorSwatchPicker value={opt.color} onChange={(c) => updateOption(idx, { color: c })} />`.
   - Row layout stays one line: `[ColorDot] [Label Input flex-1] [X]` — label input is now fully visible.

3. **Edit** `src/components/journal/settings/fields/CustomOptionsEditor.tsx`
   - Same swap: remove the inline `COLOR_PALETTE.slice(0, 8).map(...)` block and use `<ColorSwatchPicker />` instead. Keep the leading color dot or replace it with the picker (single source of truth).

4. **Edit** `src/components/journal/settings/fields/SystemOptionsEditor.tsx`
   - In `OptionRow`, replace the inline `COLOR_PALETTE.slice(0, 8).map(...)` block with `<ColorSwatchPicker />`. The leading `w-3 h-3` dot becomes the picker trigger so we don't render two dots.

## Out of scope

- No change to data shape, hooks, or palette contents.
- No change to `SessionConfigPanel` / `PropertyOptionsPanel` unless they share the same row pattern (will verify during implementation and apply the same swap if they do).

## Verification

- Open Settings → Fields → Add column → choose **Select** → add an option: label input is fully visible and editable; clicking the color dot opens a popover with all 18 colors.
- Repeat in the inline Custom and System option editors in the Fields panel.
