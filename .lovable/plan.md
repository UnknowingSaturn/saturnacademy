## Problem

Right now every entry renders as:

1. A dense "Detailed Report" markdown block at the top (all the prose squashed together)
2. An "Illustrations" gallery far below (all images stacked, divorced from the text that explains them)
3. Then takeaways, concepts, tags

The user's article (the OTG Substack volume-profile post) flows as **paragraphs → image → paragraphs → numbered section → image → paragraphs → next numbered section → multiple images → …**. We need the rendered entry to mirror that shape so it reads like the original article, not a report dump with an appendix.

## Approach: stream the original article markdown with images placed where they appear

Instead of asking the AI to rewrite the article into a "report" and separately captioning images, we keep the **article's natural structure** and just enhance it.

### 1. `supabase/functions/extract-knowledge/index.ts` — change extraction output

Replace the current "detailed_report + screenshot_descriptions" tool schema with a structure that preserves order:

- **`article_markdown`**: the cleaned, well-formatted markdown of the original article body, with image placeholders embedded **at the exact position they appear in the source**. Use a stable token like `{{IMG:0}}`, `{{IMG:1}}`, etc. The AI is instructed to:
  - Preserve the original headings, numbered sections, paragraph breaks, lists, and quotes.
  - Strip site chrome (subscribe boxes, share buttons, footers, "Read more" links, author bios).
  - Keep paragraphs intact — do NOT collapse multi-paragraph sections into bullets.
  - Insert `{{IMG:N}}` on its own line where each image originally appeared.
  - Never invent content; this is faithful re-flow, not summarization.
- **`tldr`**: a short 2–3 sentence intro shown above the article (replaces the bloated "Detailed Report" intro).
- **`key_takeaways`**, **`concepts`**, **`tags`** — unchanged.
- **`screenshot_descriptions`** — kept (used as figcaption for each image).

Implementation details:
- Build the input by replacing each matched image in the source markdown with `{{IMG:N}}` before sending to the AI, so the model sees exactly where images go and just has to clean the surrounding prose.
- Cap input at ~30k chars (already done).
- Store `article_markdown` in the existing `summary` text column (no schema change needed) and continue to fill `screenshots[].description` from `screenshot_descriptions`.

### 2. `src/types/knowledge.ts` — no breaking changes

Reuse `summary` for the new ordered article markdown. Add a JSDoc note that it now contains `{{IMG:N}}` placeholders. No DB migration needed.

### 3. `src/pages/Knowledge.tsx` — new inline renderer

Replace the current "Detailed Report" + "Illustrations" sections with a single **Article view** that:

- Splits `entry.summary` on `{{IMG:N}}` tokens.
- For each text chunk, renders it with `ReactMarkdown` + `remarkGfm` inside the existing `prose` styles.
- For each placeholder, renders a `<figure>` with the matching screenshot + AI description as `<figcaption>`.
- Falls back gracefully:
  - If `summary` has no placeholders (older entries), render markdown then append remaining un-referenced screenshots in a small gallery at the end so nothing is lost.
  - If a referenced index is missing from `screenshots`, just skip it.
- Wider reading column: bump `max-w-3xl` → `max-w-3xl` stays, but add comfortable vertical rhythm (`space-y-6`), proper figure margins, and a subtle border + rounded corners on images (already present).
- Keep the optional **TL;DR** callout above the article body when present.
- Keep "Key Takeaways", "Concepts", "Tags" sections **below** the article (unchanged).

### 4. Backfill existing entries

No migration. The user just clicks the existing **Refresh** (re-extract) icon in the header to upgrade an entry to the new inline format. Old entries that haven't been refreshed continue to render via the fallback path (markdown + appended gallery), so nothing breaks.

## Files to change

- `supabase/functions/extract-knowledge/index.ts` — new tool schema (`article_markdown`, `tldr`), inject `{{IMG:N}}` tokens into the source markdown before AI call, keep image upload + per-image descriptions.
- `src/types/knowledge.ts` — JSDoc only (clarify `summary` now contains image placeholders).
- `src/pages/Knowledge.tsx` — replace report+illustrations layout with the interleaved renderer described above.

## What stays the same

- Database schema, tables, RLS.
- Storage bucket + image upload pipeline.
- Chat tab and `knowledge-chat` edge function.
- Sidebar entry list, add-URL form, delete, refresh.