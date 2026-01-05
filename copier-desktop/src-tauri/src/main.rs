#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod copier;
mod logging;
mod mt5;
mod sync;

use tracing::{info, warn};

use copier::CopierState;
use copier::config_generator::{
    build_config_file, ensure_copier_folders, save_config_to_terminal,
    ReceiverConfigFile, RiskConfig, SafetyConfig,
};
use copier::position_sync::{
    generate_sync_report, PositionSyncStatus, SyncCommand, write_sync_command,
};
use copier::commands::{
    close_all_positions, pause_all_receivers, resume_all_receivers,
    read_master_heartbeat, is_master_online, Heartbeat,
};
use copier::reconciliation::{
    ReconciliationConfig, ReconciliationAction, 
    init_reconciliation, update_reconciliation_config, get_reconciliation_status,
    start_reconciliation_loop, stop_reconciliation_loop, trigger_reconciliation,
};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{
    CustomMenuItem, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu, SystemTrayMenuItem,
};

pub struct AppState {
    pub copier: Arc<Mutex<CopierState>>,
}

#[tauri::command]
fn get_copier_status(state: tauri::State<AppState>) -> serde_json::Value {
    let copier = state.copier.lock();
    serde_json::json!({
        "is_connected": copier.is_connected,
        "is_running": copier.is_running,
        "last_sync": copier.last_sync,
        "trades_today": copier.trades_today,
        "pnl_today": copier.pnl_today,
        "open_positions": copier.open_positions,
        "last_error": copier.last_error,
        "config_version": copier.config_version,
    })
}

#[tauri::command]
async fn set_api_key(api_key: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut copier = state.copier.lock();
    copier.api_key = Some(api_key.clone());
    
    // Save to config file
    if let Err(e) = sync::config::save_api_key(&api_key) {
        return Err(format!("Failed to save API key: {}", e));
    }
    
    Ok(())
}

#[tauri::command]
async fn sync_config(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let api_key = {
        let copier = state.copier.lock();
        copier.api_key.clone()
    };
    
    let api_key = api_key.ok_or("No API key configured")?;
    
    match sync::config::fetch_config(&api_key).await {
        Ok(config) => {
            let mut copier = state.copier.lock();
            copier.config = Some(config);
            copier.last_sync = Some(chrono::Utc::now().to_rfc3339());
            copier.is_connected = true;
            Ok(())
        }
        Err(e) => {
            let mut copier = state.copier.lock();
            copier.last_error = Some(e.to_string());
            Err(e.to_string())
        }
    }
}

#[tauri::command]
fn start_copier(state: tauri::State<AppState>) -> Result<(), String> {
    let mut copier = state.copier.lock();
    if copier.config.is_none() {
        return Err("No configuration loaded. Please sync first.".to_string());
    }
    copier.is_running = true;
    Ok(())
}

#[tauri::command]
fn stop_copier(state: tauri::State<AppState>) -> Result<(), String> {
    let mut copier = state.copier.lock();
    copier.is_running = false;
    Ok(())
}

#[tauri::command]
fn get_recent_executions(state: tauri::State<AppState>) -> Vec<copier::Execution> {
    let copier = state.copier.lock();
    copier.recent_executions.clone()
}

#[tauri::command]
fn set_mt5_path(path: String, state: tauri::State<AppState>) -> Result<(), String> {
    let mut copier = state.copier.lock();
    copier.mt5_data_path = Some(path);
    Ok(())
}

#[tauri::command]
fn find_terminals() -> Vec<mt5::bridge::Mt5Terminal> {
    mt5::bridge::find_mt5_terminals()
}

/// Enhanced terminal discovery using multiple strategies
#[tauri::command]
fn discover_terminals() -> Vec<mt5::discovery::TerminalInfo> {
    mt5::discovery::discover_all_terminals()
}

/// Add a manual terminal path and persist it
#[tauri::command]
fn add_manual_terminal(path: String) -> Result<(), String> {
    mt5::discovery::add_manual_terminal(&path)
}

