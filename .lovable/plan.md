### Goal
Let you edit a journal screenshot's **timeframe** and **description** after it's been uploaded — not just add/delete it. Today `TradeScreenshotGallery` only supports add, delete, and expand.

### Changes

**1. New `EditScreenshotDialog.tsx` (`src/components/journal/`)**
- Reuses the same form layout as `AddScreenshotDialog` (timeframe `Select` + description `Textarea`), but pre-filled with the existing screenshot's values.
- Shows the current image as a non-editable preview at the top (so you know what you're labelling). The image file itself is not replaceable — to swap the image, delete and re-add (avoids orphaned storage objects).
- Saves by calling an `onSave(updated: TradeScreenshot)` callback — no direct DB write; the parent gallery merges the change into the `screenshots` array, which persists via the existing `updateField("screenshots", …)` autosave path in `TradeDetailPanel.tsx`.

**2. `TradeScreenshotGallery.tsx` updates**
- Add an **Edit** (pencil) button to the hover overlay, alongside Maximize and Trash.
- Add an **Edit** button inside the expanded lightbox dialog so you can tweak the description while viewing the full-size image.
- Wire both to open the new `EditScreenshotDialog` with the selected screenshot.
- `handleEdit(updated)` replaces the matching screenshot by `id` in the array and calls `onScreenshotsChange`.

**3. No DB / storage changes needed**
- Screenshots are stored as a JSON array on `trade_reviews.screenshots`; editing metadata is just an array update — already handled by the existing autosave.
- The image file in the `trade-screenshots` bucket stays untouched (only delete removes it).

### Out of scope (ask if you want these too)
- Replacing the image file in-place (would need delete-old + upload-new flow).
- Reordering screenshots manually (currently auto-sorted HTF → LTF by timeframe).
- Editing playbook screenshots — same component could be reused; let me know if you want that included.
