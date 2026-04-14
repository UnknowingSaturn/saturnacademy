

# Strategy Lab: AI Trading Advisor with AMT Knowledge Base

## What You Get

A dedicated `/strategy-lab` page with a full-featured AI chat environment that:
- Has deep Auction Market Theory (AMT) knowledge baked into its system prompt (value areas, POC, volume profiles, market profiles, TPOs, initial balance, single prints, poor highs/lows, excess, balance/imbalance, etc.)
- Pulls your actual playbook rules and journal trade history into every conversation for context
- Can generate and refine MQL5 EA code based on your strategies
- Supports conversation persistence so you can pick up where you left off

## Architecture

```text
┌─────────────────────┐     ┌──────────────────────────┐
│  Strategy Lab Page   │     │  strategy-lab Edge Fn     │
│                      │     │                           │
│  Chat Interface      │────▶│  AMT Knowledge Prompt     │
│  + Playbook Selector │     │  + User's Playbook Rules  │
│  + Journal Context   │     │  + Recent Trade Stats     │
│  + Code Viewer       │◀────│  + Gemini 2.5 Pro         │
│  + Conversation List │     │  + Streaming SSE          │
└─────────────────────┘     └──────────────────────────┘
```

## The AMT Knowledge Base

Instead of a separate vector DB (which adds complexity and cost), the system prompt will contain a comprehensive, curated AMT reference covering:
- **Market Profile**: TPO charts, initial balance, value area (VA), POC, single prints, poor highs/lows, excess
- **Volume Profile**: VPOC, HVN, LVN, developing vs composite profiles, naked POCs
- **Auction Theory**: Balance vs imbalance, initiative vs responsive activity, rotational vs trending days
- **Day Types**: Normal, normal variation, trend, double distribution, P-shape, b-shape
- **Practical Application**: How to identify rotation entries at VA extremes, breakout entries beyond balance, mean reversion at POC

This is ~3-4K tokens of dense reference material that stays in the system prompt. Gemini 2.5 Pro handles this context size easily.

## Implementation

### Phase 1: Edge Function — `strategy-lab`
- Rich AMT system prompt (~3K tokens of curated theory)
- Fetches user's playbooks from DB (rules, symbols, sessions)
- Fetches recent trade stats (last 30 trades: win rate by session/symbol, common mistakes from journal)
- Streams responses via SSE using Gemini 2.5 Pro (best for complex reasoning)
- Supports conversation modes: "refine strategy", "generate EA code", "analyze performance", "teach AMT concept"

### Phase 2: Database — Conversation Persistence
- New table: `strategy_conversations` (id, user_id, title, playbook_id, messages JSONB, created_at, updated_at)
- Lets users save/resume conversations, review past strategy discussions

### Phase 3: Frontend — Strategy Lab Page
- `/strategy-lab` route with sidebar listing saved conversations
- Playbook selector dropdown — loads relevant rules into context
- Chat interface with markdown rendering (code blocks for MQL5)
- Quick action buttons: "Generate EA from this playbook", "Analyze my recent performance", "Explain this AMT concept"
- Code viewer panel that renders MQL5 output with syntax highlighting and a copy/download button

### Phase 4: Context Injection
- When a playbook is selected, the edge function automatically includes:
  - All playbook rules (entry, confirmation, invalidation, management, failure modes)
  - Symbol and session filters
  - Last 20 trades matching that playbook: win/loss, R-multiples, common journal notes
  - Aggregate stats: win rate, avg R, best/worst sessions

## Files to Create/Modify

| File | Purpose |
|------|---------|
| `supabase/functions/strategy-lab/index.ts` | Edge function with AMT knowledge + playbook/journal context + streaming |
| `src/pages/StrategyLab.tsx` | Main page with chat UI |
| `src/components/strategy-lab/StrategyChat.tsx` | Chat interface with markdown + code rendering |
| `src/components/strategy-lab/ConversationList.tsx` | Saved conversation sidebar |
| `src/components/strategy-lab/CodeViewer.tsx` | MQL5 code display with copy/download |
| `src/App.tsx` | Add `/strategy-lab` route |
| `src/components/layout/AppSidebar.tsx` | Add Strategy Lab nav item |
| DB migration | `strategy_conversations` table with RLS |

## Model Choice

Using `google/gemini-2.5-pro` for this — it has the largest context window, strongest reasoning, and handles the combination of AMT theory + playbook rules + trade history + code generation best. The cost per message is ~$0.01, acceptable for strategy refinement work.

## What This Is NOT

- Not a real-time trading signal generator (that stays in the EA)
- Not a vector database RAG system (overkill — curated prompt knowledge is better for a focused domain like AMT)
- Not a backtester (MT5 Strategy Tester handles that locally)

It's a **strategy refinement workbench** — think of it as having a senior AMT trader available 24/7 who knows your exact playbooks and performance history.

