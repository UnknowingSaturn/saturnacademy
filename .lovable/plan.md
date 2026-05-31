
# Wire the desktop agent to the web Copier Console

Goal: when the desktop app starts, it begins (1) pushing telemetry to `agent_state` every ~7s and (2) polling `agent_commands` every ~2s and executing them against your existing copier functions. No new business logic — just adapters around what already exists.

## 1. Persist a stable `install_id`

The cloud keys every row on `(user_id, install_id)`. The desktop currently saves `api_key` to disk but has no `install_id`. Add one next to it.

`copier-desktop/src-tauri/src/sync/config.rs` — add:

```rust
const INSTALL_ID_FILE: &str = "install_id";

pub fn load_or_create_install_id() -> Result<String, ConfigError> {
    let path = directories::ProjectDirs::from("com", "saturn", "tradecopier")
        .map(|d| d.config_dir().join(INSTALL_ID_FILE))
        .ok_or_else(|| ConfigError::StorageError("no config dir".into()))?;
    if let Ok(s) = std::fs::read_to_string(&path) {
        let id = s.trim().to_string();
        if !id.is_empty() { return Ok(id); }
    }
    if let Some(parent) = path.parent() { let _ = std::fs::create_dir_all(parent); }
    let id = uuid::Uuid::new_v4().to_string();
    std::fs::write(&path, &id).map_err(|e| ConfigError::StorageError(e.to_string()))?;
    Ok(id)
}
```

Add `uuid = { version = "1", features = ["v4"] }` to `copier-desktop/src-tauri/Cargo.toml` if it isn't there already.

## 2. Build a snapshotter

In `main.rs`, between `manage(app_state)` and `.invoke_handler(...)`, capture what `sync::state::spawn` needs. The snapshot is built on demand each tick from things already in memory or cheap to read.

```rust
use sync::state::{AgentSnapshot, TerminalInfo, ReceiverStatus};

let install_id = sync::config::load_or_create_install_id()
    .unwrap_or_else(|_| "unknown".into());

let copier_for_snapshot = app_state.copier.clone();
let install_id_for_snapshot = install_id.clone();

let snapshotter: sync::state::Snapshotter = std::sync::Arc::new(move || {
    let copier = copier_for_snapshot.lock();

    // Reuse the existing discovery cache — cheap, already used by tray/diagnostics
    let terminals = mt5::discovery::discover_all_terminals()
        .into_iter()
        .map(|t| TerminalInfo {
            install_id: t.terminal_id.clone(),
            data_path: Some(t.data_folder.clone()),
            ea_attached: Some(matches!(t.ea_status, mt5::discovery::EAStatus::Attached)),
            active_login: t.login.map(|l| l.to_string()),
            account_number: t.login.map(|l| l.to_string()),
        })
        .collect();

    // Receivers come from the loaded config; pause state lives in safety module
    let receivers_status = copier.config.as_ref().map(|c| {
        c.receivers.iter().map(|r| ReceiverStatus {
            account_id: r.account_id.clone(),
            name: Some(format!("{} - {}", r.broker, r.account_number)),
            paused: Some(copier::safety::is_receiver_paused(&r.account_id)),
            last_execution_at: None,
            last_error: None,
        }).collect()
    }).unwrap_or_default();

    AgentSnapshot {
        install_id: install_id_for_snapshot.clone(),
        status: if copier.is_running { "running".into() } else { "paused".into() },
        version: env!("CARGO_PKG_VERSION").into(),
        last_error: copier.last_error.clone(),
        terminals,
        receivers_status,
    }
});
```

If `copier::safety::is_receiver_paused` doesn't exist with that exact signature, substitute the actual lookup — the goal is just a `bool` per receiver. If unsure, hardcode `Some(false)` for now and refine later.

## 3. Build the command router

Each handler is a thin wrapper around a function you already export from `copier::commands` or `copier::position_sync`.

