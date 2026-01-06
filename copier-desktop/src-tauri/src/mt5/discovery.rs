//! Multi-strategy MT5 terminal discovery
//!
//! Implements install-centric terminal detection:
//! 1. Windows Registry uninstall entries (best - gets DisplayName)
//! 2. Common installation directories (Program Files)
//! 3. Running processes (for is_running status)
//! 4. Standard MetaQuotes data folders (for data folder mapping)
//! 5. Persisted manual paths
//!
//! Key principle: show install_label (registry DisplayName or folder name) pre-EA,
//! only show broker/server/login after EA handshake (CopierAccountInfo.json).

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tracing::{debug, info, warn};

// ==================== CACHING ====================
// Cache discovery results to prevent UI freezing from repeated expensive scans

lazy_static::lazy_static! {
    static ref DISCOVERY_CACHE: Mutex<DiscoveryCache> = Mutex::new(DiscoveryCache::default());
}

const CACHE_TTL_SECS: u64 = 10; // Refresh at most every 10 seconds

#[derive(Default)]
struct DiscoveryCache {
    terminals: Vec<TerminalInfo>,
    last_refresh: Option<Instant>,
}

/// How the terminal was discovered
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DiscoveryMethod {
    Process,
    Registry,
    AppData,
    CommonPath,
    Manual,
}

/// EA connection status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum EaStatus {
    #[default]
    None,
    Master,
    Receiver,
    Both,
}

/// Extended terminal information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalInfo {
    pub terminal_id: String,
    pub executable_path: Option<String>,
    pub data_folder: String,
    /// Install label (from registry DisplayName or folder name) - shown pre-EA
    #[serde(default)]
    pub install_label: Option<String>,
    /// Verified broker name (from EA handshake only)
    pub broker: Option<String>,
    pub server: Option<String>,
    pub login: Option<i64>,
    pub account_name: Option<String>,
    pub platform: String,
    pub is_running: bool,
    pub ea_status: EaStatus,
    pub last_heartbeat: Option<String>,
    pub discovery_method: DiscoveryMethod,
    pub has_mql5: bool,
    pub master_installed: bool,
    pub receiver_installed: bool,
    /// Whether EA handshake file exists (CopierAccountInfo.json)
    #[serde(default)]
    pub verified: bool,
    /// The MetaQuotes data folder hash (for AppData terminals)
    #[serde(default)]
    pub data_id: Option<String>,
    /// Cached symbol names from last catalog fetch
    #[serde(default)]
    pub cached_symbols: Option<Vec<String>>,
    /// Quick reference for symbol count
    #[serde(default)]
    pub symbol_count: Option<usize>,
}

/// Config for persisted manual terminals
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DiscoveryConfig {
    pub manual_terminals: Vec<ManualTerminal>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManualTerminal {
    pub path: String,
    pub added_at: String,
}

const CONFIG_FOLDER: &str = "TradeCopier";
const DISCOVERY_CONFIG_FILE: &str = "discovery_config.json";

/// Get the path to discovery config
fn get_config_path() -> Option<PathBuf> {
    let appdata = std::env::var("APPDATA").ok()?;
    Some(PathBuf::from(appdata).join(CONFIG_FOLDER).join(DISCOVERY_CONFIG_FILE))
}

/// Load discovery config
fn load_config() -> DiscoveryConfig {
    if let Some(path) = get_config_path() {
        if path.exists() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(config) = serde_json::from_str(&content) {
                    return config;
                }
            }
        }
    }
    DiscoveryConfig::default()
}

/// Save discovery config
fn save_config(config: &DiscoveryConfig) -> Result<(), String> {
    let path = get_config_path().ok_or("Failed to get config path")?;
    
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }
    
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    
    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to write config: {}", e))?;
    
    Ok(())
}

/// Add a manual terminal path and persist it
pub fn add_manual_terminal(path: &str) -> Result<(), String> {
    let mut config = load_config();
    
    // Check if already exists
    if config.manual_terminals.iter().any(|t| t.path == path) {
        return Ok(());
    }
    
    config.manual_terminals.push(ManualTerminal {
        path: path.to_string(),
        added_at: chrono::Utc::now().to_rfc3339(),
    });
    
    save_config(&config)
}

