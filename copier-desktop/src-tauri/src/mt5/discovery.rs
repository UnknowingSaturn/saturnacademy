//! Multi-strategy MT5 terminal discovery
//!
//! Implements rock-solid terminal detection using multiple strategies:
//! 1. Running processes (terminal64.exe PIDs)
//! 2. Windows Registry (Uninstall keys)
//! 3. Standard MetaQuotes data folders (%APPDATA%\MetaQuotes\Terminal)
//! 4. Common installation paths
//! 5. Persisted manual paths

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use tracing::{debug, info, warn};

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

/// Discover all MT5 terminals using multiple strategies
pub fn discover_all_terminals() -> Vec<TerminalInfo> {
    let mut results = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();
    let mut data_folder_to_exe: HashMap<String, String> = HashMap::new();

    info!("Starting multi-strategy terminal discovery...");

    // Strategy 1: Running processes (highest priority - most accurate)
    let process_terminals = discover_from_processes();
    for terminal in process_terminals {
        if seen_ids.insert(terminal.terminal_id.clone()) {
            if let Some(ref exe) = terminal.executable_path {
                data_folder_to_exe.insert(terminal.data_folder.clone(), exe.clone());
            }
            results.push(terminal);
        }
    }
    debug!("Found {} terminals from processes", results.len());

    // Strategy 2: Windows Registry
    let registry_terminals = discover_from_registry();
    for mut terminal in registry_terminals {
        if seen_ids.insert(terminal.terminal_id.clone()) {
            // Try to get exe path from running processes
            if let Some(exe) = data_folder_to_exe.get(&terminal.data_folder) {
                terminal.executable_path = Some(exe.clone());
            }
            results.push(terminal);
        }
    }

    // Strategy 3: Standard MetaQuotes data folders
    let appdata_terminals = discover_from_appdata();
    for mut terminal in appdata_terminals {
        if seen_ids.insert(terminal.terminal_id.clone()) {
            if let Some(exe) = data_folder_to_exe.get(&terminal.data_folder) {
                terminal.executable_path = Some(exe.clone());
            }
            results.push(terminal);
        }
    }
    debug!("Found {} terminals total after AppData scan", results.len());

    // Strategy 4: Common installation paths
    let common_terminals = discover_from_common_paths();
    for terminal in common_terminals {
        if seen_ids.insert(terminal.terminal_id.clone()) {
            results.push(terminal);
        }
    }

    // Strategy 5: Persisted manual paths
    let manual_terminals = discover_from_manual_paths();
    for terminal in manual_terminals {
        if seen_ids.insert(terminal.terminal_id.clone()) {
            results.push(terminal);
        }
    }

    info!("Total terminals discovered: {}", results.len());
    results
}

/// Discover terminals from running processes
fn discover_from_processes() -> Vec<TerminalInfo> {
    let mut terminals = Vec::new();

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        
        // Use WMIC to find running terminal64.exe processes with their paths
        let output = Command::new("wmic")
            .args(["process", "where", "name='terminal64.exe'", "get", "ExecutablePath", "/format:csv"])
            .output();

        if let Ok(output) = output {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines().skip(1) {
                // CSV format: Node,ExecutablePath
                let parts: Vec<&str> = line.split(',').collect();
                if parts.len() >= 2 {
                    let exe_path = parts[1].trim();
                    if !exe_path.is_empty() {
                        if let Some(terminal) = terminal_from_executable(exe_path, DiscoveryMethod::Process, true) {
                            terminals.push(terminal);
                        }
                    }
                }
            }
        }
        
        // Also try tasklist as fallback
        if terminals.is_empty() {
            let output = Command::new("tasklist")
                .args(["/FI", "IMAGENAME eq terminal64.exe", "/FO", "CSV", "/V"])
                .output();
            
            if let Ok(output) = output {
                let stdout = String::from_utf8_lossy(&output.stdout);
                // If terminal64.exe is running, we at least know MT5 is active
                if stdout.contains("terminal64.exe") {
                    debug!("MT5 process detected but path unavailable from tasklist");
                }
            }
        }
    }

    terminals
}

