# Fix: Scalp report dumps raw JSON instead of rendering a card

## Root cause

The server wraps tool results as a single line:

```
[TOOL_RESULT:{"tool":"scalp_edge_report","success":true,"change":{...,"cells":[{...},{...}]}}]
```

The client parser in `src/components/strategy-lab/AppliedChangeCard.tsx`:

```ts
content.replace(/\[TOOL_RESULT:(.*?)\]/g, ...)
```

uses a non-greedy `.*?` that stops at the **first** `]`. The scalp payload contains many `]` characters (every nested array closes one), so the regex matches a truncated fragment like `[TOOL_RESULT:{"tool":"scalp_edge_report",..."cells":[{"context":{...}}]`, `JSON.parse` throws, the catch block silently swallows it, and the rest of the JSON spills into the rendered markdown — exactly what the screenshot shows.

This only affects payloads with nested arrays/objects (scalp report). Simple tools like `update_playbook_rules` happen to work because their JSON has no inner `]`.

## Fix

### 1. `src/components/strategy-lab/AppliedChangeCard.tsx` — `parseToolResults`

Replace the regex-based extraction with a bracket-balanced scanner:

- Find each `[TOOL_RESULT:` marker.
- Walk forward from the `{` after the colon, tracking string state (`"` with `\` escapes) and `{` / `}` depth.
- The matching close happens at depth 0; the next char must be `]`.
- Slice the JSON between the colon and that `]`, `JSON.parse`, push to `toolResults`, and remove the whole `[TOOL_RESULT:...]` span from the rendered text.
- Keep the `[PLAYBOOK_UPDATED]` strip as-is.

This is self-contained and needs no server change.

### 2. `supabase/functions/strategy-lab/index.ts` — defensive sentinel (small hardening)

Change the emitted marker to use an unambiguous terminator that can never appear inside the JSON:

```
[TOOL_RESULT:<json>:END_TOOL_RESULT]
```

Update the client scanner to prefer this sentinel form when present, and keep the bracket-balanced fallback for any in-flight messages already saved with the old format.

### 3. No changes to

- `useStrategyLabChat.ts` (its `[TOOL_RESULT:` substring check already works).
- `ScalpEdgeReport` rendering, the sidebar, or the streaming pipeline.
- DB, RLS, or tool definitions.

## Verification

1. Re-run the failing prompt (`Run a scalp edge report on my last 6 months of trades...`).
2. Expect a single `ScalpEdgeReport` card (top GO, worst SKIP, suggested next tag) — no raw `"cells":[{"context":...}]` text.
3. Try a playbook-mutating prompt (e.g. "Add a London-session-only filter") and confirm the existing `AppliedChangeCard` summary still renders and `[PLAYBOOK_UPDATED]` triggers a refresh.
4. Confirm conversations created **before** the fix re-render correctly when reopened (bracket-balanced fallback handles the old marker shape).

## Out of scope

- Sidebar layout, streaming watchdog, edge-function summary synthesis (already shipped last turn).
- Visual restyle of the chat surface.
- Any changes to the scalp tool itself or its payload shape.
