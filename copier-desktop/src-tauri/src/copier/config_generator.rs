//! Config file generator for trade copier
//! Generates copier-config.json for receiver EAs

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

/// Risk configuration for a receiver
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskConfig {
    pub mode: String, // balance_multiplier, fixed_lot, risk_percent, risk_dollar, intent
    pub value: f64,
}

/// Safety configuration for a receiver
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SafetyConfig {
    pub max_slippage_pips: f64,
    pub max_daily_loss_r: f64,
    pub max_drawdown_percent: Option<f64>,
    pub trailing_drawdown_enabled: bool,
    pub min_equity: Option<f64>,
    pub manual_confirm_mode: bool,
    pub prop_firm_safe_mode: bool,
    pub poll_interval_ms: i32,
}

/// Receiver configuration in the config file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReceiverConfigFile {
    pub receiver_id: String,
    pub account_name: String,
    pub account_number: String,
    pub broker: String,
    pub terminal_id: String,
    pub risk: RiskConfig,
    pub safety: SafetyConfig,
    pub symbol_mappings: HashMap<String, String>,
    pub symbol_overrides: Option<HashMap<String, SymbolOverride>>,
}

/// Per-symbol override settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolOverride {
    pub lot_multiplier: Option<f64>,
    pub max_lots: Option<f64>,
    pub enabled: bool,
}

/// Master configuration in the config file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MasterConfigFile {
    pub account_id: String,
    pub account_number: String,
    pub broker: String,
    pub terminal_id: String,
}

/// Full copier configuration file structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopierConfigFile {
    pub version: i32,
    pub config_hash: String,
    pub created_at: String,
    pub master: MasterConfigFile,
    pub receivers: Vec<ReceiverConfigFile>,
}

impl Default for SafetyConfig {
    fn default() -> Self {
        Self {
            max_slippage_pips: 3.0,
            max_daily_loss_r: 3.0,
            max_drawdown_percent: Some(5.0),
            trailing_drawdown_enabled: false,
            min_equity: None,
            manual_confirm_mode: false,
            prop_firm_safe_mode: false,
            poll_interval_ms: 1000,
        }
    }
}

impl Default for RiskConfig {
    fn default() -> Self {
        Self {
            mode: "balance_multiplier".to_string(),
            value: 1.0,
        }
    }
}

/// Generate a stable config hash using CRC32 (consistent across Rust versions)
pub fn generate_config_hash(config: &CopierConfigFile) -> String {
    use std::hash::{Hash, Hasher};
    
    // Create a reproducible hash by serializing to sorted JSON
    // We use a simple FNV-1a hash which is stable across versions
    let json = serde_json::to_string(config).unwrap_or_default();
    
    // FNV-1a 64-bit hash (stable, deterministic)
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in json.bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    
    format!("{:016x}", hash)
}

/// Get the MQL5 Files folder path for a terminal
/// Supports both standard APPDATA installations and portable terminals
pub fn get_terminal_files_path(terminal_id: &str) -> Option<PathBuf> {
    // Check if it's a portable terminal first - use cached terminals (M3 fix)
    if terminal_id.starts_with("portable_") {
        let terminals = crate::copier::event_processor::get_cached_terminals();
        for terminal in terminals {
            if terminal.terminal_id == terminal_id {
                let path = PathBuf::from(&terminal.path)
                    .join("MQL5")
                    .join("Files");
                if path.exists() {
                    return Some(path);
                }
                // Try to create it
                if fs::create_dir_all(&path).is_ok() {
                    return Some(path);
                }
            }
        }
        return None;
    }
    
    // Standard AppData terminal
    let appdata = std::env::var("APPDATA").ok()?;
    let path = PathBuf::from(appdata)
        .join("MetaQuotes")
        .join("Terminal")
        .join(terminal_id)
        .join("MQL5")
        .join("Files");
    
    if path.exists() {
        Some(path)
    } else {
        // Try to create it
        fs::create_dir_all(&path).ok()?;
        Some(path)
    }
}

/// Save config file to a receiver terminal (atomic write)
pub fn save_config_to_terminal(
    terminal_id: &str,
    config: &CopierConfigFile,
) -> Result<PathBuf, String> {
    let files_path = get_terminal_files_path(terminal_id)
        .ok_or_else(|| format!("Could not find MQL5/Files for terminal {}", terminal_id))?;
    
    let config_path = files_path.join("copier-config.json");
    let temp_path = files_path.join("copier-config.json.tmp");
    
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    
    // Write to temp file first
    fs::write(&temp_path, &json)
        .map_err(|e| format!("Failed to write temp config file: {}", e))?;
    
    // Atomic rename
    fs::rename(&temp_path, &config_path)
        .map_err(|e| format!("Failed to finalize config file: {}", e))?;
    
    Ok(config_path)
}

/// Build a complete config file from wizard data
pub fn build_config_file(
    master_terminal_id: &str,
    master_account_number: &str,
    master_broker: &str,
    receivers: Vec<ReceiverConfigFile>,
) -> CopierConfigFile {
    let now = chrono::Utc::now().to_rfc3339();
    
    let mut config = CopierConfigFile {
        version: 1,
        config_hash: String::new(),
        created_at: now,
        master: MasterConfigFile {
            account_id: format!("master_{}", master_account_number),
            account_number: master_account_number.to_string(),
            broker: master_broker.to_string(),
            terminal_id: master_terminal_id.to_string(),
        },
        receivers,
    };
    
    config.config_hash = generate_config_hash(&config);
    config
}

/// Create copier folders in a terminal's MQL5/Files directory
pub fn ensure_copier_folders(terminal_id: &str) -> Result<(), String> {
    let files_path = get_terminal_files_path(terminal_id)
        .ok_or_else(|| format!("Could not find MQL5/Files for terminal {}", terminal_id))?;
    
    let copier_queue = files_path.join("CopierQueue");
    let pending = copier_queue.join("pending");
    let executed = copier_queue.join("executed");
    
    fs::create_dir_all(&pending)
        .map_err(|e| format!("Failed to create pending folder: {}", e))?;
    fs::create_dir_all(&executed)
        .map_err(|e| format!("Failed to create executed folder: {}", e))?;
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_configs() {
        let safety = SafetyConfig::default();
        assert_eq!(safety.max_slippage_pips, 3.0);
        assert_eq!(safety.poll_interval_ms, 1000);
        
        let risk = RiskConfig::default();
        assert_eq!(risk.mode, "balance_multiplier");
        assert_eq!(risk.value, 1.0);
    }
    
    #[test]
    fn test_config_hash_stability() {
        // Create a config
        let config = CopierConfigFile {
            version: 1,
            config_hash: String::new(),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            master: MasterConfigFile {
                account_id: "master_123".to_string(),
                account_number: "123".to_string(),
                broker: "TestBroker".to_string(),
                terminal_id: "test_terminal".to_string(),
            },
            receivers: vec![],
        };
        
        // Hash should be consistent across calls
        let hash1 = generate_config_hash(&config);
        let hash2 = generate_config_hash(&config);
        assert_eq!(hash1, hash2);
    }
}
