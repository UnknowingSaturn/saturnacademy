# Strategy Lab: root-cause fix + architectural cleanup

## 1. Real root cause of "Empty response"

The current `strategy-lab` edge function does **raw byte passthrough** of the upstream Lovable AI Gateway SSE stream straight to the browser, *then* tries to splice in tool results and a follow-up stream:

```text
client  <--  [raw upstream bytes incl. `data: [DONE]`]  <--  gateway
client  <--  TOOL_RESULT markers (injected)
client  <--  [raw follow-up bytes incl. `data: [DONE]`] <--  gateway
```

This breaks in the tool-calling path:

1. For a scalp request the model emits **only** `tool_calls` deltas — zero `delta.content`. The upstream stream then ends with `data: [DONE]`.
2. Those bytes are forwarded verbatim to the client.
3. The client parser hits `[DONE]`, sets `streamDone = true`, **stops reading the body**.
4. Meanwhile the server runs the scalp tool, writes the `[TOOL_RESULT:…]` marker, fires a follow-up gateway call and pipes those bytes too — but no one is reading. TCP buffers, the writer eventually closes.
5. Client's `assistantContent` is `""` → "Empty response" toast.

Secondary contributors:

- The follow-up request sends `{ role: "assistant", content: null, tool_calls: [...] }` — Gemini sometimes returns an empty completion when `content` is null and there is no prior content delta, compounding the silence even if the client *did* keep reading.
- No server-side log around tool execution, so the bug is invisible in `edge_function_logs` (we only see boot/shutdown).
- Client buffers nothing for tool-only turns; if the parser misses one `[DONE]` injection, the user sees nothing actionable.

## 2. Architectural redesign of the streaming path

Stop forwarding raw upstream bytes. Make the edge function a **normalizer** that emits a single, well-formed SSE stream to the browser. This is the only way to compose tool runs into one logical assistant turn without the client tripping on multiple `[DONE]`s.

### Server protocol (one stream per request)

The edge function streams a single SSE channel using OpenAI-compatible `delta.content` chunks plus typed events:

```text
: ack                                   # keep-alive within 100ms
data: {"choices":[{"delta":{"content":"Analyzing…"}}]}
data: {"event":"tool_call_started","tool":"scalp_edge_report"}
data: {"event":"tool_call_result","tool":"scalp_edge_report","result":{...}}
data: {"choices":[{"delta":{"content":"## Top GO setups…"}}]}
…
data: [DONE]
```

Only one `[DONE]` ever reaches the client, emitted after **all** turns (initial + every follow-up after tool execution) are complete.

### Server implementation (`supabase/functions/strategy-lab/index.ts`)

1. Replace the raw `writer.write(value)` passthrough with a parser loop that:
   - Splits SSE lines, parses each JSON payload.
   - Re-emits `delta.content` chunks unchanged to the client.
   - Re-emits `delta.reasoning` (if/when surfaced) discarded or mapped to a typed `reasoning_chunk` event.
   - **Swallows upstream `[DONE]`** and never forwards it.
   - Accumulates `tool_calls` per index until the upstream turn ends.
2. When the upstream turn ends and there are tool calls:
   - Emit `tool_call_started` events (typed) so the UI can show "Running scalp_edge_report…".
   - Execute tools, wrapped in `try/catch`, surfacing the error inside the result payload.
   - Emit `tool_call_result` events (typed) — replace the ad-hoc `[TOOL_RESULT:…]` content marker. The card UI subscribes to the typed event, so we never pollute the assistant's prose with a JSON blob.
   - Build the follow-up request with `content: collectedContent ?? ""` (never `null`) and continue the same parser loop on the follow-up stream.
3. After the final turn:
   - If the assistant produced **zero `delta.content`** but tools ran successfully, synthesize a deterministic textual summary from the tool results (top GO cells, worst SKIPs, suggested_next_tag for scalp; "Applied N rule changes" for playbook tools) and emit it as `delta.content` before closing.
   - Emit our own `data: [DONE]\n\n` and close the writer.
