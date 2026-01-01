use std::path::{Path, PathBuf};
use std::collections::HashSet;

/// Find all MT5 terminal installations on the system
pub fn find_mt5_terminals() -> Vec<Mt5Terminal> {
    let mut terminals = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    // Method 1: Check standard MetaQuotes Terminal folder (AppData)
    if let Ok(appdata) = std::env::var("APPDATA") {
        let terminals_path = format!("{}\\MetaQuotes\\Terminal", appdata);
        
        if let Ok(entries) = std::fs::read_dir(&terminals_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    if let Some(terminal) = detect_terminal(&path) {
                        if seen_ids.insert(terminal.terminal_id.clone()) {
                            terminals.push(terminal);
                        }
                    }
                }
            }
        }
    }

    // Method 2: Check Program Files for portable installations
    for program_files in &["C:\\Program Files", "C:\\Program Files (x86)", "D:\\Program Files"] {
        if let Ok(entries) = std::fs::read_dir(program_files) {
            for entry in entries.flatten() {
                let path = entry.path();
                let name = path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("");
                
                // Check for MT5 installations
                if name.to_lowercase().contains("metatrader") 
                    || name.to_lowercase().contains("mt5") 
                    || name.to_lowercase().contains("terminal") {
                    if let Some(terminal) = detect_portable_terminal(&path) {
                        if seen_ids.insert(terminal.terminal_id.clone()) {
                            terminals.push(terminal);
                        }
                    }
                }
            }
        }
    }

    // Method 3: Check common broker installation paths
    let common_paths = [
        "C:\\MetaTrader 5",
        "C:\\MT5",
        "D:\\MetaTrader 5",
        "D:\\MT5",
    ];

    for path_str in &common_paths {
        let path = Path::new(path_str);
        if path.exists() {
            if let Some(terminal) = detect_portable_terminal(path) {
                if seen_ids.insert(terminal.terminal_id.clone()) {
                    terminals.push(terminal);
                }
            }
        }
    }

    terminals
}

fn detect_terminal(path: &Path) -> Option<Mt5Terminal> {
    let terminal_id = path.file_name()?.to_str()?.to_string();
    
    // Key check: MQL5 folder must exist - this is the data folder
    let mql5_path = path.join("MQL5");
    if !mql5_path.exists() {
        return None;
    }

    // Check if Files folder exists
    let files_path = mql5_path.join("Files");
    let has_mql5 = files_path.exists();

    // Try to read broker info from origin.txt
    let origin_file = path.join("origin.txt");
    let mut broker = if origin_file.exists() {
        std::fs::read_to_string(&origin_file)
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    } else {
        None
    };

    // Fallback: try to read broker from terminal.ini
    if broker.is_none() {
        let terminal_ini = path.join("terminal.ini");
        if terminal_ini.exists() {
            if let Ok(content) = std::fs::read_to_string(&terminal_ini) {
                for line in content.lines() {
                    if line.starts_with("Company=") {
                        broker = Some(line.trim_start_matches("Company=").trim().to_string());
                        break;
                    }
                }
            }
        }
    }

    // Check which EAs are installed
    let experts_path = mql5_path.join("Experts");
    let master_installed = experts_path.join("TradeCopierMaster.mq5").exists() 
        || experts_path.join("TradeCopierMaster.ex5").exists();
    let receiver_installed = experts_path.join("TradeCopierReceiver.mq5").exists()
        || experts_path.join("TradeCopierReceiver.ex5").exists();

    // Try to get account info if available
    let account_info = get_account_info_internal(&files_path);

    Some(Mt5Terminal {
        terminal_id,
        path: path.to_string_lossy().to_string(),
        broker,
        has_mql5,
        master_installed,
        receiver_installed,
        account_info,
    })
}

fn detect_portable_terminal(path: &Path) -> Option<Mt5Terminal> {
    // For portable installations, the MQL5 folder is in the same directory as terminal64.exe
    let mql5_path = path.join("MQL5");
    if !mql5_path.exists() {
        return None;
    }

    // Check for terminal executable to confirm it's an MT5 installation
    let has_terminal = path.join("terminal64.exe").exists() || path.join("terminal.exe").exists();
    if !has_terminal {
        return None;
    }

    // Generate a unique ID from the path
    let terminal_id = format!("portable_{}", path.file_name()?.to_str()?.replace(' ', "_"));
    
    let files_path = mql5_path.join("Files");
    let has_mql5 = files_path.exists();

    // Try to get broker from origin.txt or config
    let origin_file = path.join("origin.txt");
    let broker = if origin_file.exists() {
        std::fs::read_to_string(&origin_file)
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    } else {
        Some(path.file_name()?.to_str()?.to_string())
    };

    // Check which EAs are installed
    let experts_path = mql5_path.join("Experts");
    let master_installed = experts_path.join("TradeCopierMaster.mq5").exists() 
        || experts_path.join("TradeCopierMaster.ex5").exists();
    let receiver_installed = experts_path.join("TradeCopierReceiver.mq5").exists()
        || experts_path.join("TradeCopierReceiver.ex5").exists();

    let account_info = get_account_info_internal(&files_path);

    Some(Mt5Terminal {
        terminal_id,
        path: path.to_string_lossy().to_string(),
        broker,
        has_mql5,
        master_installed,
        receiver_installed,
        account_info,
    })
}