/// Discover terminals from Windows Registry
fn discover_from_registry() -> Vec<TerminalInfo> {
    let mut terminals = Vec::new();

    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        // Check both HKLM and HKCU Uninstall keys
        let paths = [
            (HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
            (HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
            (HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        ];

        for (hkey, path) in paths {
            if let Ok(uninstall_key) = RegKey::predef(hkey).open_subkey(path) {
                for name in uninstall_key.enum_keys().filter_map(|k| k.ok()) {
                    if let Ok(app_key) = uninstall_key.open_subkey(&name) {
                        // Check DisplayName for MetaTrader
                        let display_name: Result<String, _> = app_key.get_value("DisplayName");
                        if let Ok(display_name) = display_name {
                            let name_lower = display_name.to_lowercase();
                            if name_lower.contains("metatrader") || name_lower.contains("mt5") {
                                // Get install location
                                if let Ok(install_path) = app_key.get_value::<String, _>("InstallLocation") {
                                    let exe_path = PathBuf::from(&install_path).join("terminal64.exe");
                                    if exe_path.exists() {
                                        if let Some(terminal) = terminal_from_executable(
                                            exe_path.to_string_lossy().as_ref(),
                                            DiscoveryMethod::Registry,
                                            false,
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

/// Discover terminals from standard AppData location
fn discover_from_appdata() -> Vec<TerminalInfo> {
    let mut terminals = Vec::new();

    if let Ok(appdata) = std::env::var("APPDATA") {
        let terminals_path = PathBuf::from(&appdata).join("MetaQuotes").join("Terminal");
        
        if let Ok(entries) = std::fs::read_dir(&terminals_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    // This is a hash folder, check for MQL5
                    let mql5_path = path.join("MQL5");
                    if mql5_path.exists() {
                        if let Some(terminal) = terminal_from_data_folder(&path, DiscoveryMethod::AppData) {
                            terminals.push(terminal);
                        }
                    }
                }
            }
        }
    }

    terminals
}

/// Discover terminals from common installation paths
fn discover_from_common_paths() -> Vec<TerminalInfo> {
    let mut terminals = Vec::new();

    // Expanded list of common paths
    let base_paths = [
        "C:\\Program Files",
        "C:\\Program Files (x86)",
        "D:\\Program Files",
        "D:\\Program Files (x86)",
        "E:\\Program Files",
        "C:\\",
        "D:\\",
        "E:\\",
    ];

    let patterns = [
        "MetaTrader 5",
        "MetaTrader5",
        "MT5",
    ];

    for base in &base_paths {
        let base_path = Path::new(base);
        if !base_path.exists() {
            continue;
        }

        if let Ok(entries) = std::fs::read_dir(base_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }

                let name = path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_lowercase();

                // Check if folder name matches MT5 patterns
                let is_mt5 = patterns.iter().any(|p| name.contains(&p.to_lowercase()))
                    || name.contains("metatrader")
                    || name.contains("mt5");

                if is_mt5 {
                    let exe_path = path.join("terminal64.exe");
                    if exe_path.exists() {
                        if let Some(terminal) = terminal_from_executable(
                            exe_path.to_string_lossy().as_ref(),
                            DiscoveryMethod::CommonPath,
                            false,
                        ) {
                            terminals.push(terminal);
                        }
                    }
                }
            }
        }
    }

    // Also check specific broker paths
    let specific_paths = [
        "C:\\FTMO MetaTrader 5",
        "C:\\FundedNext MT5",
        "C:\\ICMarkets MT5",
        "C:\\Pepperstone MT5",
        "D:\\FTMO MetaTrader 5",
        "D:\\FundedNext MT5",
    ];

    for path_str in &specific_paths {
        let path = Path::new(path_str);
        if path.exists() {
            let exe_path = path.join("terminal64.exe");
            if exe_path.exists() {
                if let Some(terminal) = terminal_from_executable(
                    exe_path.to_string_lossy().as_ref(),
                    DiscoveryMethod::CommonPath,
                    false,
                ) {
                    terminals.push(terminal);
                }
            }
        }
    }

    terminals
}

/// Discover terminals from persisted manual paths
fn discover_from_manual_paths() -> Vec<TerminalInfo> {
    let mut terminals = Vec::new();
    let config = load_config();

    for manual in config.manual_terminals {
        let path = Path::new(&manual.path);
        if path.exists() {
            let exe_path = path.join("terminal64.exe");
            if exe_path.exists() {
                if let Some(terminal) = terminal_from_executable(
                    exe_path.to_string_lossy().as_ref(),
                    DiscoveryMethod::Manual,
                    false,
                ) {
                    terminals.push(terminal);
                }
            } else {
                // Maybe it's a data folder path
                if let Some(terminal) = terminal_from_data_folder(path, DiscoveryMethod::Manual) {
                    terminals.push(terminal);
                }
            }
        }
    }

    terminals
}

/// Create TerminalInfo from executable path (portable installation)
fn terminal_from_executable(exe_path: &str, method: DiscoveryMethod, is_running: bool) -> Option<TerminalInfo> {
    let exe = Path::new(exe_path);
    let install_dir = exe.parent()?;
    
    // For portable installations, MQL5 is next to terminal64.exe
    let mql5_path = install_dir.join("MQL5");
    if !mql5_path.exists() {
        return None;
    }

    let files_path = mql5_path.join("Files");
    let terminal_id = format!("portable_{}", 
        install_dir.file_name()?.to_str()?.replace(' ', "_").replace("\\", "_"));

    // Get broker info
    let (broker, server, login, account_name) = get_terminal_identity(&files_path, install_dir);

    // Check EA installation
    let experts_path = mql5_path.join("Experts");
    let master_installed = experts_path.join("TradeCopierMaster.mq5").exists()
        || experts_path.join("TradeCopierMaster.ex5").exists();
    let receiver_installed = experts_path.join("TradeCopierReceiver.mq5").exists()
        || experts_path.join("TradeCopierReceiver.ex5").exists();

    // Determine EA status
    let ea_status = match (master_installed, receiver_installed) {
        (true, true) => EaStatus::Both,
        (true, false) => EaStatus::Master,
        (false, true) => EaStatus::Receiver,
        (false, false) => EaStatus::None,
    };

    // Get heartbeat if master installed
    let last_heartbeat = if master_installed {
        get_heartbeat_timestamp(&files_path.join("CopierQueue").join("heartbeat.json"))
    } else {
        None
    };

    Some(TerminalInfo {
        terminal_id,
        executable_path: Some(exe_path.to_string()),
        data_folder: install_dir.to_string_lossy().to_string(),
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
    })
}

/// Create TerminalInfo from data folder path (AppData installation)
fn terminal_from_data_folder(data_path: &Path, method: DiscoveryMethod) -> Option<TerminalInfo> {
    let terminal_id = data_path.file_name()?.to_str()?.to_string();
    
    let mql5_path = data_path.join("MQL5");
    if !mql5_path.exists() {
        return None;
    }

    let files_path = mql5_path.join("Files");
    
    // Try to find executable via origin.txt
    let executable_path = get_executable_from_origin(data_path);
    let install_dir = executable_path.as_ref()
        .and_then(|p| Path::new(p).parent())
        .map(|p| p.to_path_buf());

    // Get broker info
    let (broker, server, login, account_name) = get_terminal_identity(
        &files_path,
        install_dir.as_deref().unwrap_or(data_path),
    );

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
        terminal_id,
        executable_path,
        data_folder: data_path.to_string_lossy().to_string(),
        broker,
        server,
        login,
        account_name,
        platform: "MT5".to_string(),
        is_running: false, // Will be updated by process check
        ea_status,
        last_heartbeat,
        discovery_method: method,
        has_mql5: files_path.exists(),
        master_installed,
        receiver_installed,
    })
}

/// Get terminal identity (broker, server, login) using multiple sources
fn get_terminal_identity(files_path: &Path, install_dir: &Path) -> (Option<String>, Option<String>, Option<i64>, Option<String>) {
    // Priority 1: CopierAccountInfo.json (from EA - most accurate)
    if let Some((broker, server, login)) = read_account_info_json(files_path) {
        let account_name = format!("{} - {}", broker, login);
        return (Some(broker), Some(server), Some(login), Some(account_name));
    }

    // Priority 2: terminal.ini Company= field
    let terminal_ini = install_dir.join("terminal.ini");
    if let Some(broker) = read_broker_from_ini(&terminal_ini) {
        return (Some(broker), None, None, None);
    }

    // Priority 3: .srv files in config folder
    let config_path = if files_path.parent().and_then(|p| p.parent()).is_some() {
        files_path.parent().unwrap().parent().unwrap().join("config")
    } else {
        install_dir.join("config")
    };
    
    if let Some(broker) = read_broker_from_srv(&config_path) {
        return (Some(broker), None, None, None);
    }

    // Priority 4: Folder name extraction
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