4. Add structured logs at each transition (`turn_started`, `tool_executed`, `turn_completed`) so the function shows up in `edge_function_logs`.
5. Send an SSE comment (`: ack\n\n`) immediately on response open so the client's stream watchdog gets bytes within ~100 ms even when the model has slow first-token latency on reasoning calls.

### Client implementation (`src/hooks/useStrategyLabChat.ts` + `StrategyChat.tsx`)

1. Extend the SSE parser to recognise typed events (`event` field on parsed payload):
   - `tool_call_started` → push a "running" placeholder card.
   - `tool_call_result` → resolve that card (success / error / data).
   - Anything else with `choices[0].delta.content` → append to the current assistant message text.
2. Drop the brittle `[TOOL_RESULT:` / `[PLAYBOOK_UPDATED]` string sniffing; trigger `onPlaybookUpdated` from a typed `playbook_updated` event the server emits after successful playbook-mutating tool calls.
3. Treat the response as non-empty when the turn produced **any** content delta *or* any tool event. Only show "Empty response" when both are zero (genuine model failure).
4. Reset the abort watchdog on every byte (including `: ack` comments).
5. Render in `StrategyChat.tsx`:
   - One `AppliedChangeCard` per tool event (existing component, fed from the typed event payload instead of regex-extracted markers).
   - Markdown body (existing `MessageContent`) for streamed prose.

### Why this is the right shape

- One assistant turn = one logical stream, regardless of how many tool round-trips happen.
- The client never needs to know about gateway internals (`[DONE]`, raw `tool_calls` deltas) — the edge function is the contract boundary.
- Tool execution becomes observable in logs without spamming the assistant's prose with `[TOOL_RESULT:…]` blobs.
- Adding new tools later only requires emitting the same typed events; no client parser changes.

## 3. Double sidebar in Strategy Lab

`/strategy-lab` renders two stacked vertical rails on every viewport: the global `AppSidebar` from `AppLayout`, plus the in-page `ConversationList` (`w-64`) on the Chat tab. That's the visual clutter.

**Redesign: fold conversations into the global sidebar.**

- Delete the inline conversation column from `src/pages/StrategyLab.tsx`.
- Add a collapsible `SidebarGroup` named "Strategy Lab Conversations" inside `src/components/layout/AppSidebar.tsx`, only mounted when `useLocation().pathname === "/strategy-lab"`. It hosts the same `ConversationList` + "New conversation" button.
- Group auto-expands on `/strategy-lab` and collapses elsewhere, so the sidebar stays uncluttered for users on other pages.
- The Strategy Lab header keeps the playbook selector and tab bar; the `PanelLeft` toggle is removed (the global `SidebarTrigger` is the single source of truth for collapsing the rail).
- Mobile: existing `Sidebar` `collapsible="offcanvas"` behaviour handles narrow widths — no parallel sheet needed.

Net result: one rail (global nav + Strategy Lab conversations as a sub-group), the full viewport for the chat, and the conversation list still one click away.

## 4. Verification

- `supabase--curl_edge_functions strategy-lab` with the scalp prompt and `playbook_id: null` → expect `tool_call_started` + `tool_call_result` + synthesized summary + single `[DONE]`.
- Same with `playbook_id` set and a "tighten my stop rule" prompt → expect `tool_call_result` + `playbook_updated` + assistant prose.
- Tail `supabase--edge_function_logs strategy-lab` and confirm `turn_started` / `tool_executed` / `turn_completed` breadcrumbs.
- In the preview, run both prompts and confirm cards render, no "Empty response" toast, no `[TOOL_RESULT:` JSON visible in prose.

## Out of scope

- No changes to `scalp-edge-analysis`, tool definitions, MQL5 generation, Backtester / Performance / Gap Analysis tabs, or DB schema.
- No further restyle of the recently approved "Stealth command terminal" chat surface beyond adapting `MessageContent` to consume typed tool events.
