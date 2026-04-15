

# Robust EA Development Pipeline

## The Problem

The current approach sends one massive prompt (AMT knowledge + playbook + all rules) to `gemini-2.5-pro` with `reasoning: high`, asks it to generate a complete EA in one shot, and hopes for the best. This fails because:

1. **Latency**: 30-60s before first token. Often times out with no feedback.
2. **No validation loop**: A single prompt cannot produce a robust EA. The AI has no way to verify its own output.
3. **Verbose output**: No conciseness instructions, so it explains every line instead of focusing on correct code.
4. **No error feedback**: If the stream fails or returns empty, the user sees nothing.

## The Right Approach: Iterative Refinement, Not Single-Shot

The robustness comes from the **process**, not from making the AI think harder. The MT5 Strategy Tester is the ultimate validator — the AI's job is to produce compilable, well-structured code quickly so the human can test it, upload results, and iterate.

The pipeline should be:

```text
Playbook Rules
     ↓
AI asks clarifying questions about ambiguous rules
     ↓
AI generates complete EA (fast, focused)
     ↓
User compiles & runs in MT5 Strategy Tester
     ↓
User uploads HTML report
     ↓
AI analyzes results against playbook expectations
     ↓
AI suggests specific parameter/logic changes
     ↓
AI generates updated EA (with full diff explanation)
     ↓
Repeat until metrics meet thresholds
```

This loop already exists in the 3-phase UI. The fix is making each step **reliable and fast** rather than trying to make one step do everything.

## Changes

### 1. Per-Mode Model Selection (Edge Function)

Instead of using `gemini-2.5-pro` with `high` reasoning for everything:

| Mode | Model | Reasoning | Rationale |
|------|-------|-----------|-----------|
| `code_generation` | `google/gemini-2.5-flash` | `medium` | Code generation needs speed and accuracy, not deep philosophical reasoning. Flash is excellent at structured code output. |
| `backtest_analysis` | `google/gemini-2.5-flash` | `medium` | Structured metric interpretation — speed matters for iteration. |
| `chat` | `google/gemini-2.5-pro` | `medium` | Deep AMT discussions benefit from Pro, but `high` reasoning is overkill and causes timeouts. |
| `gap_analysis` | `google/gemini-2.5-pro` | `medium` | Needs tool calling + systematic analysis. |
| `performance_analysis` | `google/gemini-2.5-flash` | `medium` | Data-driven, structured output. |

This does NOT reduce quality — it reduces latency from 30-60s to 3-5s first token, enabling faster iteration cycles. More iterations = better EAs.

### 2. Focused Code Generation Prompt (Edge Function)

The `buildCodeGenPrompt` currently includes 107 lines of AMT theory that the model already knows. For code generation, trim to:
- Playbook context (the actual rules)
- MQL5 code standards section (structure, required inputs, risk management)
- Conciseness instruction: "Output the complete MQL5 code in a single code block. Keep explanations to 2-3 sentences before the code and a brief 'what to test' summary after. Do NOT explain every function."

The AMT knowledge stays in `chat` and `gap_analysis` modes where it's actually needed.

### 3. Alpha Builder Conversation Flow (Edge Function)

When the user says "build my alpha" or "generate EA", the code_generation prompt already instructs the AI to ask clarifying questions. But it also says "Generate the complete EA with all rules implemented" — contradictory. Fix:

Add explicit instruction: "If the user's first message is about building/generating an EA, start by listing each playbook rule and asking which are mechanically codeable vs. discretionary. Only generate code after the user confirms the rule mapping. For subsequent messages in the same conversation (refinement requests), generate the complete updated EA immediately."

This ensures the first generation is deliberate, while refinement iterations are fast.

### 4. Timeout and Error Handling (Frontend Hook)

In `useStrategyLabChat.ts`:
- Add a 90-second timeout using `setTimeout` that calls `controller.abort()`
- If the stream completes but `assistantContent` is empty, show: "AI returned an empty response. Try again or simplify your request."
- If the fetch times out, show: "Request timed out. Try again — the AI service may be under load."
- Clear the timeout on successful completion

### 5. CodeViewer forwardRef Fix

Wrap `CodeViewer` with `React.forwardRef` to eliminate the console warning when rendered inside chat messages.

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/strategy-lab/index.ts` | Per-mode model/reasoning selection; trim AMT from code_generation prompt; add alpha-builder conversation flow instruction |
| `src/hooks/useStrategyLabChat.ts` | Add 90s timeout, empty response error toast |
| `src/components/strategy-lab/CodeViewer.tsx` | Wrap with forwardRef |

## What This Does NOT Change

- The 3-phase pipeline (Build → Run → Analyze) stays exactly as-is
- The tool-calling system for playbook modifications stays
- The AMT knowledge base stays for chat/gap analysis modes
- The backtest report parsing and metrics display stays
- No database changes

