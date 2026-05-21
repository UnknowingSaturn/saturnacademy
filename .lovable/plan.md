## Why nothing happens

The request reaches `strategy-lab` but the edge function **fully buffers** the AI's reasoning + content stream before sending anything back. With `google/gemini-2.5-pro` + `reasoning.effort=medium`, that buffer can take 60–120s. Your client times out at 90s and aborts — which is exactly what the network log shows: `signal is aborted without reason`, no edge-function execution logs because the stream was still being read when you aborted.

It's not a scalp-tool bug. Every chat reply has the same issue; you just notice it more on the first message of a new conversation.

## Plan

### 1. Fix the hang — true streaming passthrough (strategy-lab)

Rewrite the response path in `supabase/functions/strategy-lab/index.ts` so the upstream Lovable AI Gateway SSE stream is **piped straight to the client** while a side-task inspects each chunk for tool calls.

- Use a `TransformStream`: every `data:` line from the gateway is forwarded to the client immediately AND parsed into `collectedContent` / `toolCallBuffers`.
- When the upstream stream ends:
  - **No tool calls** → close the client stream. User has already seen the full response.
  - **Tool calls present** → after upstream ends, run the tools, inject `[TOOL_RESULT:…]` markers into the same stream, then pipe the follow-up gateway stream through to the client and close.
- Raise client `STREAM_TIMEOUT_MS` from 90 s to 180 s in `useStrategyLabChat.ts` to cover heavy reasoning runs (tools + pro model).
- Keep the existing fallback (non-OK follow-up → emit summary + close).

Result: first tokens appear in <3 s instead of after the whole reasoning pass; the 90 s abort goes away.

### 2. Modernise the chat UI

Generate 3 design directions for the chat surface (message list + composer + empty state) via `design--create_directions`, then ask you to pick one with `ask_questions` (type `prototype`). After approval, restyle `StrategyChat.tsx` to the chosen direction.

Scope of the redesign (visual only — no behaviour change):
- Empty state: bigger hero, clearer "no playbook / no data" affordances, prettier quick-action chips.
- Messages: tighter avatars, role-coloured rails instead of full-width muted blocks, better spacing/typography, subtle hover for copy.
- Assistant "thinking" indicator: streaming dot pattern instead of a static spinner so the user sees life immediately.
- Composer: rounded "pill" with inline send / stop / upload buttons, autosize textarea, slash-command hint.
- Keep semantic tokens only (no hard-coded colors).

### Out of scope
- No changes to scalp-edge-analysis, tool definitions, or routing.
- No DB migrations.
- No changes to Backtester / Performance / Gap Analysis tabs.

### Files touched
- `supabase/functions/strategy-lab/index.ts` — streaming rewrite (~80 lines in the response path).
- `src/hooks/useStrategyLabChat.ts` — bump timeout to 180 s, add streaming-dot indicator state if needed.
- `src/components/strategy-lab/StrategyChat.tsx` — apply chosen design direction.

### Open question before I build
After the streaming fix lands, do you want me to **(a) proceed with design directions for the full chat (empty state + messages + composer)**, or **(b) only refresh the composer + thinking indicator** and leave the rest alone? Default: (a).
