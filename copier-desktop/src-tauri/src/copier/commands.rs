//! Emergency commands module
//! Handles close all, pause, and other emergency operations

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use super::event_processor::get_cached_terminals;

/// Emergency command types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EmergencyCommandType {
    CloseAll,
    PauseCopying,
    ResumeCopying,
    ModifyAllSL,
    ModifyAllTP,
}

/// Emergency command for receiver EA
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmergencyCommand {
    pub command_type: EmergencyCommandType,
    pub value: Option<f64>, // For SL/TP modification
    pub timestamp: String,
    pub reason: Option<String>,
}

impl EmergencyCommand {
    pub fn close_all(reason: Option<String>) -> Self {
        Self {
            command_type: EmergencyCommandType::CloseAll,
            value: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
            reason,
        }
    }
    
    pub fn pause() -> Self {
        Self {
            command_type: EmergencyCommandType::PauseCopying,
            value: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
            reason: None,
        }
    }
    
    pub fn resume() -> Self {
        Self {
            command_type: EmergencyCommandType::ResumeCopying,
            value: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
            reason: None,
        }
    }
}

/// Get the commands folder path for a terminal
/// Supports both standard APPDATA installations and portable terminals
/// Uses cached terminal list for efficiency
fn get_commands_folder(terminal_id: &str) -> Option<PathBuf> {
    // Check if it's a portable terminal first
    if terminal_id.starts_with("portable_") {
        // Use cached terminal list for efficiency (M1 fix)
        let terminals = get_cached_terminals();
        for terminal in terminals {
            if terminal.terminal_id == terminal_id {
                return Some(PathBuf::from(&terminal.path)
                    .join("MQL5")
                    .join("Files")
                    .join("CopierCommands"));
            }
        }
        return None;
    }
    
    // Standard AppData terminal
    let appdata = std::env::var("APPDATA").ok()?;
    Some(PathBuf::from(appdata)
        .join("MetaQuotes")
        .join("Terminal")
        .join(terminal_id)
        .join("MQL5")
        .join("Files")
        .join("CopierCommands"))
}

/// Write an emergency command to a receiver terminal (atomic write)
pub fn send_emergency_command(
    terminal_id: &str,
    command: &EmergencyCommand,
) -> Result<(), String> {
    let commands_folder = get_commands_folder(terminal_id)
        .ok_or_else(|| "Could not determine commands folder path".to_string())?;
    
    fs::create_dir_all(&commands_folder)
        .map_err(|e| format!("Failed to create commands folder: {}", e))?;
    
    let timestamp = chrono::Utc::now().timestamp_millis();
    let temp_filename = format!("emergency_{}.json.tmp", timestamp);
    let final_filename = format!("emergency_{}.json", timestamp);
    
    let temp_file = commands_folder.join(&temp_filename);
    let command_file = commands_folder.join(&final_filename);
    
    let json = serde_json::to_string_pretty(command)
        .map_err(|e| format!("Failed to serialize command: {}", e))?;
    
    // Write to temp file first
    fs::write(&temp_file, json)
        .map_err(|e| format!("Failed to write command: {}", e))?;
    
    // Atomic rename
    fs::rename(&temp_file, &command_file)
        .map_err(|e| format!("Failed to finalize command: {}", e))?;
    
    Ok(())
}

/// Send close all command to all receivers
pub fn close_all_positions(receiver_terminal_ids: &[String], reason: Option<String>) -> Result<(), String> {
    let command = EmergencyCommand::close_all(reason);
    
    for terminal_id in receiver_terminal_ids {
        send_emergency_command(terminal_id, &command)?;
    }
    
    Ok(())
}

/// Send pause command to all receivers
pub fn pause_all_receivers(receiver_terminal_ids: &[String]) -> Result<(), String> {
    let command = EmergencyCommand::pause();
    
    for terminal_id in receiver_terminal_ids {
        send_emergency_command(terminal_id, &command)?;
    }
    
    Ok(())
}

/// Send resume command to all receivers
pub fn resume_all_receivers(receiver_terminal_ids: &[String]) -> Result<(), String> {
    let command = EmergencyCommand::resume();
    
    for terminal_id in receiver_terminal_ids {
        send_emergency_command(terminal_id, &command)?;
    }
    
    Ok(())
}

/// Read heartbeat from master terminal
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Heartbeat {
    pub timestamp_utc: String,
    pub terminal_id: String,
    pub account: i64,
    pub balance: f64,
    pub equity: f64,
    pub open_positions: i32,
}

pub fn read_master_heartbeat(terminal_id: &str) -> Result<Heartbeat, String> {
    // Use the cached terminal list for portable support
    let terminals = get_cached_terminals();
    
    let terminal_path = terminals
        .into_iter()
        .find(|t| t.terminal_id == terminal_id)
        .map(|t| PathBuf::from(t.path));
    
    let terminal_path = match terminal_path {
        Some(p) => p,
        None => {
            // Fallback to standard AppData path
            let appdata = std::env::var("APPDATA")
                .map_err(|_| "APPDATA not found")?;
            PathBuf::from(appdata)
                .join("MetaQuotes")
                .join("Terminal")
                .join(terminal_id)
        }
    };
    
    // Primary path: CopierQueue/heartbeat.json
    let heartbeat_file = terminal_path
        .join("MQL5")
        .join("Files")
        .join("CopierQueue")
        .join("heartbeat.json");
    
    if heartbeat_file.exists() {
        let content = fs::read_to_string(&heartbeat_file)
            .map_err(|e| format!("Failed to read heartbeat: {}", e))?;
        
        return serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse heartbeat: {}", e));
    }
    
    // Fallback: legacy path
    let legacy_file = terminal_path.join("MQL5").join("Files").join("CopierHeartbeat.json");
    if legacy_file.exists() {
        let content = fs::read_to_string(&legacy_file)
            .map_err(|e| format!("Failed to read heartbeat: {}", e))?;
        
        return serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse heartbeat: {}", e));
    }
    
    Err("Heartbeat file not found".to_string())
}

/// Check if master is online (heartbeat within last 30 seconds)
pub fn is_master_online(terminal_id: &str) -> bool {
    match read_master_heartbeat(terminal_id) {
        Ok(heartbeat) => {
            if let Ok(timestamp) = chrono::DateTime::parse_from_rfc3339(&heartbeat.timestamp_utc) {
                let now = chrono::Utc::now();
                let diff = now.signed_duration_since(timestamp);
                diff.num_seconds() < 30
            } else {
                false
            }
        }
        Err(_) => false,
    }
}