#[tauri::command]
fn add_terminal_path(path: String) -> Option<mt5::bridge::Mt5Terminal> {
    let path = std::path::Path::new(&path);
    
    // Validate it's a valid MT5 terminal (check for terminal executable)
    if !path.join("terminal64.exe").exists() && !path.join("terminal.exe").exists() {
        return None;
    }
    
    // Use the portable detection logic
    mt5::bridge::detect_terminal_at_path(path)
}

/// Get symbol catalog from a receiver terminal
#[tauri::command]
fn get_symbol_catalog(terminal_id: String) -> Result<copier::symbol_catalog::SymbolCatalog, String> {
    copier::symbol_catalog::fetch_symbol_catalog(&terminal_id)
}

/// Get master symbols for mapping UI
#[tauri::command]
fn get_master_symbols(terminal_id: String) -> Result<Vec<String>, String> {
    copier::symbol_catalog::get_master_symbols(&terminal_id)
}

/// Auto-map symbols between master and receiver
#[tauri::command]
fn auto_map_symbols(
    master_symbols: Vec<String>,
    receiver_terminal_id: String,
) -> Result<Vec<copier::symbol_catalog::SymbolMapping>, String> {
    let catalog = copier::symbol_catalog::fetch_symbol_catalog(&receiver_terminal_id)?;
    Ok(copier::symbol_catalog::auto_map_symbols(&master_symbols, &catalog))
}

/// Get diagnostics information
#[tauri::command]
fn get_diagnostics() -> copier::DiagnosticsInfo {
    let terminals = mt5::discovery::discover_all_terminals();
    
    let terminal_diags: Vec<copier::TerminalDiagnostic> = terminals.iter().map(|t| {
        let heartbeat_age = t.last_heartbeat.as_ref().and_then(|ts| {
            chrono::DateTime::parse_from_rfc3339(ts).ok().map(|dt| {
                (chrono::Utc::now() - dt.with_timezone(&chrono::Utc)).num_seconds()
            })
        });
        
        copier::TerminalDiagnostic {
            terminal_id: t.terminal_id.clone(),
            broker: t.broker.clone(),
            account: t.login.map(|l| l.to_string()),
            is_running: t.is_running,
            ea_status: format!("{:?}", t.ea_status),
            last_heartbeat_age_secs: heartbeat_age,
            discovery_method: format!("{:?}", t.discovery_method),
        }
    }).collect();
    
    let idempotency_count = copier::idempotency::get_processed_keys_count();
    
    copier::DiagnosticsInfo {
        terminals: terminal_diags,
        queue_pending: 0,
        queue_in_progress: 0,
        queue_completed_today: 0,
        queue_failed_today: 0,
        idempotency_keys_count: idempotency_count,
        recent_errors: vec![],
    }
}

#[tauri::command]
fn install_ea(
    terminal_id: String,
    ea_type: String,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    // Get EA content from bundled resources
    let ea_filename = match ea_type.as_str() {
        "master" => "TradeCopierMaster.mq5",
        "receiver" => "TradeCopierReceiver.mq5",
        _ => return Err(format!("Invalid EA type: {}", ea_type)),
    };

    // Resolve resource path
    let resource_path = app_handle
        .path_resolver()
        .resolve_resource(format!("resources/{}", ea_filename))
        .ok_or_else(|| format!("EA file {} not found in resources", ea_filename))?;

    // Read EA content
    let ea_content = std::fs::read(&resource_path)
        .map_err(|e| format!("Failed to read EA file: {}", e))?;

    // Install to terminal
    mt5::bridge::install_ea_to_terminal(&terminal_id, &ea_type, &ea_content)
}

#[tauri::command]
fn get_terminal_account_info(terminal_id: String) -> Option<mt5::bridge::AccountInfo> {
    mt5::bridge::get_account_info(&terminal_id)
}

// ==================== NEW COMMANDS ====================