/// Remove a manual terminal path
pub fn remove_manual_terminal(path: &str) -> Result<(), String> {
    let mut config = load_config();
    config.manual_terminals.retain(|t| t.path != path);
    save_config(&config)
}

/// Discover all MT5 terminals using cached results (throttled)
/// Use this for UI to prevent freezing
pub fn discover_all_terminals() -> Vec<TerminalInfo> {
    discover_all_terminals_cached(false)
}

/// Discover terminals with optional force refresh
pub fn discover_all_terminals_cached(force: bool) -> Vec<TerminalInfo> {
    let mut cache = DISCOVERY_CACHE.lock().unwrap();
    
    let should_refresh = force || cache.last_refresh.map_or(true, |last| {
        last.elapsed() > Duration::from_secs(CACHE_TTL_SECS)
    });
    
    if should_refresh {
        debug!("Refreshing terminal discovery cache...");
        cache.terminals = discover_all_terminals_internal();
        cache.last_refresh = Some(Instant::now());
    } else {
        debug!("Using cached terminal discovery results");
    }
    
    cache.terminals.clone()
}

/// Force refresh the discovery cache (for manual refresh buttons)
pub fn refresh_discovery_cache() -> Vec<TerminalInfo> {
    discover_all_terminals_cached(true)
}

/// Internal discovery - does the actual work
fn discover_all_terminals_internal() -> Vec<TerminalInfo> {
    let mut results = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();
    let mut exe_to_data: HashMap<String, (String, String)> = HashMap::new(); // exe_path -> (data_folder, data_id)

    info!("Starting install-centric terminal discovery...");

    // Step 1: Build AppData index first (maps exe_path -> data_folder)
    let appdata_index = build_appdata_index();
    for (exe_path, data_folder, data_id) in &appdata_index {
        exe_to_data.insert(exe_path.to_lowercase(), (data_folder.clone(), data_id.clone()));
    }
    debug!("Built AppData index with {} entries", appdata_index.len());

    // Step 2: Get running processes for is_running status
    let running_exes = get_running_terminal_exes();
    debug!("Found {} running terminal processes", running_exes.len());

    // Step 3: Windows Registry (primary - has DisplayName)
    let registry_terminals = discover_from_registry_install_centric(&exe_to_data, &running_exes);
    for terminal in registry_terminals {
        if seen_ids.insert(terminal.terminal_id.clone()) {
            results.push(terminal);
        }
    }
    debug!("Found {} terminals from registry", results.len());

    // Step 4: Common installation paths (fallback)
    let common_terminals = discover_from_common_paths_limited(&exe_to_data, &running_exes);
    for terminal in common_terminals {
        if seen_ids.insert(terminal.terminal_id.clone()) {
            results.push(terminal);
        }
    }

    // Step 5: AppData terminals not yet found via install paths
    let appdata_terminals = discover_from_appdata_remaining(&seen_ids, &running_exes);
    for terminal in appdata_terminals {
        if seen_ids.insert(terminal.terminal_id.clone()) {
            results.push(terminal);
        }
    }
    debug!("Found {} terminals total after AppData scan", results.len());

    // Step 6: Persisted manual paths
    let manual_terminals = discover_from_manual_paths();
    for terminal in manual_terminals {
        if seen_ids.insert(terminal.terminal_id.clone()) {
            results.push(terminal);
        }
    }

    info!("Total terminals discovered: {}", results.len());
    results
}

/// Build AppData index: maps exe_path -> (data_folder, data_id)
fn build_appdata_index() -> Vec<(String, String, String)> {
    let mut index = Vec::new();
    
    if let Ok(appdata) = std::env::var("APPDATA") {
        let terminals_path = PathBuf::from(&appdata).join("MetaQuotes").join("Terminal");
        
        if let Ok(entries) = std::fs::read_dir(&terminals_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let data_id = path.file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("")
                        .to_string();
                    
                    // Check for MQL5 folder
                    if !path.join("MQL5").exists() {
                        continue;
                    }
                    
                    // Try to get exe path from origin.txt
                    if let Some(exe_path) = get_executable_from_origin(&path) {
                        index.push((exe_path, path.to_string_lossy().to_string(), data_id));
                    }
                }
            }
        }
    }
    
    index
}

