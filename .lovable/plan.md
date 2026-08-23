# Widen the Trade Detail Properties Pane

## Goal
Make the right-hand properties pane in the trade detail sheet wide enough that field labels (e.g., "Planned Model", "Ideal Entry Window", custom fields) no longer truncate.

## Current state
- `TradeDetailPanel.tsx` renders the properties sidebar at a fixed `w-64` (256 px).
- `TradeProperties.tsx` allocates only ~40% of that width to labels, so longer labels are clipped with ellipsis.
- The uploaded screenshot shows labels like "Planned Mo..." and "Ideal Entry ..." because of this constraint.

## Changes
1. **Increase pane width** in `src/components/journal/TradeDetailPanel.tsx`
   - Change the properties sidebar from `w-64` to `w-80` (320 px).
   - Keep the existing toggle button and collapsible behavior intact.

2. **Rebalance label/value columns** in `src/components/journal/TradeProperties.tsx`
   - Increase the label column basis from `basis-[40%]` to `basis-[45%]` so labels have more room before they truncate.
   - Ensure the value column still has enough space for dropdowns and numeric inputs.

3. **Verify responsive behavior**
   - Confirm the sheet's `sm:max-w-5xl` container still leaves adequate room for the main content area at typical desktop widths.
   - On mobile (`w-full`) the layout remains unchanged.

## Out of scope
- No changes to field definitions, custom fields, or data persistence.
- No resizable drag handle or collapsible state persistence (user selected fixed wider width).

## Acceptance criteria
- Opening any trade detail shows the properties pane at 320 px.
- Labels that previously truncated (e.g., "Planned Model", "Ideal Entry Window") are fully visible.
- The toggle button still hides/shows the pane.
- Existing tests pass and no layout overflow occurs at 1280 px viewport.
