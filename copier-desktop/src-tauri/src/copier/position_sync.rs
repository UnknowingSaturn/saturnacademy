//! Position synchronization module
//! Handles syncing open positions between master and receiver accounts

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

/// Open position from master
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MasterPosition {
    pub position_id: i64,
    pub symbol: String,
    pub direction: String,
    pub volume: f64,
    pub open_price: f64,
    pub sl: f64,
    pub tp: f64,
}

/// Open positions file structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenPositionsFile {
    pub positions: Vec<MasterPosition>,
    pub updated_at: String,
}

/// Position sync status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PositionSyncStatus {
    pub master_positions: Vec<MasterPosition>,
    pub receiver_positions: HashMap<String, Vec<ReceiverPosition>>,
    pub discrepancies: Vec<PositionDiscrepancy>,
}

/// Receiver position info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReceiverPosition {
    pub position_id: i64,
    pub master_position_id: i64,
    pub symbol: String,
    pub direction: String,
    pub volume: f64,
}

/// Discrepancy between master and receiver
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PositionDiscrepancy {
    pub discrepancy_type: DiscrepancyType,
    pub master_position: Option<MasterPosition>,
    pub receiver_id: String,
    pub receiver_position: Option<ReceiverPosition>,
    pub suggested_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DiscrepancyType {
    MissingOnReceiver,   // Position exists on master but not on receiver
    OrphanedOnReceiver,  // Position exists on receiver but not on master
    VolumeMismatch,      // Position exists on both but volumes don't match
    DirectionMismatch,   // Position exists on both but directions don't match
}

/// Read open positions from master's queue folder
pub fn read_master_positions(terminal_id: &str) -> Result<Vec<MasterPosition>, String> {
    let appdata = std::env::var("APPDATA")
        .map_err(|_| "APPDATA environment variable not found")?;
    
    let positions_file = PathBuf::from(appdata)
        .join("MetaQuotes")
        .join("Terminal")
        .join(terminal_id)
        .join("MQL5")
        .join("Files")
        .join("CopierQueue")
        .join("open_positions.json");
    
    if !positions_file.exists() {
        return Ok(vec![]);
    }
    
    let content = fs::read_to_string(&positions_file)
        .map_err(|e| format!("Failed to read positions file: {}", e))?;
    
    let file: OpenPositionsFile = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse positions file: {}", e))?;
    
    Ok(file.positions)
}

/// Read receiver position mappings from copier-positions.json
pub fn read_receiver_positions(terminal_id: &str) -> Result<Vec<ReceiverPosition>, String> {
    let appdata = std::env::var("APPDATA")
        .map_err(|_| "APPDATA environment variable not found")?;
    
    let positions_file = PathBuf::from(appdata)
        .join("MetaQuotes")
        .join("Terminal")
        .join(terminal_id)
        .join("MQL5")
        .join("Files")
        .join("copier-positions.json");
    
    if !positions_file.exists() {
        return Ok(vec![]);
    }
    
    let content = fs::read_to_string(&positions_file)
        .map_err(|e| format!("Failed to read receiver positions: {}", e))?;
    
    // The file format is: master_pos_id|receiver_pos_id|symbol|direction|lots
    let mut positions = vec![];
    for line in content.lines() {
        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() >= 5 {
            positions.push(ReceiverPosition {
                master_position_id: parts[0].parse().unwrap_or(0),
                position_id: parts[1].parse().unwrap_or(0),
                symbol: parts[2].to_string(),
                direction: parts[3].to_string(),
                volume: parts[4].parse().unwrap_or(0.0),
            });
        }
    }
    
    Ok(positions)
}

/// Find discrepancies between master and receiver positions
pub fn find_discrepancies(
    master_positions: &[MasterPosition],
    receiver_positions: &[ReceiverPosition],
    receiver_id: &str,
) -> Vec<PositionDiscrepancy> {
    let mut discrepancies = vec![];
    
    // Check for positions on master that are missing on receiver
    for master_pos in master_positions {
        let receiver_pos = receiver_positions.iter()
            .find(|r| r.master_position_id == master_pos.position_id);
        
        match receiver_pos {
            None => {
                discrepancies.push(PositionDiscrepancy {
                    discrepancy_type: DiscrepancyType::MissingOnReceiver,
                    master_position: Some(master_pos.clone()),
                    receiver_id: receiver_id.to_string(),
                    receiver_position: None,
                    suggested_action: format!(
                        "Open {} {} {} lots on receiver",
                        master_pos.symbol, master_pos.direction, master_pos.volume
                    ),
                });
            }
            Some(recv) => {
                // Check for volume mismatch (allow 10% tolerance)
                let volume_diff = (master_pos.volume - recv.volume).abs();
                if volume_diff > master_pos.volume * 0.1 {
                    discrepancies.push(PositionDiscrepancy {
                        discrepancy_type: DiscrepancyType::VolumeMismatch,
                        master_position: Some(master_pos.clone()),
                        receiver_id: receiver_id.to_string(),
                        receiver_position: Some(recv.clone()),
                        suggested_action: format!(
                            "Adjust receiver volume from {} to {}",
                            recv.volume, master_pos.volume
                        ),
                    });
                }
                
                // Check for direction mismatch
                if master_pos.direction != recv.direction {
                    discrepancies.push(PositionDiscrepancy {
                        discrepancy_type: DiscrepancyType::DirectionMismatch,
                        master_position: Some(master_pos.clone()),
                        receiver_id: receiver_id.to_string(),
                        receiver_position: Some(recv.clone()),
                        suggested_action: "Close receiver position and re-open with correct direction".to_string(),
                    });
                }
            }
        }
    }
    
    // Check for orphaned positions on receiver
    for recv_pos in receiver_positions {
        let master_exists = master_positions.iter()
            .any(|m| m.position_id == recv_pos.master_position_id);
        
        if !master_exists {
            discrepancies.push(PositionDiscrepancy {
                discrepancy_type: DiscrepancyType::OrphanedOnReceiver,
                master_position: None,
                receiver_id: receiver_id.to_string(),
                receiver_position: Some(recv_pos.clone()),
                suggested_action: format!(
                    "Close orphaned receiver position {} (master position closed)",
                    recv_pos.position_id
                ),
            });
        }
    }
    
    discrepancies
}

/// Generate a sync report for all receivers
pub fn generate_sync_report(
    master_terminal_id: &str,
    receiver_terminal_ids: &[String],
) -> Result<PositionSyncStatus, String> {
    let master_positions = read_master_positions(master_terminal_id)?;
    
    let mut receiver_positions: HashMap<String, Vec<ReceiverPosition>> = HashMap::new();
    let mut all_discrepancies: Vec<PositionDiscrepancy> = vec![];
    
    for receiver_id in receiver_terminal_ids {
        let recv_positions = read_receiver_positions(receiver_id)?;
        let discrepancies = find_discrepancies(&master_positions, &recv_positions, receiver_id);
        
        receiver_positions.insert(receiver_id.clone(), recv_positions);
        all_discrepancies.extend(discrepancies);
    }
    
    Ok(PositionSyncStatus {
        master_positions,
        receiver_positions,
        discrepancies: all_discrepancies,
    })
}

/// Write a sync command file for a receiver to execute
pub fn write_sync_command(
    receiver_terminal_id: &str,
    command: &SyncCommand,
) -> Result<(), String> {
    let appdata = std::env::var("APPDATA")
        .map_err(|_| "APPDATA environment variable not found")?;
    
    let commands_folder = PathBuf::from(appdata)
        .join("MetaQuotes")
        .join("Terminal")
        .join(receiver_terminal_id)
        .join("MQL5")
        .join("Files")
        .join("CopierCommands");
    
    fs::create_dir_all(&commands_folder)
        .map_err(|e| format!("Failed to create commands folder: {}", e))?;
    
    let filename = format!("sync_{}.json", chrono::Utc::now().timestamp_millis());
    let command_file = commands_folder.join(filename);
    
    let json = serde_json::to_string_pretty(command)
        .map_err(|e| format!("Failed to serialize command: {}", e))?;
    
    fs::write(&command_file, json)
        .map_err(|e| format!("Failed to write command file: {}", e))?;
    
    Ok(())
}

/// Sync command for receiver EA
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncCommand {
    pub command_type: String, // "open", "close", "close_all", "modify"
    pub position_id: Option<i64>,
    pub master_position_id: Option<i64>,
    pub symbol: Option<String>,
    pub direction: Option<String>,
    pub volume: Option<f64>,
    pub sl: Option<f64>,
    pub tp: Option<f64>,
    pub timestamp: String,
}

impl SyncCommand {
    pub fn close_all() -> Self {
        Self {
            command_type: "close_all".to_string(),
            position_id: None,
            master_position_id: None,
            symbol: None,
            direction: None,
            volume: None,
            sl: None,
            tp: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
        }
    }
    
    pub fn open_position(master_pos: &MasterPosition) -> Self {
        Self {
            command_type: "open".to_string(),
            position_id: None,
            master_position_id: Some(master_pos.position_id),
            symbol: Some(master_pos.symbol.clone()),
            direction: Some(master_pos.direction.clone()),
            volume: Some(master_pos.volume),
            sl: Some(master_pos.sl),
            tp: Some(master_pos.tp),
            timestamp: chrono::Utc::now().to_rfc3339(),
        }
    }
    
    pub fn close_position(receiver_position_id: i64) -> Self {
        Self {
            command_type: "close".to_string(),
            position_id: Some(receiver_position_id),
            master_position_id: None,
            symbol: None,
            direction: None,
            volume: None,
            sl: None,
            tp: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
        }
    }
}
