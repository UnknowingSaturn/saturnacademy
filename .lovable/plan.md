

# Strategy Lab Robustness Upgrade: AI-Driven Playbook Tweaking + Gap Analysis

## Gaps Found in Current Implementation

1. **No playbook modification from Strategy Lab** — The AI can suggest changes but cannot apply them. The user must manually copy suggestions and go to the Playbooks page to edit.

2. **No tool calling / structured output** — The LLM responds with free text only. It cannot execute actions like "update confirmation rule #3" or "add a new failure mode." This is the biggest gap for a robust refinement environment.

3. **No backtest result upload/analysis** — There's no way to import MT5 Strategy Tester results for the AI to analyze.

4. **No "Apply Suggestion" workflow** — When the AI suggests a rule change, there's no inline button to accept/reject and write it to the playbook.

5. **No checklist gap detection** — The AI doesn't analyze whether checklist questions cover all entry/confirmation/invalidation rules (a common oversight).

6. **No conversation export** — Can't export a strategy refinement session as markdown for reference.

7. **Quick actions are static** — They don't adapt based on whether a playbook is selected or what data is available.

8. **No abort/cancel stream** — Can't stop a long response mid-stream.

## Plan

### Step 1: Add Playbook Mutation via Tool Calling in Edge Function

Update `strategy-lab/index.ts` to use LLM tool calling. Define tools the AI can invoke:

- `update_playbook_rules` — Updates specific rule arrays (confirmation, invalidation, management, failure modes)
- `update_risk_limits` — Updates max R, max daily loss, max trades per session
- `update_filters` — Updates symbol/session/regime filters
- `add_checklist_question` — Adds a new checklist question
- `analyze_gaps` — Triggers a structured gap analysis of the playbook

When the AI calls a tool, the edge function executes the mutation via service role client and returns the result. The streamed response includes both the AI's reasoning AND the applied changes.

The frontend detects tool call results in the stream and shows inline confirmation cards ("Applied: Added failure mode 'Entering during news event'" with an Undo button).

### Step 2: Add Playbook Mutation Confirmation UI

New component `AppliedChangeCard.tsx` — rendered inline in chat messages when the AI applies a playbook change. Shows:
- What changed (field, old value, new value)
- Undo button (reverts via `useUpdatePlaybook`)
- Status indicator (applied / reverted)

Update `MessageContent` in `StrategyChat.tsx` to detect `[PLAYBOOK_UPDATE:...]` markers in AI responses and render `AppliedChangeCard` components.

### Step 3: Add Gap Analysis Quick Action

New quick action: "Analyze Playbook Gaps" — sends a structured prompt asking the AI to:
- Check if every entry rule has a corresponding confirmation
- Check if every confirmation has an invalidation
- Check if failure modes cover common mistakes from journal data
- Check if risk limits are set
- Check if checklist questions cover all rule categories
- Suggest missing rules based on AMT theory and the trader's actual performance data

### Step 4: Contextual Quick Actions

Make quick actions dynamic based on state:
- No playbook selected: "Teach AMT", "Design New Strategy"
- Playbook selected, no trades: "Analyze Gaps", "Generate EA", "Add Missing Rules"
- Playbook selected, has trades: "Analyze Performance", "Refine Based on Results", "Generate EA", "Analyze Gaps"

### Step 5: Stream Abort + Conversation Export

- Add AbortController to `handleSend` — new Stop button replaces Send during streaming
- Add export button in conversation list — downloads conversation as `.md` file

### Step 6: Backtest Report Upload

Add a file upload button in the chat input area. When a user uploads an MT5 HTML report:
- Parse it client-side (extract key metrics table from the HTML)
- Send parsed metrics as part of the next message context
- The AI analyzes the backtest results against the playbook rules and journal data

## Files to Create/Modify

| File | Change |
|------|--------|
| `supabase/functions/strategy-lab/index.ts` | Add tool definitions, handle tool calls, execute playbook mutations via service role |
| `src/components/strategy-lab/StrategyChat.tsx` | Dynamic quick actions, abort button, file upload for reports, render applied changes |
| `src/components/strategy-lab/AppliedChangeCard.tsx` | New — inline change confirmation with undo |
| `src/components/strategy-lab/ReportUpload.tsx` | New — MT5 HTML report parser + upload button |
| `src/components/strategy-lab/ConversationList.tsx` | Add export button |
| `src/pages/StrategyLab.tsx` | Wire abort controller, pass playbook mutation callbacks, invalidate playbook queries on changes |

No database migrations needed — playbook mutations use existing `playbooks` table. Tool calling uses the existing Lovable AI gateway.

