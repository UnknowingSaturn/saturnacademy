//! Position synchronization module
//! Handles syncing open positions between master and receiver accounts

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tracing::debug;

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
    // Additional fields for relative pricing
    #[serde(default)]
    pub sl_distance_points: Option<f64>,
    #[serde(default)]
    pub tp_distance_points: Option<f64>,
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
    #[serde(default)]
    pub sl: Option<f64>,
    #[serde(default)]
    pub tp: Option<f64>,
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
    SLMismatch,          // Stop loss doesn't match (outside tolerance)
    TPMismatch,          // Take profit doesn't match (outside tolerance)
}

/// Read open positions from master's queue folder
pub fn read_master_positions(terminal_id: &str) -> Result<Vec<MasterPosition>, String> {
    // Try to find terminal path using MT5 bridge for portable support
    let positions_file = find_terminal_files_path(terminal_id)?
        .join("CopierQueue")
        .join("open_positions.json");
    
    if !positions_file.exists() {
        debug!("Master positions file not found: {:?}", positions_file);
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
    let positions_file = find_terminal_files_path(terminal_id)?
        .join("copier-positions.json");
    
    if !positions_file.exists() {
        debug!("Receiver positions file not found: {:?}", positions_file);
        return Ok(vec![]);
    }
    
    let content = fs::read_to_string(&positions_file)
        .map_err(|e| format!("Failed to read receiver positions: {}", e))?;
    
    // Try JSON format first (preferred format from EA)
    if let Ok(positions) = serde_json::from_str::<Vec<ReceiverPosition>>(&content) {
        return Ok(positions);
    }
    
    // Try JSON with wrapper object (EA might write {"positions": [...]})
    #[derive(Deserialize)]
    struct PositionsWrapper {
        positions: Vec<ReceiverPosition>,
    }
    if let Ok(wrapper) = serde_json::from_str::<PositionsWrapper>(&content) {
        return Ok(wrapper.positions);
    }
    
    // Fallback to pipe-delimited format: master_pos_id|receiver_pos_id|symbol|direction|lots|sl|tp
    let mut positions = vec![];
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() >= 5 {
            positions.push(ReceiverPosition {
                master_position_id: parts[0].parse().unwrap_or(0),
                position_id: parts[1].parse().unwrap_or(0),
                symbol: parts[2].to_string(),
                direction: parts[3].to_string(),
                volume: parts[4].parse().unwrap_or(0.0),
                sl: parts.get(5).and_then(|s| s.parse().ok()),
                tp: parts.get(6).and_then(|s| s.parse().ok()),
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
    
    // Tolerance for SL/TP comparison (in price points)
    const SL_TP_TOLERANCE: f64 = 0.0001; // ~1 pip for forex
    
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
                
                // Check for SL mismatch
                if master_pos.sl > 0.0 {
                    if let Some(recv_sl) = recv.sl {
                        let sl_diff = (master_pos.sl - recv_sl).abs();
                        if sl_diff > SL_TP_TOLERANCE {
                            discrepancies.push(PositionDiscrepancy {
                                discrepancy_type: DiscrepancyType::SLMismatch,
                                master_position: Some(master_pos.clone()),
                                receiver_id: receiver_id.to_string(),
                                receiver_position: Some(recv.clone()),
                                suggested_action: format!(
                                    "Update receiver SL from {} to {}",
                                    recv_sl, master_pos.sl
                                ),
                            });
                        }
                    } else {
                        // Master has SL but receiver doesn't
                        discrepancies.push(PositionDiscrepancy {
                            discrepancy_type: DiscrepancyType::SLMismatch,
                            master_position: Some(master_pos.clone()),
                            receiver_id: receiver_id.to_string(),
                            receiver_position: Some(recv.clone()),
                            suggested_action: format!(
                                "Set receiver SL to {}",
                                master_pos.sl
                            ),
                        });
                    }
                }
                
                // Check for TP mismatch
                if master_pos.tp > 0.0 {
                    if let Some(recv_tp) = recv.tp {
                        let tp_diff = (master_pos.tp - recv_tp).abs();
                        if tp_diff > SL_TP_TOLERANCE {
                            discrepancies.push(PositionDiscrepancy {
                                discrepancy_type: DiscrepancyType::TPMismatch,
                                master_position: Some(master_pos.clone()),
                                receiver_id: receiver_id.to_string(),
                                receiver_position: Some(recv.clone()),
                                suggested_action: format!(
                                    "Update receiver TP from {} to {}",
                                    recv_tp, master_pos.tp
                                ),
                            });
                        }
                    } else {
                        // Master has TP but receiver doesn't
                        discrepancies.push(PositionDiscrepancy {
                            discrepancy_type: DiscrepancyType::TPMismatch,
                            master_position: Some(master_pos.clone()),
                            receiver_id: receiver_id.to_string(),
                            receiver_position: Some(recv.clone()),
                            suggested_action: format!(
                                "Set receiver TP to {}",
                                master_pos.tp
                            ),
                        });
                    }
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
    let commands_folder = find_terminal_files_path(receiver_terminal_id)?
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

/// Find the MQL5/Files path for a terminal, supporting both standard and portable installations
fn find_terminal_files_path(terminal_id: &str) -> Result<PathBuf, String> {
    // Try portable terminal first via MT5 bridge
    if terminal_id.starts_with("portable_") {
        let terminals = crate::mt5::bridge::find_mt5_terminals();
        for terminal in terminals {
            if terminal.terminal_id == terminal_id {
                return Ok(PathBuf::from(&terminal.path).join("MQL5").join("Files"));
            }
        }
        return Err(format!("Portable terminal {} not found", terminal_id));
    }
    
    // Standard AppData terminal path
    let appdata = std::env::var("APPDATA")
        .map_err(|_| "APPDATA environment variable not found")?;
    
    let files_path = PathBuf::from(&appdata)
        .join("MetaQuotes")
        .join("Terminal")
        .join(terminal_id)
        .join("MQL5")
        .join("Files");
    
    if files_path.exists() {
        return Ok(files_path);
    }
    
    // Fallback: Check if MT5 bridge can find this terminal
    let terminals = crate::mt5::bridge::find_mt5_terminals();
    for terminal in terminals {
        if terminal.terminal_id == terminal_id {
            return Ok(PathBuf::from(&terminal.path).join("MQL5").join("Files"));
        }
    }
    
    Err(format!("Terminal {} not found in APPDATA or portable locations", terminal_id))
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

#[allow(dead_code)]
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
    
    pub fn modify_sl_tp(receiver_position_id: i64, sl: Option<f64>, tp: Option<f64>) -> Self {
        Self {
            command_type: "modify_sl_tp".to_string(),
            position_id: Some(receiver_position_id),
            master_position_id: None,
            symbol: None,
            direction: None,
            volume: None,
            sl,
            tp,
            timestamp: chrono::Utc::now().to_rfc3339(),
        }
    }
}
