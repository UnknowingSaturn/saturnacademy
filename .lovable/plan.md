## Goal

Transform the Knowledge entry view from a thin "summary + separated screenshots" into a **detailed report** with screenshots **inline next to the paragraphs that describe them**.

---

## Problem Recap

Looking at `extract-knowledge` and `Knowledge.tsx`:
1. The AI prompt asks for a **2–3 sentence summary** — too short. It should be a multi-section detailed report.
2. Screenshots live in a separate **Screenshots tab**, captioned only with their original `alt` attribute, with no link back to what the article was actually saying when it embedded them.

---

## Plan

### 1. Edge function: `supabase/functions/extract-knowledge/index.ts`

**a. Capture screenshot context during markdown parsing**
When walking `![alt](url)` matches, also capture the surrounding paragraph text (≈400 chars before + after, stripping markdown image lines). Store this as `nearby_text` on each screenshot record so the AI has what the article said about each image.

**b. Replace the short summary with a detailed report via tool calling**
Rewrite the `save_knowledge` tool schema:
- Remove the 2–3 sentence `summary` field
- Add `detailed_report` (string, markdown) — instruct AI to write a **comprehensive, well-structured report** covering: overview, core thesis, methodology / setup rules, examples & case studies, edge cases / pitfalls, and conclusion. Multiple paragraphs, headings allowed.
- Add `screenshot_descriptions` (array of `{ index, description }`) — for each screenshot index, the AI explains what the image illustrates **based on the article's `nearby_text`** (no invention; if context is missing, say so briefly).
- Keep `key_takeaways`, `concepts`, `tags` as today.

The AI receives both the article markdown and the list of screenshots with their `nearby_text` so it can ground descriptions.

**c. Persist**
- Store the detailed report in the existing `summary` text column (it's already `text`, no migration needed — just becomes longer, richer markdown).
- Merge AI-generated `description` into each screenshot record alongside the original `caption` (alt text). Final shape per screenshot:
  ```ts
  { url, caption, source_url, description, nearby_text }
  ```
- Update the `KnowledgeScreenshot` type in `src/types/knowledge.ts` to include `description?: string` and `nearby_text?: string` (both optional for backward compat with existing entries).

### 2. UI: `src/pages/Knowledge.tsx`

**a. Render the detailed report as markdown**
The `summary` field will now contain markdown. Use `react-markdown` with `remark-gfm` (already used elsewhere per the Firecrawl docs in this project) to render headings, lists, paragraphs. Wrap in `prose` Tailwind classes for readable typography.

**b. Inline screenshots inside the report tab**
Restructure the Summary tab into a single "Report" view:
- Rename tab from "Summary" → **"Report"**
- Keep **Key Takeaways**, **Concepts**, **Tags** sections below the report as today
- Below the report body, render an **"Illustrations"** section: each screenshot rendered as a `<figure>` with the image, then **`description`** as the primary caption (in normal text size), and the original `alt` as a smaller secondary line if it adds info
- The standalone "Screenshots" tab is removed (everything is now together) — or kept as an optional gallery; I'll **remove it** to honor "screenshots together with their descriptions"

**c. Backward compatibility**
Older entries (no `description`, short `summary`) still render — the markdown renderer handles plain text fine, and screenshots without `description` fall back to `caption`.

### 3. Re-extraction for the existing entry

After deploying the function changes, the user can hit the existing **Refresh / Re-extract** button (already wired to `useReExtract`) on the entry they referenced to regenerate it with the new detailed format. No data migration needed; old entries upgrade on demand.

---

## Files to change

- `supabase/functions/extract-knowledge/index.ts` — new tool schema, screenshot context capture, persist new fields
- `src/types/knowledge.ts` — extend `KnowledgeScreenshot` with optional `description`, `nearby_text`
- `src/pages/Knowledge.tsx` — markdown renderer for report, inline figures with descriptions, drop separate Screenshots tab
- (deps) ensure `react-markdown` + `remark-gfm` are available (add if missing)

No database migration, no new edge function, no new connector.

---

## What the user will do after I implement

Open the existing entry → click the **Refresh** icon in the header → wait ~20s → see a full multi-paragraph report with each screenshot embedded next to its explanation.