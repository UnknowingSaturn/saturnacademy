## Verification Report — Trading Coach

Verified end-to-end. Everything from the last turn is present and wired correctly.

### Backend
- **Tables**: `coach_threads`, `coach_messages`, `coach_embed_queue`, `trade_embeddings` all exist in `public`.
- **RPC + triggers**: `match_user_trades`, `enqueue_trade_embed`, and `trg_enqueue_trade_embed` all present (visible in db-functions listing).
- **Edge functions**: `coach-chat`, `coach-embed-trade`, `coach-drain-embeddings` deployed. `coach-chat` uses `google/gemini-2.5-pro`, embed pipeline uses `openai/text-embedding-3-small` (1536-dim, matches HNSW-safe schema).
- **Storage**: private `coach-uploads` bucket exists.
- **Auth**: coach functions are not overridden in `config.toml`, so they default to `verify_jwt = true` — correct for user-scoped endpoints.

### Frontend
- `CoachProvider`, `CoachFab`, and `CoachPanel` all mounted in `src/App.tsx`.
- `/coach` route registered under `ProtectedRoute`.
- Sidebar entry "Coach" added in `AppSidebar.tsx`.
- FAB correctly hidden on `/auth`, `/reset-password`, `/r/*`, and `/coach`.
- `useCoach.tsx` invokes `coach-chat`, signs private-bucket attachment URLs, and invalidates thread + message queries on send.
- `CoachComposer` enforces 3-attachment cap, drag/paste/upload, Enter-to-send.
- Typecheck: **passes** (`tsgo --noEmit` clean).

### One minor nit (non-blocking)
The **sheet-panel** `CoachPanel.handleSend` prefixes the user's message with a `[Context: trade …]` string when a trade is attached, but the **full-page** `Coach.tsx` `handleSend` does not. If you want context parity between the FAB panel and `/coach`, I can mirror that prefix (and ideally move it into `useSendCoachMessage` so both surfaces stay in sync automatically).

Want me to fix that parity nit, or leave it as-is?