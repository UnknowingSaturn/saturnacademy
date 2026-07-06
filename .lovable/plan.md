
# Coach Chat UI Redesign

The current Coach chat feels dated: a heavy left sidebar wedged into a slide-out sheet, generic Sparkles branding, plain bubbles, no empty-state polish, and a bare textarea composer. I'll rebuild the surface using **AI Elements** primitives (the same foundation the rest of the AI SDK ecosystem uses) plus a cleaner information architecture. Backend, tools, embeddings, and hooks stay untouched — this is a pure UI pass.

## What changes

### 1. Layout — kill the always-on sidebar
- **Slide-out panel (`CoachPanel`)**: sidebar removed entirely. History moves into a **"History" popover** triggered from the header (recent 20 threads + search + "New chat"). Panel becomes single-column, chat-first, and much wider on desktop feel.
- **Full page (`/coach`)**: sidebar collapses to a slim **rail** on desktop (icon + hover-expand) and a top **Sheet drawer** on mobile. Center column is centered, max-width ~780px, like modern AI chat apps.
- Header simplified: thread title (inline-editable on click), History button, New chat button, "Open full page" (panel only), close.

### 2. Message surface — AI Elements
Install and adopt: `conversation`, `message`, `prompt-input`, `shimmer`, `tool`.
- Assistant messages: **no bubble background** — text renders directly on the surface with markdown + streamed feel. Avatar becomes a small branded coach mark (not Sparkles).
- User messages: right-aligned bubble using `primary` / `primary-foreground` for real contrast.
- Tool calls (`searchTrades`, `recallSimilarTrades`, etc.) render inside an AI Elements `Tool` accordion, collapsed by default, with a domain icon per tool and a compact result preview (e.g. "3 trades matched").
- Attachments: thumbnails render in a tidy grid with lightbox on click.
- "Thinking…" replaced with `Shimmer` text; auto-scroll + scroll-to-bottom button via `ConversationScrollButton`.

### 3. Empty state
Replaces the lone Sparkles + one-liner with:
- Branded coach mark (generated image, not Sparkles).
- Short greeting.
- **4 suggestion chips** wired to real prompts: "Review my last losing trade", "What's my best setup this month?", "Find revenge trades", "Analyze this chart" (opens file picker).

### 4. Composer — AI Elements `PromptInput`
- `PromptInput` + `PromptInputTextarea` + `PromptInputFooter` layout.
- Left footer: attach-image button, attached-file chips (with remove), attached-context chip (trade/route) moved here from the separate bar.
- Right footer: fixed-size icon submit button (no more stretched button), Enter to send / Shift+Enter newline.
- Drag-and-drop + paste still supported.
- Textarea auto-focuses on open, after send, on thread switch.

### 5. Thread list (inside the new History popover / mobile drawer)
- Compact rows: title, last-message snippet, relative time.
- Search input at top.
- Delete on hover (sibling button, not nested).
- "New conversation" pinned at top.

### 6. Branding
- Generate a small **coach avatar/logo** asset (e.g. abstract compass/chart mark) and use it for the header, empty state, and assistant avatar. Replaces `Sparkles` as identity mark. `Sparkles` and other lucide icons remain fine for buttons/status.

## Files touched (UI only)

**New**
- `src/components/coach/CoachHistoryPopover.tsx` — replaces persistent sidebar
- `src/components/coach/CoachEmptyState.tsx` — branded greeting + suggestion chips
- `src/components/coach/CoachMessage.tsx` — AI Elements message wrapper (user/assistant/tool variants)
- `src/components/coach/CoachToolCall.tsx` — collapsed tool accordion
- `src/assets/coach-mark.png` — generated brand mark
- `src/components/ai-elements/*` — installed via `bunx ai-elements@latest add conversation message prompt-input shimmer tool`

**Rewritten (UI only, no behavior/API change)**
- `src/components/coach/CoachPanel.tsx` — remove sidebar, add History popover, adopt AI Elements
- `src/components/coach/CoachConversation.tsx` — use `Conversation` + `Message` + `Shimmer`
- `src/components/coach/CoachComposer.tsx` — use `PromptInput`, move context chip inside footer
- `src/pages/Coach.tsx` — collapsible rail on desktop, drawer on mobile, centered column
- `src/components/coach/CoachThreadList.tsx` — compact rows, search, safe delete buttons

**Untouched**
- `useCoach.tsx`, `CoachContext.tsx`, `coachUpload.ts`, all edge functions, DB, types, RAG pipeline.

## Verification
- `tsgo --noEmit` clean.
- Playwright: open `/coach` and the FAB panel, send a message, verify empty state, suggestion chip, composer focus, history popover, tool accordion collapsed, attachment upload, responsive at mobile width. Screenshot each.

## Out of scope
- No changes to tools, prompts, model, embeddings, rate limits, or context prefix logic.
- No new features (voice, streaming SSE, message editing) — pure visual/IA overhaul.