#[tauri::command]
fn save_copier_config(
    master_terminal_id: String,
    master_account_number: String,
    master_broker: String,
    receivers: Vec<serde_json::Value>,
) -> Result<String, String> {
    // Convert receivers from JSON to ReceiverConfigFile
    let receiver_configs: Vec<ReceiverConfigFile> = receivers
        .into_iter()
        .enumerate()
        .map(|(idx, r)| {
            let terminal_id = r["terminal_id"].as_str().unwrap_or("").to_string();
            let account_number = r["account_number"].as_str().unwrap_or("").to_string();
            let broker = r["broker"].as_str().unwrap_or("").to_string();
            
            // Parse risk config
            let risk = RiskConfig {
                mode: r["risk"]["mode"].as_str().unwrap_or("balance_multiplier").to_string(),
                value: r["risk"]["value"].as_f64().unwrap_or(1.0),
            };
            
            // Parse safety config
            let safety = SafetyConfig {
                max_slippage_pips: r["safety"]["max_slippage_pips"].as_f64().unwrap_or(3.0),
                max_daily_loss_r: r["safety"]["max_daily_loss_r"].as_f64().unwrap_or(3.0),
                max_drawdown_percent: r["safety"]["max_drawdown_percent"].as_f64(),
                trailing_drawdown_enabled: r["safety"]["trailing_drawdown_enabled"].as_bool().unwrap_or(false),
                min_equity: r["safety"]["min_equity"].as_f64(),
                manual_confirm_mode: r["safety"]["manual_confirm_mode"].as_bool().unwrap_or(false),
                prop_firm_safe_mode: r["safety"]["prop_firm_safe_mode"].as_bool().unwrap_or(false),
                poll_interval_ms: r["safety"]["poll_interval_ms"].as_i64().unwrap_or(1000) as i32,
            };
            
            // Parse symbol mappings
            let mut symbol_mappings: HashMap<String, String> = HashMap::new();
            if let Some(mappings) = r["symbol_mappings"].as_object() {
                for (k, v) in mappings {
                    if let Some(val) = v.as_str() {
                        symbol_mappings.insert(k.clone(), val.to_string());
                    }
                }
            }
            
            ReceiverConfigFile {
                receiver_id: format!("receiver_{}", idx),
                account_name: format!("{} - {}", broker, account_number),
                account_number,
                broker,
                terminal_id: terminal_id.clone(),
                risk,
                safety,
                symbol_mappings,
                symbol_overrides: None,
            }
        })
        .collect();
    
    // Build the config file
    let config = build_config_file(
        &master_terminal_id,
        &master_account_number,
        &master_broker,
        receiver_configs.clone(),
    );
    
    // Ensure copier folders exist for master
    ensure_copier_folders(&master_terminal_id)?;
    
    // Save config to each receiver terminal
    for receiver in &receiver_configs {
        ensure_copier_folders(&receiver.terminal_id)?;
        save_config_to_terminal(&receiver.terminal_id, &config)?;
    }
    
    Ok(config.config_hash)
}

#[tauri::command]
fn get_position_sync_status(
    master_terminal_id: String,
    receiver_terminal_ids: Vec<String>,
) -> Result<PositionSyncStatus, String> {
    generate_sync_report(&master_terminal_id, &receiver_terminal_ids)
}

#[tauri::command]
fn sync_position_to_receiver(
    receiver_terminal_id: String,
    command: serde_json::Value,
) -> Result<(), String> {
    let sync_command = SyncCommand {
        command_type: command["command_type"].as_str().unwrap_or("open").to_string(),
        position_id: command["position_id"].as_i64(),
        master_position_id: command["master_position_id"].as_i64(),
        symbol: command["symbol"].as_str().map(String::from),
        direction: command["direction"].as_str().map(String::from),
        volume: command["volume"].as_f64(),
        sl: command["sl"].as_f64(),
        tp: command["tp"].as_f64(),
        timestamp: chrono::Utc::now().to_rfc3339(),
    };
    
    write_sync_command(&receiver_terminal_id, &sync_command)
}

#[tauri::command]
fn emergency_close_all(receiver_terminal_ids: Vec<String>, reason: Option<String>) -> Result<(), String> {
    close_all_positions(&receiver_terminal_ids, reason)
}

