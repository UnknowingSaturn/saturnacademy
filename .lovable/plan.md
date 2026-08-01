## Goal

Make the Trading Coach read like a research note instead of a wall of markdown — matching the chosen "Structured report view" direction, using the app's existing semantic tokens (no zinc/indigo hardcodes; `primary`, `muted`, `profit`/`loss`).

## What changes (frontend only)

**1. Trade citation cards — `src/components/coach/TradeChip.tsx` (new)**
Compact row: symbol + side, date + playbook/session subtitle, right-aligned R badge tinted by outcome (profit/loss tokens). Clicking navigates to the trade in the Journal.
Rendered by parsing assistant markdown for a lightweight citation form the model already emits (e.g. `**XAGUSD Sell (2026-07-08):**` lead lines and any `trade:<uuid>` references), so no backend change is required. Anything unmatched keeps rendering as normal markdown.

**2. Report-style markdown renderer — `CoachConversation.tsx`**
- Custom `ReactMarkdown` components: `h2/h3` become uppercase tracked section eyebrows with a hairline rule; `strong` labels at line start become section headers; blockquote becomes a left-bordered insight block.
- Screenshot-referencing sections ("Screenshot 1 (…)") render as bordered cards with a header bar (title + "Screenshot N" tag) and the body text inside — matching the prototype's bordered section blocks.
- Assistant messages stay background-free on the surface; only cards/insight blocks get surfaces.
- Tighter type scale and consistent 8px rhythm; max width ~68ch for readability.

**3. Tool call strip**
Replace the plain text trigger with the prototype's pill: wrench/check icon (green when all ok, destructive when any failed), "N tool calls · getTradeDetail, …", chevron; expanded list keeps per-call status dots and error text.

**4. User message + attachments**
Bubble keeps `primary`/`primary-foreground`, adds a relative timestamp beneath it, and monospaces any inline UUID. Attachments render as a thumbnail row with hover zoom instead of a raw grid.

**5. Header + composer polish — `CoachPanel.tsx`, `Coach.tsx`, `CoachComposer.tsx`**
- Header: keep the mark, add uppercase "Trading Coach" eyebrow, keep history/new/expand/close buttons at consistent 8×8 ghost sizing.
- Composer: single rounded field with `focus-within:border-primary`, image counter as a subtle bordered pill on the bottom-left, filled send button bottom-right; keeps existing paste/drop behaviour and 3-image limit.

Both the panel and the full-page `/coach` view share the same components, so both get the redesign.

## Out of scope
No changes to coach tools, edge functions, prompts, or data model. Purely presentation.

## Verification
Playwright pass on `/coach` with an existing thread at desktop and panel widths; screenshot check for card rendering, tool strip states, and composer spacing; typecheck.
