## Goal
Allow reordering table columns by dragging their headers directly in the trade table — no need to open Layout settings.

## Approach
Reuse `@dnd-kit` (already in the project) to add horizontal drag-and-drop to the `TradeTable` header row. Persist the new order to `settings.column_order` via the existing `useUpdateUserSettings` hook, so it stays in sync with the Layout panel.

## Changes (single file: `src/components/journal/TradeTable.tsx`)

1. **Imports** — add `DndContext`, `PointerSensor`, `useSensor`, `useSensors`, `closestCenter`, `DragEndEvent` from `@dnd-kit/core`; `SortableContext`, `horizontalListSortingStrategy`, `useSortable`, `arrayMove` from `@dnd-kit/sortable`; `CSS` from `@dnd-kit/utilities`.

2. **Sortable header cell** — extract the existing header `<div>` (lines 300–319) into a small `SortableHeader` subcomponent that:
   - calls `useSortable({ id: key })`
   - applies `transform`/`transition` styles
   - uses `attributes` + `listeners` on a drag handle wrapper around `column.label` (keep `ColumnHeaderMenu` click/sort/hide behavior intact — listeners only on the label area, not the menu trigger, so the dropdown still works)
   - shows a subtle `cursor-grab` / `cursor-grabbing` affordance and a small opacity drop while dragging

3. **DnD wiring in `TradeTable`**:
   - Sensor: `PointerSensor` with `activationConstraint: { distance: 6 }` so normal clicks on the header menu still work.
   - Wrap the header row in `<DndContext onDragEnd={...} collisionDetection={closestCenter} sensors={sensors}>` and `<SortableContext items={activeColumns} strategy={horizontalListSortingStrategy}>`.
   - `onDragEnd`: compute `arrayMove` on the *full* `settings.column_order` (not just visible) — find the moved key's index in the persisted order, find the target's index, move it. This preserves hidden-column positions.
   - Persist with `updateSettings.mutateAsync({ column_order: newOrder })`. Optimistic UI comes for free because the next render uses the new order.

4. **Edge cases**
   - Checkbox column and trailing expand-arrow column stay outside `SortableContext` (not draggable).
   - If `settings.column_order` is missing, fall back to current `activeColumns` as the base before applying the move (mirrors existing logic at lines 97–111).
   - Custom field columns are reordered the same way (their keys are already in `column_order`).

## Out of scope
- No changes to Layout settings panel, schema, or column visibility logic.
- No row drag/drop, no resize handles.
- No business logic / data changes.
