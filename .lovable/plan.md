# Make screenshot viewer dialog larger

Currently the "Chart Screenshot" expanded dialog in `src/components/journal/TradeScreenshotGallery.tsx` (line 200) uses `max-w-5xl`, leaving lots of empty space around the chart on wide screens.

## Change

In `src/components/journal/TradeScreenshotGallery.tsx` (line 200), update the `DialogContent` to fill more of the viewport:

- `className="max-w-[95vw] w-[95vw] max-h-[95vh] p-4 sm:p-6"`
- Wrap image + description in a scrollable container: `<div className="space-y-4 overflow-y-auto max-h-[calc(95vh-8rem)]">`
- Image: change `w-full rounded-lg` → `w-full max-h-[75vh] object-contain rounded-lg` so very tall screenshots stay within view.

Same treatment for `src/components/playbooks/PlaybookScreenshotGallery.tsx` (currently `max-w-4xl`) for consistency.

No other behavior or layout changes.
