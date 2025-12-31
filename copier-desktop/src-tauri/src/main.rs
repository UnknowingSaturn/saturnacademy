#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod copier;
mod mt5;
mod sync;

use copier::CopierState;
use parking_lot::Mutex;
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
    env_logger::init();

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
                    std::process::exit(0);
                }
                _ => {}
            },
            _ => {}
        })
        .on_window_event(|event| match event.event() {
            tauri::WindowEvent::CloseRequested { api, .. } => {
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
            install_ea,
            get_terminal_account_info,
        ])
        .setup(|app| {
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