/// Get running terminal64.exe paths (without spawning visible console)
fn get_running_terminal_exes() -> HashSet<String> {
    let mut exes = HashSet::new();
    
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        
        // Use WMIC with hidden window
        let output = Command::new("wmic")
            .args(["process", "where", "name='terminal64.exe'", "get", "ExecutablePath", "/format:csv"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        if let Ok(output) = output {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines().skip(1) {
                let parts: Vec<&str> = line.split(',').collect();
                if parts.len() >= 2 {
                    let exe_path = parts[1].trim();
                    if !exe_path.is_empty() {
                        exes.insert(exe_path.to_lowercase());
                    }
                }
            }
        }
    }
    
    exes
}

/// Discover terminals from Windows Registry (install-centric with DisplayName)
fn discover_from_registry_install_centric(
    exe_to_data: &HashMap<String, (String, String)>,
    running_exes: &HashSet<String>,
) -> Vec<TerminalInfo> {
    let mut terminals = Vec::new();

    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let paths = [
            (HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
            (HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
            (HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        ];

        for (hkey, path) in paths {
            if let Ok(uninstall_key) = RegKey::predef(hkey).open_subkey(path) {
                for name in uninstall_key.enum_keys().filter_map(|k| k.ok()) {
                    if let Ok(app_key) = uninstall_key.open_subkey(&name) {
                        let display_name: Result<String, _> = app_key.get_value("DisplayName");
                        if let Ok(display_name) = display_name {
                            let name_lower = display_name.to_lowercase();
                            if name_lower.contains("metatrader") || name_lower.contains("mt5") {
                                // Get install location
                                if let Ok(install_path_str) = app_key.get_value::<String, _>("InstallLocation") {
                                    let install_path = PathBuf::from(&install_path_str);
                                    let exe_path = install_path.join("terminal64.exe");
                                    
                                    if exe_path.exists() {
                                        if let Some(terminal) = terminal_from_install(
                                            &exe_path,
                                            &display_name,
                                            exe_to_data,
                                            running_exes,
                                            DiscoveryMethod::Registry,
                                        ) {
                                            terminals.push(terminal);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    terminals
}

/// Discover terminals from common install paths (limited - no drive root scans)
fn discover_from_common_paths_limited(
    exe_to_data: &HashMap<String, (String, String)>,
    running_exes: &HashSet<String>,
) -> Vec<TerminalInfo> {
    let mut terminals = Vec::new();

    // Only scan specific directories, NOT drive roots
    let base_paths = [
        "C:\\Program Files",
        "C:\\Program Files (x86)",
        "D:\\Program Files",
        "D:\\Program Files (x86)",
    ];
    
    // Also check user's local programs
    if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
        let programs_path = PathBuf::from(&local_appdata).join("Programs");
        if programs_path.exists() {
            if let Ok(entries) = std::fs::read_dir(&programs_path) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if !path.is_dir() { continue; }
                    
                    let name = path.file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("")
                        .to_lowercase();
                    
                    if name.contains("metatrader") || name.contains("mt5") {
                        let exe_path = path.join("terminal64.exe");
                        if exe_path.exists() {
                            let label = extract_install_label(&path);
                            if let Some(terminal) = terminal_from_install(
                                &exe_path,
                                &label,
                                exe_to_data,
                                running_exes,
                                DiscoveryMethod::CommonPath,
                            ) {
                                terminals.push(terminal);
                            }
                        }
                    }
                }
            }
        }
    }

    for base in &base_paths {
        let base_path = Path::new(base);
        if !base_path.exists() { continue; }

        // Only scan ONE level deep (direct children)
        if let Ok(entries) = std::fs::read_dir(base_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() { continue; }

                let name = path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_lowercase();

                if name.contains("metatrader") || name.contains("mt5") || name.contains("terminal") {
                    let exe_path = path.join("terminal64.exe");
                    if exe_path.exists() {
                        let label = extract_install_label(&path);
                        if let Some(terminal) = terminal_from_install(
                            &exe_path,
                            &label,
                            exe_to_data,
                            running_exes,
                            DiscoveryMethod::CommonPath,
                        ) {
                            terminals.push(terminal);
                        }
                    }
                }
            }
        }
    }

    // Check specific broker paths
    let specific_paths = [
        "C:\\FTMO MetaTrader 5",
        "C:\\FundedNext MT5",
        "D:\\FTMO MetaTrader 5",
        "D:\\FundedNext MT5",
    ];

    for path_str in &specific_paths {
        let path = Path::new(path_str);
        if path.exists() {
            let exe_path = path.join("terminal64.exe");
            if exe_path.exists() {
                let label = extract_install_label(path);
                if let Some(terminal) = terminal_from_install(
                    &exe_path,
                    &label,
                    exe_to_data,
                    running_exes,
                    DiscoveryMethod::CommonPath,
                ) {
                    terminals.push(terminal);
                }
            }
        }
    }

    terminals
}

/// Discover AppData terminals not already found via install paths
fn discover_from_appdata_remaining(
    seen_ids: &HashSet<String>,
    running_exes: &HashSet<String>,
) -> Vec<TerminalInfo> {
    let mut terminals = Vec::new();

    if let Ok(appdata) = std::env::var("APPDATA") {
        let terminals_path = PathBuf::from(&appdata).join("MetaQuotes").join("Terminal");
        
        if let Ok(entries) = std::fs::read_dir(&terminals_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let data_id = path.file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("")
                        .to_string();
                    
                    // Skip if already found
                    if seen_ids.contains(&data_id) {
                        continue;
                    }
                    
                    let mql5_path = path.join("MQL5");
                    if mql5_path.exists() {
                        if let Some(terminal) = terminal_from_data_folder_enhanced(&path, running_exes) {
                            terminals.push(terminal);
                        }
                    }
                }
            }
        }
    }

    terminals
}

/// Extract install label from folder path
fn extract_install_label(install_path: &Path) -> String {
    let folder_name = install_path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("MT5 Terminal");
    
    // Clean up common suffixes but keep broker name
    let cleaned = folder_name
        .replace(" Terminal", "")
        .trim()
        .to_string();
    
    if cleaned.is_empty() {
        folder_name.to_string()
    } else {
        cleaned
    }
}

/// Create TerminalInfo from install path (install-centric approach)
fn terminal_from_install(
    exe_path: &Path,
    install_label: &str,
    exe_to_data: &HashMap<String, (String, String)>,
    running_exes: &HashSet<String>,
    method: DiscoveryMethod,
) -> Option<TerminalInfo> {
    let install_dir = exe_path.parent()?;
    let exe_path_str = exe_path.to_string_lossy().to_string();
    let exe_path_lower = exe_path_str.to_lowercase();
    
    // Check if running
    let is_running = running_exes.contains(&exe_path_lower);
    
    // Try to find data folder from AppData index
    let (data_folder, data_id) = exe_to_data
        .get(&exe_path_lower)
        .cloned()
        .unwrap_or_else(|| {
            // Fallback: use install dir as data folder (portable mode)
            (install_dir.to_string_lossy().to_string(), format!("portable_{}", generate_terminal_hash(install_dir)))
        });
    
    // Use data_id as terminal_id for consistency
    let terminal_id = if data_folder.contains("MetaQuotes") {
        // Extract hash from path
        Path::new(&data_folder)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&data_id)
            .to_string()
    } else {
        data_id.clone()
    };
    
    let data_path = Path::new(&data_folder);
    let mql5_path = data_path.join("MQL5");
    let files_path = mql5_path.join("Files");
    
    // Check if MQL5 exists (might be portable or data folder)
    let has_mql5 = mql5_path.exists() || install_dir.join("MQL5").exists();
    let actual_files_path = if files_path.exists() {
        files_path
    } else {
        install_dir.join("MQL5").join("Files")
    };
    
    // Only get broker/server/login from EA handshake
    let (broker, server, login, account_name, verified) = read_ea_handshake(&actual_files_path);
    
    // Check EA installation
    let experts_path = if mql5_path.exists() {
        mql5_path.join("Experts")
    } else {
        install_dir.join("MQL5").join("Experts")
    };
    
    let master_installed = experts_path.join("TradeCopierMaster.mq5").exists()
        || experts_path.join("TradeCopierMaster.ex5").exists();
    let receiver_installed = experts_path.join("TradeCopierReceiver.mq5").exists()
        || experts_path.join("TradeCopierReceiver.ex5").exists();

    let ea_status = match (master_installed, receiver_installed) {
        (true, true) => EaStatus::Both,
        (true, false) => EaStatus::Master,
        (false, true) => EaStatus::Receiver,
        (false, false) => EaStatus::None,
    };

    let last_heartbeat = if master_installed {
        get_heartbeat_timestamp(&actual_files_path.join("CopierQueue").join("heartbeat.json"))
    } else {
        None
    };

    Some(TerminalInfo {
        terminal_id,
        executable_path: Some(exe_path_str),
        data_folder,
        install_label: Some(install_label.to_string()),
        broker,
        server,
        login,
        account_name,
        platform: "MT5".to_string(),
        is_running,
        ea_status,
        last_heartbeat,
        discovery_method: method,
        has_mql5,
        master_installed,
        receiver_installed,
        verified,
        data_id: Some(data_id),
        cached_symbols: None,
        symbol_count: None,
    })
}

/// Read EA handshake file (only source of broker/server/login)
fn read_ea_handshake(files_path: &Path) -> (Option<String>, Option<String>, Option<i64>, Option<String>, bool) {
    let info_file = files_path.join("CopierAccountInfo.json");
    if !info_file.exists() {
        return (None, None, None, None, false);
    }

    let content = match std::fs::read_to_string(&info_file) {
        Ok(c) => c,
        Err(_) => return (None, None, None, None, false),
    };
    
    let json: serde_json::Value = match serde_json::from_str(&content) {
        Ok(j) => j,
        Err(_) => return (None, None, None, None, false),
    };

    let broker = json.get("broker").and_then(|v| v.as_str()).map(String::from);
    let server = json.get("server").and_then(|v| v.as_str()).map(String::from);
    let login = json.get("account_number")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse().ok());
    
    let account_name = match (&broker, login) {
        (Some(b), Some(l)) => Some(format!("{} - {}", b, l)),
        _ => None,
    };

    (broker, server, login, account_name, true)
}

/// Create TerminalInfo from data folder (for AppData terminals not found via install)
fn terminal_from_data_folder_enhanced(
    data_path: &Path,
    running_exes: &HashSet<String>,
) -> Option<TerminalInfo> {
    let terminal_id = data_path.file_name()?.to_str()?.to_string();
    
    let mql5_path = data_path.join("MQL5");
    if !mql5_path.exists() {
        return None;
    }

    let files_path = mql5_path.join("Files");
    
    // Try to find executable via origin.txt
    let executable_path = get_executable_from_origin(data_path);
    let is_running = executable_path.as_ref()
        .map(|p| running_exes.contains(&p.to_lowercase()))
        .unwrap_or(false);
    
    // Get install label from exe path if available
    let install_label = executable_path.as_ref()
        .and_then(|p| Path::new(p).parent())
        .map(|dir| extract_install_label(dir));

    // Only get broker/server/login from EA handshake
    let (broker, server, login, account_name, verified) = read_ea_handshake(&files_path);

    // Check EA installation
    let experts_path = mql5_path.join("Experts");
    let master_installed = experts_path.join("TradeCopierMaster.mq5").exists()
        || experts_path.join("TradeCopierMaster.ex5").exists();
    let receiver_installed = experts_path.join("TradeCopierReceiver.mq5").exists()
        || experts_path.join("TradeCopierReceiver.ex5").exists();

    let ea_status = match (master_installed, receiver_installed) {
        (true, true) => EaStatus::Both,
        (true, false) => EaStatus::Master,
        (false, true) => EaStatus::Receiver,
        (false, false) => EaStatus::None,
    };

    let last_heartbeat = if master_installed {
        get_heartbeat_timestamp(&files_path.join("CopierQueue").join("heartbeat.json"))
    } else {
        None
    };

    Some(TerminalInfo {
        terminal_id: terminal_id.clone(),
        executable_path,
        data_folder: data_path.to_string_lossy().to_string(),
        install_label,
        broker,
        server,
        login,
        account_name,
        platform: "MT5".to_string(),
        is_running,
        ea_status,
        last_heartbeat,
        discovery_method: DiscoveryMethod::AppData,
        has_mql5: files_path.exists(),
        master_installed,
        receiver_installed,
        verified,
        data_id: Some(terminal_id),
        cached_symbols: None,
        symbol_count: None,
    })
}

/// Discover terminals from persisted manual paths
fn discover_from_manual_paths() -> Vec<TerminalInfo> {
    let mut terminals = Vec::new();
    let config = load_config();
    let running_exes = get_running_terminal_exes();
    let exe_to_data = HashMap::new(); // Manual paths don't need AppData mapping

    for manual in config.manual_terminals {
        let path = Path::new(&manual.path);
        if path.exists() {
            let exe_path = path.join("terminal64.exe");
            if exe_path.exists() {
                let label = extract_install_label(path);
                if let Some(terminal) = terminal_from_install(
                    &exe_path,
                    &label,
                    &exe_to_data,
                    &running_exes,
                    DiscoveryMethod::Manual,
                ) {
                    terminals.push(terminal);
                }
            } else {
                // Maybe it's a data folder path
                if let Some(terminal) = terminal_from_data_folder_enhanced(path, &running_exes) {
                    terminals.push(terminal);
                }
            }
        }
    }

    terminals
}

/// Generate a stable terminal ID hash from the data folder path
fn generate_terminal_hash(data_path: &Path) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    
    let path_str = data_path.to_string_lossy().to_lowercase();
    let mut hasher = DefaultHasher::new();
    path_str.hash(&mut hasher);
    let hash = hasher.finish();
    
    // Return first 16 hex characters for readability
    format!("{:016x}", hash)
}

/// Create TerminalInfo from executable path (legacy - for compatibility)
#[allow(dead_code)]
fn terminal_from_executable(exe_path: &str, method: DiscoveryMethod, is_running: bool) -> Option<TerminalInfo> {
    let exe = Path::new(exe_path);
    let install_dir = exe.parent()?;
    
    // For portable installations, MQL5 is next to terminal64.exe
    let mql5_path = install_dir.join("MQL5");
    if !mql5_path.exists() {
        return None;
    }

    let files_path = mql5_path.join("Files");
    let terminal_id = format!("portable_{}", generate_terminal_hash(install_dir));
    let install_label = extract_install_label(install_dir);

    // Only get broker/server/login from EA handshake
    let (broker, server, login, account_name, verified) = read_ea_handshake(&files_path);

    // Check EA installation
    let experts_path = mql5_path.join("Experts");
    let master_installed = experts_path.join("TradeCopierMaster.mq5").exists()
        || experts_path.join("TradeCopierMaster.ex5").exists();
    let receiver_installed = experts_path.join("TradeCopierReceiver.mq5").exists()
        || experts_path.join("TradeCopierReceiver.ex5").exists();

    let ea_status = match (master_installed, receiver_installed) {
        (true, true) => EaStatus::Both,
        (true, false) => EaStatus::Master,
        (false, true) => EaStatus::Receiver,
        (false, false) => EaStatus::None,
    };

    let last_heartbeat = if master_installed {
        get_heartbeat_timestamp(&files_path.join("CopierQueue").join("heartbeat.json"))
    } else {
        None
    };

    Some(TerminalInfo {
        terminal_id: terminal_id.clone(),
        executable_path: Some(exe_path.to_string()),
        data_folder: install_dir.to_string_lossy().to_string(),
        install_label: Some(install_label),
        broker,
        server,
        login,
        account_name,
        platform: "MT5".to_string(),
        is_running,
        ea_status,
        last_heartbeat,
        discovery_method: method,
        has_mql5: files_path.exists(),
        master_installed,
        receiver_installed,
        verified,
        data_id: Some(terminal_id),
        cached_symbols: None,
        symbol_count: None,
    })
}

/// Create TerminalInfo from data folder path (legacy - for compatibility)
#[allow(dead_code)]
fn terminal_from_data_folder(data_path: &Path, _method: DiscoveryMethod) -> Option<TerminalInfo> {
    let running_exes = get_running_terminal_exes();
    terminal_from_data_folder_enhanced(data_path, &running_exes)
}

/// Get terminal identity - legacy function, kept for backwards compatibility
#[allow(dead_code)]
fn get_terminal_identity(files_path: &Path, install_dir: &Path) -> (Option<String>, Option<String>, Option<i64>, Option<String>) {
    // Priority 1: CopierAccountInfo.json (from EA - most accurate)
    if let Some((broker, server, login)) = read_account_info_json(files_path) {
        let account_name = format!("{} - {}", broker, login);
        return (Some(broker), Some(server), Some(login), Some(account_name));
    }

    // Priority 2: accounts.ini (login/server from MT5 config)
    let config_path = if files_path.parent().and_then(|p| p.parent()).is_some() {
        files_path.parent().unwrap().parent().unwrap().join("config")
    } else {
        install_dir.join("config")
    };
    
    if let Some((server, login)) = read_accounts_ini(&config_path) {
        // Try to get broker from terminal.ini or folder name
        let broker = read_broker_from_ini(&install_dir.join("terminal.ini"))
            .or_else(|| extract_broker_from_folder(install_dir));
        
        let account_name = broker.as_ref()
            .map(|b| format!("{} - {}", b, login))
            .unwrap_or_else(|| format!("Account {}", login));
        
        return (broker, Some(server), Some(login), Some(account_name));
    }

    // Priority 3: terminal.ini Company= field
    let terminal_ini = install_dir.join("terminal.ini");
    if let Some(broker) = read_broker_from_ini(&terminal_ini) {
        return (Some(broker), None, None, None);
    }
    
    // Priority 4: .srv files in config folder
    if let Some(broker) = read_broker_from_srv(&config_path) {
        return (Some(broker), None, None, None);
    }

    // Priority 5: Folder name extraction
    if let Some(broker) = extract_broker_from_folder(install_dir) {
        return (Some(broker), None, None, None);
    }

    (None, None, None, None)
}

/// Read CopierAccountInfo.json for account details
fn read_account_info_json(files_path: &Path) -> Option<(String, String, i64)> {
    let info_file = files_path.join("CopierAccountInfo.json");
    if !info_file.exists() {
        return None;
    }

    let content = std::fs::read_to_string(&info_file).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;

    let broker = json.get("broker")?.as_str()?.to_string();
    let server = json.get("server")?.as_str()?.to_string();
    let login = json.get("account_number")?.as_str()?.parse().ok()?;

    Some((broker, server, login))
}

/// Read broker from terminal.ini
fn read_broker_from_ini(ini_path: &Path) -> Option<String> {
    if !ini_path.exists() {
        return None;
    }

    let content = std::fs::read_to_string(ini_path).ok()?;
    for line in content.lines() {
        if line.starts_with("Company=") {
            let broker = line.trim_start_matches("Company=").trim();
            if !broker.is_empty() {
                return Some(broker.to_string());
            }
        }
    }
    None
}

/// Read accounts.ini for login and server (fallback when EA not connected)
fn read_accounts_ini(config_path: &Path) -> Option<(String, i64)> {
    let accounts_ini = config_path.join("accounts.ini");
    if !accounts_ini.exists() {
        return None;
    }

    let content = std::fs::read_to_string(&accounts_ini).ok()?;
    let mut server = None;
    let mut login = None;

    for line in content.lines() {
        let line = line.trim();
        if line.starts_with("Server=") {
            server = Some(line.trim_start_matches("Server=").to_string());
        }
        if line.starts_with("Login=") {
            login = line.trim_start_matches("Login=").parse().ok();
        }
    }

    match (server, login) {
        (Some(s), Some(l)) => Some((s, l)),
        _ => None,
    }
}

/// Read broker from .srv files
fn read_broker_from_srv(config_path: &Path) -> Option<String> {
    if !config_path.exists() {
        return None;
    }

    if let Ok(entries) = std::fs::read_dir(config_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "srv").unwrap_or(false) {
                if let Some(stem) = path.file_stem() {
                    let name = stem.to_string_lossy();
                    // Format: "BrokerName-ServerName.srv"
                    if let Some(broker_part) = name.split('-').next() {
                        if !broker_part.is_empty() {
                            return Some(expand_broker_abbreviation(broker_part));
                        }
                    }
                }
            }
        }
    }
    None
}

/// Extract broker name from folder name
fn extract_broker_from_folder(path: &Path) -> Option<String> {
    let folder_name = path.file_name()?.to_str()?;
    
    let cleaned = folder_name
        .replace(" MetaTrader 5", "")
        .replace(" MetaTrader5", "")
        .replace(" MT5", "")
        .replace("MT5", "")
        .replace(" Terminal", "")
        .replace("MetaTrader 5", "")
        .replace("MetaTrader5", "")
        .trim()
        .to_string();

    if cleaned.is_empty() || cleaned == "Program Files" || cleaned == "Program Files (x86)" {
        return None;
    }

    Some(expand_broker_abbreviation(&cleaned))
}

/// Expand common broker abbreviations to full names
pub fn expand_broker_abbreviation(abbr: &str) -> String {
    match abbr.to_uppercase().as_str() {
        "FTMO" | "FTMOGLOBAL" | "FTMO-GLOBAL" => "FTMO".to_string(),
        "FN" | "FUNDEDNEXT" | "FUNDED-NEXT" => "FundedNext".to_string(),
        "TFT" | "THEFUNDEDTRADER" | "THE-FUNDED-TRADER" => "The Funded Trader".to_string(),
        "MFF" | "MYFOREXFUNDS" => "My Forex Funds".to_string(),
        "E8" | "E8FUNDING" | "E8-FUNDING" => "E8 Funding".to_string(),
        "5ER" | "5ERS" | "FIVER" | "THE5ERS" => "The5ers".to_string(),
        "ICM" | "ICMARKETS" | "IC-MARKETS" => "IC Markets".to_string(),
        "VANTAGEINT" | "VANTAGEINTERNATIONAL" | "VANTAGE" => "Vantage International".to_string(),
        "PEPPERSTONE" | "PEPPER" | "PEPPERSTONEGROUP" => "Pepperstone".to_string(),
        "XM" | "XMGROUP" | "XM-GROUP" => "XM Group".to_string(),
        "OANDA" | "OANDACORPORATION" => "OANDA".to_string(),
        "FXCM" | "FXCMGROUP" => "FXCM".to_string(),
        "IG" | "IGGROUP" | "IG-GROUP" => "IG Markets".to_string(),
        "EXNESS" | "EXNESSGROUP" => "Exness".to_string(),
        "ADMIRALS" | "ADMIRALMARKETS" | "ADMIRAL" => "Admirals".to_string(),
        "ROBOFOREX" | "ROBOMARKETS" | "ROBO" => "RoboForex".to_string(),
        "FBS" | "FBSMARKETS" => "FBS".to_string(),
        "XTB" | "XTBGROUP" => "XTB".to_string(),
        "TICKMILL" | "TICKMILLGROUP" => "Tickmill".to_string(),
        "FXPRO" | "FX-PRO" => "FxPro".to_string(),
        "AVATRADE" | "AVA-TRADE" => "AvaTrade".to_string(),
        "ALPARI" | "ALPARIGROUP" => "Alpari".to_string(),
        "HYCM" | "HY-CM" => "HYCM".to_string(),
        "AXITRADER" | "AXI" => "Axi".to_string(),
        "CMC" | "CMCMARKETS" => "CMC Markets".to_string(),
        "FOREX.COM" | "FOREXCOM" => "Forex.com".to_string(),
        "THINKORSWIM" | "TOS" => "thinkorswim".to_string(),
        _ => abbr.to_string(),
    }
}

/// Get executable path from origin.txt
fn get_executable_from_origin(data_path: &Path) -> Option<String> {
    let origin_file = data_path.join("origin.txt");
    if !origin_file.exists() {
        return None;
    }

    let install_path_str = std::fs::read_to_string(&origin_file).ok()?;
    let install_path = Path::new(install_path_str.trim());
    let exe_path = install_path.join("terminal64.exe");
    
    if exe_path.exists() {
        Some(exe_path.to_string_lossy().to_string())
    } else {
        None
    }
}

/// Get heartbeat timestamp from file
fn get_heartbeat_timestamp(heartbeat_path: &Path) -> Option<String> {
    if !heartbeat_path.exists() {
        return None;
    }

    let content = std::fs::read_to_string(heartbeat_path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;
    json.get("timestamp_utc")?.as_str().map(|s| s.to_string())
}

/// Check if terminal is currently running
pub fn is_terminal_running(terminal_id: &str) -> bool {
    // Quick check by re-running process discovery
    let process_terminals = discover_from_processes();
    process_terminals.iter().any(|t| t.terminal_id == terminal_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_broker_expansion() {
        assert_eq!(expand_broker_abbreviation("FTMO"), "FTMO");
        assert_eq!(expand_broker_abbreviation("ICM"), "IC Markets");
        assert_eq!(expand_broker_abbreviation("VantageInt"), "Vantage International");
        assert_eq!(expand_broker_abbreviation("Unknown"), "Unknown");
    }
}
