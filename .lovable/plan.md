## Goal

Make shared reports feel like a **living document** that you keep updating day-by-day after publishing, and rebalance the public reading experience so screenshots and captions feel substantial — not lost in a mostly-empty card.

## Part 1 — Live (continuously updated) reports

**The good news:** the publish flow is already non-destructive. Once a report is published, every change you make in the editor (title, intro, added trades, captions, screenshot ordering) is auto-saved and the public `/r/{slug}` page reflects it on the next load — there's no "snapshot" being taken at publish. So in a strict sense, live editing already works.

What's actually missing for a true *live* experience:

1. **No visible signal that the report is live.** The Share dialog only says "Publish / Unpublish" and doesn't communicate that further edits will go live immediately. People are reasonably scared to touch a published report.
2. **Public viewers don't see when it last changed** or whether the author intends more updates, so a visitor returning the next day has no cue that something new was added.
3. **Public page is fully cached** (React Query default + no auto-refetch), so a visitor who keeps the tab open never sees new entries.
4. **No "last updated" timestamp on the editor list** — once published it's hard to remember which reports are still being added to.

### Changes

**A. Add a "Live updates" mode on the report itself** — a per-report toggle stored on `shared_reports`.

Schema migration (add columns to `shared_reports`):
- `live_mode boolean not null default false` — when true, the report is treated as a rolling/live document. Editor and public page show a "Live" badge and a "Last updated …" timestamp.
- `live_started_at timestamptz null` — set when `live_mode` flips on; used by the public page to render "Updated daily since Apr 27".

No new RLS — existing `shared_reports` policies already cover these columns.

The `get-shared-report` edge function will return `live_mode`, `live_started_at`, and `updated_at` so the public page can render them.

**B. Editor (`SharedReportEditor.tsx`) — make live mode obvious and safe**
- New "Live updates" switch in the left settings panel (just below the Period block) with a one-line description: *"Keep adding trades after publishing — viewers see updates instantly and a 'Last updated' label."*
- When `live_mode` is on **and** `published_at` is set, show a subtle pulsing green dot + "Live · last edited 2 min ago" near the top bar so the author knows changes go straight to the public URL.
- When `live_mode` is on but the report is unpublished, show a hint in the Share dialog: *"This report will keep updating after you publish — you don't need to publish again for new trades."*

**C. Share dialog (`ShareDialog.tsx`)**
- Replace the binary "Publish / Unpublish" button with clearer copy depending on `live_mode`:
  - Off: "Publish snapshot" (current behaviour — a one-shot share).
  - On: "Publish live link" + helper text *"Edits will appear on the public link automatically."*
- When already published in live mode, the button reads "Stop sharing" and there's a small "Updated {relative}" line.

**D. Public page (`PublicReport.tsx`) — make liveness visible**
- If `live_mode`, render a small pill near the title: a pulsing green dot + `Live · updated {relative}` (using `date-fns`'s `formatDistanceToNow`).
- If `live_started_at` is set and the period spans multiple days, the period sub-line becomes `Updated daily since Apr 27 · by @author`.
- Auto-refetch the public payload every 60s **and** on `visibilitychange` (when the tab returns to focus) for live reports only. Static reports keep the existing one-shot fetch.
- Show a `dateline` immediately above each trade card: `Apr 27 · Mon` so a returning visitor can scan what's new since their last visit. Today's card gets a tiny "New" badge if it was added in the last 24h (computed from `shared_report_trades.created_at`, which is already in the schema).

**E. Reports list (`SharedReports.tsx`)**
- Show "Live" pill on cards where `live_mode` is true.
- Show "Updated {relative}" instead of the static period line when `live_mode` is on.

**F. Quick-create defaults**
- The "Daily" quick-create stays as a one-shot snapshot.
- Add a fourth option **"Live (rolling)"** in the New report dropdown that creates a report with `live_mode = true`, no fixed period (auto-derived from picks as today), and a default title like `Live journal — week of Apr 27`.

## Part 2 — Bigger text and screenshots on the public page

The current `EducationalTradeCard` uses `aspect-video` thumbnails in a 2-column grid with `text-xs` figcaptions and `text-sm` captions. With most cards having only 1–2 screenshots and short captions, this leaves the card mostly air.

### Changes to `EducationalTradeCard.tsx` and `PublicReport.tsx`

**Layout / typography**
- Public page container widens from `max-w-3xl` (768px) to `max-w-4xl` (≈896px) so screenshots can breathe without becoming gigantic on ultrawides.
- Card header: symbol bumps from `text-base` to `text-lg`, the meta row (time / session / playbook) from `text-xs` to `text-sm`, and the trade-number badge becomes a clean serif `01` instead of a tracked tiny label.
- Screenshot figcaptions: `text-xs italic` → `text-sm leading-relaxed`, with more padding (`px-4 py-3`).
- Caption section ("What went well / wrong / to improve"):
  - Label: keep tracked uppercase but bump `text-[10px]` → `text-xs`.
  - Body: `text-sm` → `text-base leading-relaxed`, padding `px-5 py-4` → `px-6 py-6`.
  - Add a soft tinted background per row (success/destructive/warning at ~5% opacity) so the captions feel like distinct content blocks rather than three lines of grey text.
- Intro paragraph on `PublicReport.tsx` goes from `text-lg` to `text-xl leading-relaxed`.
- Hero `<h1>` stays `text-4xl md:text-5xl` (already big) but gains `tracking-tight` and slightly more breathing room.

**Smarter screenshot grid (the biggest visual win)**
- 0 screenshots: header + captions only (unchanged).
- 1 screenshot: render full-bleed `aspect-[16/10]`, spans the entire card width — currently it sits at half-width which is the main "empty card" complaint.
- 2 screenshots: side-by-side at `aspect-[16/10]` on `md:` and stacked full-width on mobile.
- 3 screenshots: first one full-width hero, two underneath in a 2-column row.
- 4+: existing 2-column grid, but `aspect-video` becomes `aspect-[16/10]` for a slightly taller, less letterboxy frame.

These all use the existing screenshot data — no schema change.

**Card chrome**
- Soften the header strip background (`bg-muted/30` → `bg-muted/20`) and increase its padding (`px-5 py-3` → `px-6 py-4`) so it matches the new caption padding.
- Add `shadow-sm` to the `Card` and bump vertical spacing between cards from `space-y-8` to `space-y-12`.

## Out of scope

- No notifications/email when a live report changes (can be added later if you want subscribers).
- No per-trade "new since" persistence — the "New" badge is purely time-based on `shared_report_trades.created_at < 24h`.
- No reordering of `SharedReports.tsx` quick-create options beyond adding the Live one.

## Technical summary

**Schema:** one migration adding `live_mode boolean not null default false` and `live_started_at timestamptz null` to `shared_reports`. Trigger on `live_mode` flip-on to set `live_started_at = now()`.

**Edge function:** `get-shared-report/index.ts` includes `live_mode`, `live_started_at`, `updated_at`, and per-trade `created_at` in the payload.

**Types:** extend `SharedReport` and `PublicReportPayload` in `src/types/sharedReports.ts`.

**Hooks:** `usePublicReport` gains a `refetchInterval` and `refetchOnWindowFocus` that activate only when `data.report.live_mode === true`.

**UI files touched:** `SharedReportEditor.tsx`, `ShareDialog.tsx`, `PublicReport.tsx`, `EducationalTradeCard.tsx`, `SharedReports.tsx`, `useSharedReports.tsx`.
