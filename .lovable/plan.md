# Make the chat assistant output read like a Weekly Report

## Problem

The screenshot shows the AI's scalp-edge narrative rendered as a wall of cramped text. Headings ("Suggested Next Tag for Data Collection", "AMT-Based Action Plan") render as plain bold lines, paragraphs collide, bullets disappear, and inline code (`cf_cf_ideal_entry_window_jdl1`) has no visual weight. By contrast, the Weekly Report (`src/components/reports/ReportView.tsx`) renders the same kind of AI prose with generous spacing, serif section heads, accent rails, and proper markdown structure.

## Cause

`MessageContent` in `src/components/strategy-lab/StrategyChat.tsx` uses:

```
prose prose-sm dark:prose-invert max-w-none
prose-p:my-1 prose-li:my-0.5 prose-headings:mt-3 prose-headings:mb-1
```

- `prose-p:my-1` and `prose-li:my-0.5` collapse vertical rhythm.
- No `remark-gfm`, so tables, task lists, strikethrough, and autolinks degrade.
- No styling for `h2`/`h3`, `blockquote`, `code`, `hr`, or `strong`, so the model's structural cues all flatten to body text.
- No section framing, so a long answer reads as one block.

The Report view solves the same problem with `prose prose-sm max-w-none prose-p:my-3 prose-p:leading-[1.7]` + `remarkGfm` + a left accent rail per section.

## Fix (UI only — `src/components/strategy-lab/StrategyChat.tsx`)

### 1. Upgrade the markdown surface in `MessageContent`

Replace the prose classes with a richer set modeled on `ReportView`:

- `prose prose-sm dark:prose-invert max-w-none text-foreground/90 leading-relaxed`
- Paragraphs: `prose-p:my-3 prose-p:leading-[1.7]`
- Headings: `prose-h1:font-serif prose-h1:text-2xl prose-h1:mt-6 prose-h1:mb-2`, `prose-h2:font-serif prose-h2:text-xl prose-h2:mt-6 prose-h2:mb-2 prose-h2:tracking-tight`, `prose-h3:text-base prose-h3:font-semibold prose-h3:uppercase prose-h3:tracking-widest prose-h3:text-primary prose-h3:mt-5 prose-h3:mb-1`
- Strong / em: `prose-strong:text-foreground prose-strong:font-semibold prose-em:text-foreground/80`
- Lists: `prose-ul:my-3 prose-ol:my-3 prose-li:my-1.5 prose-li:leading-[1.65] marker:text-primary/60`
- Inline code: `prose-code:rounded prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:font-mono prose-code:before:content-[''] prose-code:after:content-['']`
- Blockquote: `prose-blockquote:border-l-2 prose-blockquote:border-primary/40 prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:text-foreground/80`
- Tables (via `remark-gfm`): `prose-table:text-xs prose-th:font-semibold prose-th:bg-muted/30 prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2 prose-tr:border-b prose-tr:border-border/50`
- `<hr/>`: `prose-hr:my-6 prose-hr:border-border/60`
- Wire in `import remarkGfm from "remark-gfm"` and pass `remarkPlugins={[remarkGfm]}` to `<ReactMarkdown>`.

### 2. Frame each assistant message like a report section

Wrap the assistant message body in a thin card that mirrors the report aesthetic without competing with the existing `Layers` avatar:

- Outer container: `rounded-xl border border-border/60 bg-card/40 backdrop-blur px-5 py-4 shadow-sm`.
- First child stays as the existing tool-result cards (already styled) followed by the prose block.
- Keep user messages unchanged.

### 3. Promote the first H1/H2 into a serif section heading rail

Inside the prose, the existing heading styles above already do this. No extra component needed — relying on prose customization keeps the change small.

### 4. Tighten the code block contrast

The existing `prose-pre:bg-black/40 prose-pre:border prose-pre:border-border` is fine but the new prose-code rules will conflict with `<pre><code>` blocks; scope the inline-code background reset by only customizing `:not(pre) > code` via `prose-code` (the `before/after content`) override above already handles backtick rendering; verify against an MQL5 code block to make sure fenced blocks still route through `CodeViewer` (they do — the split happens before markdown).

## Out of scope

- Changing what the model says (no prompt edits).
- Restyling `AppliedChangeCard` / `ScalpEdgeReport` cards (already rich).
- Streaming, sidebar, or edge-function changes.
- Adding new dependencies (`remark-gfm` is already in `package.json`).

## Verification

1. Re-open the existing conversation `?c=5b09cc33…` and confirm the long scalp narrative now shows:
   - clear section headings,
   - breathing-room paragraphs,
   - styled inline code for `cf_cf_ideal_entry_window_jdl1`,
   - bullet markers and (if the model produces one) a GFM table.
2. Send a fresh prompt to confirm new replies look the same.
3. Ask for an MQL5 EA and confirm the fenced code block still renders through `CodeViewer` (not as prose).