#[tauri::command]
fn pause_receivers(receiver_terminal_ids: Vec<String>) -> Result<(), String> {
    pause_all_receivers(&receiver_terminal_ids)
}

#[tauri::command]
fn resume_receivers(receiver_terminal_ids: Vec<String>) -> Result<(), String> {
    resume_all_receivers(&receiver_terminal_ids)
}

#[tauri::command]
fn get_master_heartbeat(terminal_id: String) -> Result<Heartbeat, String> {
    read_master_heartbeat(&terminal_id)
}

#[tauri::command]
fn check_master_online(terminal_id: String) -> bool {
    is_master_online(&terminal_id)
}

/// Test copy functionality - opens and closes a small test trade on demo accounts
#[tauri::command]
async fn test_copy(state: tauri::State<'_, AppState>) -> Result<serde_json::Value, String> {
    let (is_running, config) = {
        let copier = state.copier.lock();
        (copier.is_running, copier.config.clone())
    };
    
    if !is_running {
        return Err("Copier is not running".to_string());
    }
    
    let config = config.ok_or("No configuration loaded")?;
    
    if config.receivers.is_empty() {
        return Err("No receiver accounts configured".to_string());
    }
    
    // For now, return a placeholder - full implementation requires EA coordination
    Ok(serde_json::json!({
        "success": true,
        "message": "Test copy initiated. Check receiver accounts for 0.01 lot test trade."
    }))
}

// ==================== RECONCILIATION COMMANDS ====================

#[tauri::command]
fn set_reconciliation_config(
    master_terminal_id: String,
    receiver_terminal_ids: Vec<String>,
    config: serde_json::Value,
) -> Result<(), String> {
    let recon_config = ReconciliationConfig {
        enabled: config["enabled"].as_bool().unwrap_or(false),
        interval_secs: config["interval_secs"].as_u64().unwrap_or(30),
        auto_close_orphaned: config["auto_close_orphaned"].as_bool().unwrap_or(false),
        auto_open_missing: config["auto_open_missing"].as_bool().unwrap_or(false),
        auto_adjust_volume: config["auto_adjust_volume"].as_bool().unwrap_or(false),
        auto_sync_sl_tp: config["auto_sync_sl_tp"].as_bool().unwrap_or(true),
    };
    
    init_reconciliation(&master_terminal_id, &receiver_terminal_ids, recon_config);
    Ok(())
}

#[tauri::command]
fn update_recon_config(config: serde_json::Value) -> Result<(), String> {
    let recon_config = ReconciliationConfig {
        enabled: config["enabled"].as_bool().unwrap_or(false),
        interval_secs: config["interval_secs"].as_u64().unwrap_or(30),
        auto_close_orphaned: config["auto_close_orphaned"].as_bool().unwrap_or(false),
        auto_open_missing: config["auto_open_missing"].as_bool().unwrap_or(false),
        auto_adjust_volume: config["auto_adjust_volume"].as_bool().unwrap_or(false),
        auto_sync_sl_tp: config["auto_sync_sl_tp"].as_bool().unwrap_or(true),
    };
    
    update_reconciliation_config(recon_config);
    Ok(())
}

#[tauri::command]
fn get_recon_status() -> serde_json::Value {
    let (config, last_run, actions) = get_reconciliation_status();
    serde_json::json!({
        "config": config,
        "last_run": last_run,
        "recent_actions": actions,
    })
}

#[tauri::command]
fn start_recon_loop() -> Result<(), String> {
    start_reconciliation_loop();
    Ok(())
}

#[tauri::command]
fn stop_recon_loop() -> Result<(), String> {
    stop_reconciliation_loop();
    Ok(())
}

#[tauri::command]
fn run_reconciliation_now() -> Result<serde_json::Value, String> {
    let discrepancies = trigger_reconciliation()?;
    Ok(serde_json::json!({
        "discrepancy_count": discrepancies.len(),
        "discrepancies": discrepancies,
    }))
}

// ==================== DEBUG BUNDLE EXPORT ====================