fn get_account_info_internal(files_path: &Path) -> Option<AccountInfo> {
    let info_file = files_path.join("CopierAccountInfo.json");
    if !info_file.exists() {
        return None;
    }
    let content = std::fs::read_to_string(&info_file).ok()?;
    serde_json::from_str(&content).ok()
}

/// Install EA file to a terminal's MQL5/Experts folder
pub fn install_ea_to_terminal(
    terminal_id: &str,
    ea_type: &str,
    ea_content: &[u8],
) -> Result<String, String> {
    // First try to find the terminal
    let terminal_path = find_terminal_path(terminal_id)?;
    
    // Ensure MQL5/Experts folder exists
    let experts_path = terminal_path.join("MQL5").join("Experts");
    std::fs::create_dir_all(&experts_path)
        .map_err(|e| format!("Failed to create Experts folder: {}", e))?;

    // Determine EA filename
    let ea_filename = match ea_type {
        "master" => "TradeCopierMaster.mq5",
        "receiver" => "TradeCopierReceiver.mq5",
        _ => return Err(format!("Invalid EA type: {}", ea_type)),
    };

    // Write EA file
    let ea_path = experts_path.join(ea_filename);
    std::fs::write(&ea_path, ea_content)
        .map_err(|e| format!("Failed to write EA file: {}", e))?;

    // Create necessary folders for copier operation
    let files_path = terminal_path.join("MQL5").join("Files");
    std::fs::create_dir_all(files_path.join("CopierQueue"))
        .map_err(|e| format!("Failed to create CopierQueue folder: {}", e))?;
    std::fs::create_dir_all(files_path.join("CopierCommands"))
        .map_err(|e| format!("Failed to create CopierCommands folder: {}", e))?;
    std::fs::create_dir_all(files_path.join("CopierEvents"))
        .map_err(|e| format!("Failed to create CopierEvents folder: {}", e))?;

    Ok(ea_path.to_string_lossy().to_string())
}

fn find_terminal_path(terminal_id: &str) -> Result<PathBuf, String> {
    // Check if it's a portable terminal
    if terminal_id.starts_with("portable_") {
        // Search for it in known locations
        let terminals = find_mt5_terminals();
        for terminal in terminals {
            if terminal.terminal_id == terminal_id {
                return Ok(PathBuf::from(terminal.path));
            }
        }
        return Err(format!("Portable terminal {} not found", terminal_id));
    }

    // Standard AppData terminal
    let appdata = std::env::var("APPDATA")
        .map_err(|_| "Could not find APPDATA directory".to_string())?;
    
    let terminal_path = PathBuf::from(format!(
        "{}\\MetaQuotes\\Terminal\\{}",
        appdata, terminal_id
    ));
    
    if terminal_path.exists() {
        Ok(terminal_path)
    } else {
        Err(format!("Terminal {} not found", terminal_id))
    }
}

/// Get account info from MT5 terminal via file
pub fn get_account_info(terminal_id: &str) -> Option<AccountInfo> {
    let terminal_path = find_terminal_path(terminal_id).ok()?;
    let info_file = terminal_path.join("MQL5").join("Files").join("CopierAccountInfo.json");

    if !info_file.exists() {
        return None;
    }

    let content = std::fs::read_to_string(&info_file).ok()?;
    serde_json::from_str(&content).ok()
}

/// Get master heartbeat from file
pub fn get_master_heartbeat(terminal_id: &str) -> Option<MasterHeartbeat> {
    let terminal_path = find_terminal_path(terminal_id).ok()?;
    let heartbeat_file = terminal_path.join("MQL5").join("Files").join("CopierHeartbeat.json");

    if !heartbeat_file.exists() {
        return None;
    }

    let content = std::fs::read_to_string(&heartbeat_file).ok()?;
    serde_json::from_str(&content).ok()
}

/// Ensure the CopierQueue and CopierCommands folders exist
#[allow(dead_code)]
pub fn ensure_copier_folders(terminal_id: &str) -> Result<(), std::io::Error> {
    let terminal_path = find_terminal_path(terminal_id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::NotFound, e))?;
    
    let files_path = terminal_path.join("MQL5").join("Files");

    std::fs::create_dir_all(files_path.join("CopierQueue"))?;
    std::fs::create_dir_all(files_path.join("CopierCommands"))?;
    std::fs::create_dir_all(files_path.join("CopierEvents"))?;

    Ok(())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Mt5Terminal {
    pub terminal_id: String,
    pub path: String,
    pub broker: Option<String>,
    pub has_mql5: bool,
    pub master_installed: bool,
    pub receiver_installed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_info: Option<AccountInfo>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AccountInfo {
    pub account_number: String,
    pub broker: String,
    pub balance: f64,
    pub equity: f64,
    pub margin: f64,
    pub free_margin: f64,
    pub leverage: i32,
    pub currency: String,
    pub server: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MasterHeartbeat {
    pub timestamp_utc: String,
    pub terminal_id: String,
    pub account: i64,
    pub balance: f64,
    pub equity: f64,
    pub open_positions: i32,
}