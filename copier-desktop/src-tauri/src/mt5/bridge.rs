use std::path::{Path, PathBuf};

/// Find all MT5 terminal installations on the system
pub fn find_mt5_terminals() -> Vec<Mt5Terminal> {
    let mut terminals = Vec::new();

    // Check standard MetaQuotes Terminal folder
    if let Ok(appdata) = std::env::var("APPDATA") {
        let terminals_path = format!("{}\\MetaQuotes\\Terminal", appdata);
        
        if let Ok(entries) = std::fs::read_dir(&terminals_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    if let Some(terminal) = detect_terminal(&path) {
                        terminals.push(terminal);
                    }
                }
            }
        }
    }

    terminals
}

fn detect_terminal(path: &Path) -> Option<Mt5Terminal> {
    let terminal_id = path.file_name()?.to_str()?.to_string();
    
    // Check for terminal64.exe or terminal.exe
    let exe_path = path.join("terminal64.exe");
    if !exe_path.exists() {
        return None;
    }

    // Try to read broker info from origin.txt
    let origin_file = path.join("origin.txt");
    let broker = if origin_file.exists() {
        std::fs::read_to_string(&origin_file)
            .ok()
            .map(|s| s.trim().to_string())
    } else {
        None
    };

    // Check if MQL5/Files folder exists
    let files_path = path.join("MQL5").join("Files");
    let has_mql5 = files_path.exists();

    // Check which EAs are installed
    let experts_path = path.join("MQL5").join("Experts");
    let master_installed = experts_path.join("TradeCopierMaster.mq5").exists() 
        || experts_path.join("TradeCopierMaster.ex5").exists();
    let receiver_installed = experts_path.join("TradeCopierReceiver.mq5").exists()
        || experts_path.join("TradeCopierReceiver.ex5").exists();

    Some(Mt5Terminal {
        terminal_id,
        path: path.to_string_lossy().to_string(),
        broker,
        has_mql5,
        master_installed,
        receiver_installed,
    })
}

/// Install EA file to a terminal's MQL5/Experts folder
pub fn install_ea_to_terminal(
    terminal_id: &str,
    ea_type: &str,
    ea_content: &[u8],
) -> Result<String, String> {
    let appdata = std::env::var("APPDATA")
        .map_err(|_| "Could not find APPDATA directory".to_string())?;
    
    let terminal_path = PathBuf::from(format!(
        "{}\\MetaQuotes\\Terminal\\{}",
        appdata, terminal_id
    ));
    
    if !terminal_path.exists() {
        return Err(format!("Terminal {} not found", terminal_id));
    }

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

    Ok(ea_path.to_string_lossy().to_string())
}

/// Get account info from MT5 terminal via file
pub fn get_account_info(terminal_id: &str) -> Option<AccountInfo> {
    let appdata = std::env::var("APPDATA").ok()?;
    let info_file = format!(
        "{}\\MetaQuotes\\Terminal\\{}\\MQL5\\Files\\CopierAccountInfo.json",
        appdata, terminal_id
    );

    if !Path::new(&info_file).exists() {
        return None;
    }

    let content = std::fs::read_to_string(&info_file).ok()?;
    serde_json::from_str(&content).ok()
}

/// Ensure the CopierQueue and CopierCommands folders exist
#[allow(dead_code)]
pub fn ensure_copier_folders(terminal_id: &str) -> Result<(), std::io::Error> {
    let appdata = std::env::var("APPDATA")
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::NotFound, e.to_string()))?;
    
    let base_path = format!(
        "{}\\MetaQuotes\\Terminal\\{}\\MQL5\\Files",
        appdata, terminal_id
    );

    std::fs::create_dir_all(format!("{}\\CopierQueue", base_path))?;
    std::fs::create_dir_all(format!("{}\\CopierCommands", base_path))?;

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