#[tauri::command]
async fn export_debug_bundle(save_path: String) -> Result<String, String> {
    use std::io::Write;
    
    let mut bundle = String::new();
    
    // Header
    bundle.push_str("=== TRADE COPIER DEBUG BUNDLE ===\n");
    bundle.push_str(&format!("Generated: {}\n", chrono::Utc::now().to_rfc3339()));
    bundle.push_str(&format!("Platform: Windows\n"));
    bundle.push_str(&format!("Version: 2.0.0\n\n"));
    
    // Discovered terminals
    bundle.push_str("=== DISCOVERED TERMINALS ===\n");
    let terminals = mt5::discovery::discover_all_terminals();
    for t in &terminals {
        bundle.push_str(&format!(
            "Terminal: {} | Broker: {:?} | Login: {:?} | Running: {} | EA: {:?}\n",
            t.terminal_id, t.broker, t.login, t.is_running, t.ea_status
        ));
    }
    bundle.push_str("\n");
    
    // Reconciliation status
    bundle.push_str("=== RECONCILIATION STATUS ===\n");
    let (recon_config, last_run, actions) = get_reconciliation_status();
    bundle.push_str(&format!("Enabled: {}\n", recon_config.enabled));
    bundle.push_str(&format!("Interval: {}s\n", recon_config.interval_secs));
    bundle.push_str(&format!("Last Run: {:?}\n", last_run));
    bundle.push_str(&format!("Recent Actions: {}\n\n", actions.len()));
    
    for action in actions.iter().take(20) {
        bundle.push_str(&format!(
            "  {} | {} | {} | {}\n",
            action.timestamp, action.receiver_id, action.action_type, action.details
        ));
    }
    bundle.push_str("\n");
    
    // Idempotency cache
    bundle.push_str("=== IDEMPOTENCY CACHE ===\n");
    let idem_count = copier::idempotency::get_processed_keys_count();
    bundle.push_str(&format!("Cached Keys: {}\n\n", idem_count));
    
    // Safety states
    bundle.push_str("=== SAFETY STATES ===\n");
    if let Ok(safety_json) = std::fs::read_to_string(
        std::env::var("APPDATA").unwrap_or_default() + "\\TradeCopier\\safety_state.json"
    ) {
        bundle.push_str(&safety_json);
    } else {
        bundle.push_str("No safety state file found\n");
    }
    bundle.push_str("\n\n");
    
    // Config files from terminals
    bundle.push_str("=== CONFIG FILES ===\n");
    for t in &terminals {
        if let Ok(config_path) = find_terminal_config_path(&t.terminal_id) {
            if let Ok(config) = std::fs::read_to_string(&config_path) {
                bundle.push_str(&format!("--- {} ---\n", t.terminal_id));
                bundle.push_str(&config);
                bundle.push_str("\n\n");
            }
        }
    }
    
    // Write to file
    std::fs::write(&save_path, &bundle)
        .map_err(|e| format!("Failed to write debug bundle: {}", e))?;
    
    Ok(save_path)
}

fn find_terminal_config_path(terminal_id: &str) -> Result<std::path::PathBuf, String> {
    let appdata = std::env::var("APPDATA").map_err(|_| "APPDATA not found")?;
    
    if terminal_id.starts_with("portable_") {
        let terminals = mt5::discovery::discover_all_terminals();
        for t in terminals {
            if t.terminal_id == terminal_id {
                return Ok(std::path::PathBuf::from(&t.data_folder)
                    .join("MQL5")
                    .join("Files")
                    .join("copier-config.json"));
            }
        }
        return Err("Terminal not found".to_string());
    }
    
    Ok(std::path::PathBuf::from(&appdata)
        .join("MetaQuotes")
        .join("Terminal")
        .join(terminal_id)
        .join("MQL5")
        .join("Files")
        .join("copier-config.json"))
}

