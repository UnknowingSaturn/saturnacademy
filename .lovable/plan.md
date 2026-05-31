# Phase 1 — Web Copier Console (unblock iteration loop)

Goal: stop rebuilding/reinstalling the desktop app to fix UI bugs. After Phase 1, the **Setup Wizard** and **Dashboard/Receivers** live in the web app with hot-reload. Trade execution stays 100% local and unchanged.

## Architecture

```text
┌──────────────────┐   commands (poll 1-2s)   ┌──────────────────┐
│   Web Console    │ ───────────────────────► │  Desktop Agent   │
│  (Lovable app)   │ ◄─────────────────────── │  (Rust, headless)│
└──────────────────┘   state (push 5-10s)     └────────┬─────────┘
                                                       │ file IPC <100ms
                                              ┌────────▼─────────┐
                                              │ Master + Receiver│
                                              │   MT5 + EAs      │
                                              └──────────────────┘
```

- Hot path (trade copying): unchanged. Master EA → desktop file-watcher → receiver EA. No cloud hop.
- Control path (clicks, config): web → edge fn → `agent_commands` → desktop poll → ack. ~1–3s.
- Observability: desktop pushes telemetry to `agent_state`; web subscribes via realtime.

## Backend changes

**New tables:**
- `agent_state` — one row per `(user_id, install_id)`. Fields: `status` (running/paused/error), `version`, `last_heartbeat_at`, `terminals` (jsonb: discovered MT5 installs + EA status), `receivers_status` (jsonb: per-receiver paused/active, last execution).
- `agent_commands` — queue. Fields: `user_id`, `install_id`, `command` (enum: `pause_receiver`, `resume_receiver`, `sync_positions`, `rescan_terminals`, `reload_config`), `payload` jsonb, `status` (pending/acked/done/error), `created_at`, `acked_at`, `result` jsonb.

Both with RLS scoped to `auth.uid()`, GRANTs for `authenticated` + `service_role`, realtime enabled.

**New edge functions:**
- `agent-state` — desktop POSTs telemetry here (existing setup-token auth pattern).
- `agent-commands` — desktop GETs pending commands and PATCHes their status; web POSTs new commands.

## Desktop changes (small, stable)

Two new Rust modules in `copier-desktop/src-tauri/src/sync/`:
- `state.rs` — every 5–10s, push agent state (terminals discovered, receivers status, version, errors) to `agent-state`.
- `commands.rs` — every 1–2s, poll `agent-commands` for pending items. Handlers wrap **existing** functions (`copier::pause_receiver`, `position_sync::sync_now`, `mt5::discovery::rescan`, `sync::config::reload`). Ack on receipt, mark done on completion.

No new business logic — just thin adapters. Existing Tauri UI continues to work as fallback.

## Web changes

**New page:** `src/pages/CopierConsole.tsx` mounted at `/copier/console`.

**New components under `src/components/copier/console/`:**
- `WizardView.tsx` — port the 5-step wizard. Reuse the existing step components' logic; rewrite to read terminals from `agent_state` instead of Tauri `invoke`, and submit final config to existing `copier-config` edge function (already exists).
- `WizardSteps/` — `TerminalScan`, `MasterSelection`, `ReceiverSelection`, `RiskConfig`, `SymbolMapping`, `Confirmation`. Direct ports of `copier-desktop/src/components/wizard/*`.
- `ReceiversPanel.tsx` — grid showing each receiver from `agent_state.receivers_status`. Pause/resume buttons dispatch commands via `agent-commands`.
- `AgentStatusBadge.tsx` — heartbeat freshness indicator (green <30s, amber <2min, red otherwise).

**New hook:** `src/hooks/useAgentState.tsx` — fetch + realtime subscription on `agent_state`.
**New hook:** `src/hooks/useAgentCommand.tsx` — `dispatch(command, payload)` → insert into `agent_commands`, wait for `done` status with timeout.

**Nav:** add "Copier Console" entry in `AppSidebar.tsx`.

## What stays in the desktop app (this phase)

Existing Tauri UI is kept as fallback. Nothing deleted yet. Slim-down happens in Phase 3 once web parity is confirmed.

## Pairing UX

Web shows a one-time pairing code on first console visit (reuse `setup_tokens` table + `copier-setup-token` edge function — already built). User pastes into desktop's existing setup screen. Desktop stores `install_id` + auth token, starts pushing state.

## Out of scope (later phases)

- Phase 2: Terminal Manager, Positions Panel, Position Sync dialog, Diagnostics, Settings → web.
- Phase 3: delete unused React screens + Tauri `invoke` handlers; shrink desktop binary.

## Acceptance

- Open `/copier/console` in web, see live agent status + receivers, pause/resume a receiver within 3s.
- Run the full wizard in web, save config, confirm desktop reloads and trades copy at unchanged latency.
- Fix a UI bug in the wizard with `npm run dev` hot-reload — no desktop rebuild.

## Deliverables

- 1 migration (2 tables + RLS + GRANTs + realtime).
- 2 edge functions (`agent-state`, `agent-commands`).
- 2 Rust modules (`sync/state.rs`, `sync/commands.rs`) + wire-up in `main.rs`.
- ~8 web files (1 page, 6 components, 2 hooks) + sidebar entry.