```rust
use sync::commands::CommandRouter;
use serde_json::json;

let mut router = CommandRouter::new();

// pause_receiver { receiver_terminal_id }
router.on("pause_receiver", |payload| async move {
    let id = payload["receiver_terminal_id"].as_str()
        .ok_or("receiver_terminal_id required")?.to_string();
    copier::commands::pause_all_receivers(&[id]).map_err(|e| e.to_string())?;
    Ok(json!({}))
});

router.on("resume_receiver", |payload| async move {
    let id = payload["receiver_terminal_id"].as_str()
        .ok_or("receiver_terminal_id required")?.to_string();
    copier::commands::resume_all_receivers(&[id]).map_err(|e| e.to_string())?;
    Ok(json!({}))
});

// sync_positions { master_terminal_id, receiver_terminal_ids: [..] }
router.on("sync_positions", |payload| async move {
    let master = payload["master_terminal_id"].as_str().unwrap_or("").to_string();
    let receivers: Vec<String> = payload["receiver_terminal_ids"].as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();
    let report = copier::position_sync::generate_sync_report(&master, &receivers)
        .map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(report).unwrap_or(json!({})))
});

router.on("rescan_terminals", |_payload| async move {
    let terms = mt5::discovery::refresh_discovery_cache();
    Ok(json!({ "count": terms.len() }))
});

// reload_config — re-fetch from cloud and stash in CopierState
let copier_for_reload = app_state.copier.clone();
router.on("reload_config", move |_payload| {
    let copier = copier_for_reload.clone();
    async move {
        let api_key = { copier.lock().api_key.clone() }
            .ok_or("no api key")?;
        let cfg = sync::config::fetch_config(&api_key).await
            .map_err(|e| e.to_string())?;
        let mut c = copier.lock();
        c.config = Some(cfg);
        c.last_sync = Some(chrono::Utc::now().to_rfc3339());
        Ok(json!({}))
    }
});

let router = std::sync::Arc::new(router);
```

## 4. Spawn both loops inside `.setup(...)`

Inside the existing `.setup(|app| { ... })` closure, after the file-watcher thread is spawned, add:

```rust
let api_key = state.copier.lock().api_key.clone();
if let Some(key) = api_key {
    sync::state::spawn(key.clone(), snapshotter.clone());
    sync::commands::spawn(key, install_id.clone(), router.clone());
} else {
    tracing::warn!("Agent sync not started — no API key yet. Pair the desktop in the web Console.");
}
```

To make pairing also start the loops without restart, do the same `spawn` calls at the end of the existing `set_api_key` Tauri command after `save_api_key` succeeds. Guard with a `OnceCell<()>` so they only spawn once per process.

## 5. Order of operations in `main()`

The full sequence becomes:

```text
init logging
build AppState
load_api_key (already exists)
load_or_create_install_id          ← new
build snapshotter closure          ← new
build CommandRouter                ← new
tauri::Builder
  .manage(app_state)
  .invoke_handler(...)
  .setup(|app| {
     show window, start file_watcher, start execution-upload loop (existing)
     if api_key present: sync::state::spawn + sync::commands::spawn   ← new
  })
  .run(...)
```

## 6. Verification

1. `cargo check -p copier-desktop` (you'll run the build; we won't here).
2. Start the desktop app on a paired machine.
3. In Supabase: `select install_id, status, last_heartbeat_at, jsonb_array_length(terminals) from agent_state;` — a fresh row should appear within ~10s.
4. Open `/copier/console` in the web app — `useAgentState` should populate, `AgentStatusBadge` should go green.
5. Click pause on a receiver in `ReceiversPanel` — within ~3s the desktop logs should show the command processed and the receiver's `paused` flag should flip on the next telemetry tick.

## Notes / things to confirm while wiring

- `copier::safety` — confirm the actual function name to read a receiver's paused state. If none exists, expose a small `pub fn is_receiver_paused(account_id: &str) -> bool` reading the same JSON `safety_state.json` referenced in `export_debug_bundle`.
- `mt5::discovery::EAStatus::Attached` — confirm the variant name; adjust the `ea_attached` match accordingly.
- `position_sync::generate_sync_report` returns `PositionSyncStatus` (already `Serialize`), so `to_value` is safe.
- Existing Tauri UI keeps working — the agent loops are additive.

## Deliverables

- Edit `copier-desktop/src-tauri/Cargo.toml` (add `uuid` if missing).
- Edit `copier-desktop/src-tauri/src/sync/config.rs` (add `load_or_create_install_id`).
- Edit `copier-desktop/src-tauri/src/main.rs` (snapshotter, router, two `spawn` calls in `setup`, also in `set_api_key`).
- Optional: small `is_receiver_paused` helper in `copier::safety`.