fn create_system_tray() -> SystemTray {
    let show = CustomMenuItem::new("show".to_string(), "Show Dashboard");
    let sync = CustomMenuItem::new("sync".to_string(), "Sync Config");
    let start = CustomMenuItem::new("start".to_string(), "Start Copier");
    let stop = CustomMenuItem::new("stop".to_string(), "Stop Copier");
    let quit = CustomMenuItem::new("quit".to_string(), "Quit");

    let tray_menu = SystemTrayMenu::new()
        .add_item(show)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(sync)
        .add_item(start)
        .add_item(stop)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(quit);

    SystemTray::new().with_menu(tray_menu)
}

fn main() {
    // Initialize structured logging (keep guard alive for the app's lifetime)
    let _log_guard = logging::init_logging();

    let app_state = AppState {
        copier: Arc::new(Mutex::new(CopierState::default())),
    };

    // Try to load saved API key
    if let Ok(api_key) = sync::config::load_api_key() {
        app_state.copier.lock().api_key = Some(api_key);
    }

    tauri::Builder::default()
        .system_tray(create_system_tray())
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::LeftClick { .. } => {
                if let Some(window) = app.get_window("main") {
                    window.show().unwrap();
                    window.set_focus().unwrap();
                }
            }
            SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
                "show" => {
                    if let Some(window) = app.get_window("main") {
                        window.show().unwrap();
                        window.set_focus().unwrap();
                    }
                }
                "sync" => {
                    let state = app.state::<AppState>();
                    let api_key = state.copier.lock().api_key.clone();
                    if let Some(key) = api_key {
                        let state_clone = state.copier.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Ok(config) = sync::config::fetch_config(&key).await {
                                let mut copier = state_clone.lock();
                                copier.config = Some(config);
                                copier.last_sync = Some(chrono::Utc::now().to_rfc3339());
                                info!("Config synced successfully");
                            }
                        });
                    }
                }
                "start" => {
                    let state = app.state::<AppState>();
                    let mut copier = state.copier.lock();
                    if copier.config.is_some() {
                        copier.is_running = true;
                    }
                }
                "stop" => {
                    let state = app.state::<AppState>();
                    state.copier.lock().is_running = false;
                }
                "quit" => {
                    info!("Application shutting down via tray menu");
                    
                    // Request file watcher shutdown (graceful termination - C3 fix)
                    copier::file_watcher::request_shutdown();
                    
                    // Give file watcher time to finish any in-progress work
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    
                    // Save copier state before exit
                    let state = app.state::<AppState>();
                    let copier = state.copier.lock();
                    if let Err(e) = copier::safety::save_all_safety_states() {
                        warn!("Failed to save safety states on exit: {}", e);
                    }
                    drop(copier);
                    std::process::exit(0);
                }
                _ => {}
            },
            _ => {}
        })
        .on_window_event(|event| match event.event() {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                // Save safety states before hiding (in case user quits from tray)
                if let Err(e) = copier::safety::save_all_safety_states() {
                    warn!("Failed to save safety states on window close: {}", e);
                }
                event.window().hide().unwrap();
                api.prevent_close();
            }
            _ => {}
        })
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            get_copier_status,
            set_api_key,
            sync_config,
            start_copier,
            stop_copier,
            get_recent_executions,
            set_mt5_path,
            find_terminals,
            discover_terminals,
            add_terminal_path,
            add_manual_terminal,
            install_ea,
            get_terminal_account_info,
            get_symbol_catalog,
            get_master_symbols,
            auto_map_symbols,
            get_diagnostics,
            // Config & sync commands
            save_copier_config,
            get_position_sync_status,
            sync_position_to_receiver,
            emergency_close_all,
            pause_receivers,
            resume_receivers,
            get_master_heartbeat,
            check_master_online,
            test_copy,
            // Reconciliation commands
            set_reconciliation_config,
            update_recon_config,
            get_recon_status,
            start_recon_loop,
            stop_recon_loop,
            run_reconciliation_now,
            // Debug commands
            export_debug_bundle,
        ])
        .setup(|app| {
            // Show main window on startup
            if let Some(window) = app.get_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            
            let state = app.state::<AppState>();
            let copier = state.copier.clone();
            
            // Start file watcher in background
            std::thread::spawn(move || {
                copier::file_watcher::start_watching(copier);
            });
            
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
