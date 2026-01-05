//! Automatic position reconciliation loop
//! Periodically compares master vs receiver positions and auto-corrects discrepancies

use crate::copier::position_sync::{
    find_discrepancies, read_master_positions, read_receiver_positions, 
    write_sync_command, DiscrepancyType, PositionDiscrepancy, SyncCommand,
};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tracing::{debug, info, warn};

/// Reconciliation configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReconciliationConfig {
    /// Enable automatic reconciliation
    pub enabled: bool,
    /// Interval between reconciliation checks (seconds)
    pub interval_secs: u64,
    /// Auto-close orphaned positions on receivers
    pub auto_close_orphaned: bool,
    /// Auto-open missing positions on receivers
    pub auto_open_missing: bool,
    /// Auto-adjust volume mismatches (partial closes)
    pub auto_adjust_volume: bool,
    /// Auto-sync SL/TP modifications
    pub auto_sync_sl_tp: bool,
}

impl Default for ReconciliationConfig {
    fn default() -> Self {
        Self {
            enabled: false, // Disabled by default for safety
            interval_secs: 30,
            auto_close_orphaned: false,
            auto_open_missing: false,
            auto_adjust_volume: false,
            auto_sync_sl_tp: true, // SL/TP sync is safest
        }
    }
}

/// Reconciliation action taken
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReconciliationAction {
    pub timestamp: String,
    pub receiver_id: String,
    pub action_type: String,
    pub symbol: String,
    pub details: String,
    pub success: bool,
    pub error: Option<String>,
}

/// Reconciliation state
pub struct ReconciliationState {
    pub config: ReconciliationConfig,
    pub master_terminal_id: Option<String>,
    pub receiver_terminal_ids: Vec<String>,
    pub last_run: Option<String>,
    pub actions_taken: Vec<ReconciliationAction>,
    pub is_running: bool,
}

impl Default for ReconciliationState {
    fn default() -> Self {
        Self {
            config: ReconciliationConfig::default(),
            master_terminal_id: None,
            receiver_terminal_ids: vec![],
            last_run: None,
            actions_taken: vec![],
            is_running: false,
        }
    }
}

/// Global reconciliation state
lazy_static::lazy_static! {
    static ref RECONCILIATION_STATE: Arc<Mutex<ReconciliationState>> = Arc::new(Mutex::new(ReconciliationState::default()));
    static ref SHUTDOWN_FLAG: AtomicBool = AtomicBool::new(false);
}

/// Initialize reconciliation with master and receiver terminals
pub fn init_reconciliation(
    master_terminal_id: &str,
    receiver_terminal_ids: &[String],
    config: ReconciliationConfig,
) {
    let mut state = RECONCILIATION_STATE.lock();
    state.master_terminal_id = Some(master_terminal_id.to_string());
    state.receiver_terminal_ids = receiver_terminal_ids.to_vec();
    state.config = config;
    
    info!(
        "Reconciliation initialized: master={}, receivers={:?}, enabled={}",
        master_terminal_id, receiver_terminal_ids, state.config.enabled
    );
}

/// Update reconciliation config
pub fn update_reconciliation_config(config: ReconciliationConfig) {
    let mut state = RECONCILIATION_STATE.lock();
    state.config = config;
    info!("Reconciliation config updated: enabled={}", state.config.enabled);
}

/// Get current reconciliation status
pub fn get_reconciliation_status() -> (ReconciliationConfig, Option<String>, Vec<ReconciliationAction>) {
    let state = RECONCILIATION_STATE.lock();
    (
        state.config.clone(),
        state.last_run.clone(),
        state.actions_taken.clone(),
    )
}

/// Start the reconciliation loop in a background thread
pub fn start_reconciliation_loop() {
    SHUTDOWN_FLAG.store(false, Ordering::SeqCst);
    
    thread::spawn(move || {
        info!("Reconciliation loop started");
        
        loop {
            if SHUTDOWN_FLAG.load(Ordering::SeqCst) {
                info!("Reconciliation loop shutting down");
                break;
            }
            
            let (config, master_id, receiver_ids) = {
                let state = RECONCILIATION_STATE.lock();
                (
                    state.config.clone(),
                    state.master_terminal_id.clone(),
                    state.receiver_terminal_ids.clone(),
                )
            };
            
            if config.enabled {
                if let (Some(master), receivers) = (master_id, receiver_ids) {
                    if !receivers.is_empty() {
                        run_reconciliation_cycle(&master, &receivers, &config);
                    }
                }
            }
            
            // Sleep for the configured interval
            let interval = {
                let state = RECONCILIATION_STATE.lock();
                state.config.interval_secs
            };
            
            for _ in 0..(interval * 10) {
                if SHUTDOWN_FLAG.load(Ordering::SeqCst) {
                    break;
                }
                thread::sleep(Duration::from_millis(100));
            }
        }
    });
}

/// Stop the reconciliation loop
pub fn stop_reconciliation_loop() {
    SHUTDOWN_FLAG.store(true, Ordering::SeqCst);
    info!("Reconciliation loop stop requested");
}

/// Run a single reconciliation cycle
fn run_reconciliation_cycle(
    master_terminal_id: &str,
    receiver_terminal_ids: &[String],
    config: &ReconciliationConfig,
) {
    debug!("Running reconciliation cycle");
    
    // Read master positions
    let master_positions = match read_master_positions(master_terminal_id) {
        Ok(positions) => positions,
        Err(e) => {
            warn!("Failed to read master positions: {}", e);
            return;
        }
    };
    
    debug!("Master has {} open positions", master_positions.len());
    
    for receiver_id in receiver_terminal_ids {
        // Read receiver positions
        let receiver_positions = match read_receiver_positions(receiver_id) {
            Ok(positions) => positions,
            Err(e) => {
                warn!("Failed to read receiver {} positions: {}", receiver_id, e);
                continue;
            }
        };
        
        debug!("Receiver {} has {} positions mapped", receiver_id, receiver_positions.len());
        
        // Find discrepancies
        let discrepancies = find_discrepancies(&master_positions, &receiver_positions, receiver_id);
        
        if discrepancies.is_empty() {
            debug!("No discrepancies for receiver {}", receiver_id);
            continue;
        }
        
        info!("Found {} discrepancies for receiver {}", discrepancies.len(), receiver_id);
        
        // Handle each discrepancy based on config
        for discrepancy in discrepancies {
            handle_discrepancy(receiver_id, &discrepancy, config);
        }
    }
    
    // Update last run timestamp
    let mut state = RECONCILIATION_STATE.lock();
    state.last_run = Some(chrono::Utc::now().to_rfc3339());
}

/// Handle a single discrepancy
fn handle_discrepancy(
    receiver_id: &str,
    discrepancy: &PositionDiscrepancy,
    config: &ReconciliationConfig,
) {
    let action = match discrepancy.discrepancy_type {
        DiscrepancyType::MissingOnReceiver => {
            if config.auto_open_missing {
                if let Some(ref master_pos) = discrepancy.master_position {
                    let cmd = SyncCommand::open_position(master_pos);
                    match write_sync_command(receiver_id, &cmd) {
                        Ok(_) => ReconciliationAction {
                            timestamp: chrono::Utc::now().to_rfc3339(),
                            receiver_id: receiver_id.to_string(),
                            action_type: "open_missing".to_string(),
                            symbol: master_pos.symbol.clone(),
                            details: format!("Opening {} {} lots", master_pos.direction, master_pos.volume),
                            success: true,
                            error: None,
                        },
                        Err(e) => ReconciliationAction {
                            timestamp: chrono::Utc::now().to_rfc3339(),
                            receiver_id: receiver_id.to_string(),
                            action_type: "open_missing".to_string(),
                            symbol: master_pos.symbol.clone(),
                            details: format!("Failed to open {} {} lots", master_pos.direction, master_pos.volume),
                            success: false,
                            error: Some(e),
                        },
                    }
                } else {
                    return;
                }
            } else {
                debug!("Auto-open disabled, skipping missing position");
                return;
            }
        }
        
        DiscrepancyType::OrphanedOnReceiver => {
            if config.auto_close_orphaned {
                if let Some(ref recv_pos) = discrepancy.receiver_position {
                    let cmd = SyncCommand::close_position(recv_pos.position_id);
                    match write_sync_command(receiver_id, &cmd) {
                        Ok(_) => ReconciliationAction {
                            timestamp: chrono::Utc::now().to_rfc3339(),
                            receiver_id: receiver_id.to_string(),
                            action_type: "close_orphaned".to_string(),
                            symbol: recv_pos.symbol.clone(),
                            details: format!("Closing orphaned position {}", recv_pos.position_id),
                            success: true,
                            error: None,
                        },
                        Err(e) => ReconciliationAction {
                            timestamp: chrono::Utc::now().to_rfc3339(),
                            receiver_id: receiver_id.to_string(),
                            action_type: "close_orphaned".to_string(),
                            symbol: recv_pos.symbol.clone(),
                            details: format!("Failed to close orphaned position {}", recv_pos.position_id),
                            success: false,
                            error: Some(e),
                        },
                    }
                } else {
                    return;
                }
            } else {
                debug!("Auto-close disabled, skipping orphaned position");
                return;
            }
        }
        
        DiscrepancyType::SLMismatch | DiscrepancyType::TPMismatch => {
            if config.auto_sync_sl_tp {
                if let (Some(ref master_pos), Some(ref recv_pos)) = (&discrepancy.master_position, &discrepancy.receiver_position) {
                    let cmd = SyncCommand::modify_sl_tp(recv_pos.position_id, master_pos.sl, master_pos.tp);
                    match write_sync_command(receiver_id, &cmd) {
                        Ok(_) => ReconciliationAction {
                            timestamp: chrono::Utc::now().to_rfc3339(),
                            receiver_id: receiver_id.to_string(),
                            action_type: "modify_sl_tp".to_string(),
                            symbol: master_pos.symbol.clone(),
                            details: format!("Updating SL={:.5} TP={:.5}", master_pos.sl, master_pos.tp),
                            success: true,
                            error: None,
                        },
                        Err(e) => ReconciliationAction {
                            timestamp: chrono::Utc::now().to_rfc3339(),
                            receiver_id: receiver_id.to_string(),
                            action_type: "modify_sl_tp".to_string(),
                            symbol: master_pos.symbol.clone(),
                            details: format!("Failed to update SL/TP"),
                            success: false,
                            error: Some(e),
                        },
                    }
                } else {
                    return;
                }
            } else {
                debug!("Auto SL/TP sync disabled, skipping");
                return;
            }
        }
        
        DiscrepancyType::VolumeMismatch => {
            // Volume adjustments are complex (partial close) - log but don't auto-handle
            if config.auto_adjust_volume {
                info!("Volume mismatch detected but auto-adjust not yet implemented");
            }
            return;
        }
        
        DiscrepancyType::DirectionMismatch => {
            // Direction mismatch is serious - never auto-correct
            warn!("Direction mismatch detected - requires manual intervention");
            return;
        }
    };
    
    // Record the action
    let mut state = RECONCILIATION_STATE.lock();
    state.actions_taken.push(action);
    
    // Keep only last 100 actions
    if state.actions_taken.len() > 100 {
        state.actions_taken.remove(0);
    }
}

/// Manual trigger for a reconciliation run
pub fn trigger_reconciliation() -> Result<Vec<PositionDiscrepancy>, String> {
    let (master_id, receiver_ids) = {
        let state = RECONCILIATION_STATE.lock();
        (
            state.master_terminal_id.clone(),
            state.receiver_terminal_ids.clone(),
        )
    };
    
    let master_id = master_id.ok_or("No master terminal configured")?;
    
    if receiver_ids.is_empty() {
        return Err("No receiver terminals configured".to_string());
    }
    
    // Read master positions
    let master_positions = read_master_positions(&master_id)?;
    
    let mut all_discrepancies = vec![];
    
    for receiver_id in &receiver_ids {
        let receiver_positions = read_receiver_positions(receiver_id)?;
        let discrepancies = find_discrepancies(&master_positions, &receiver_positions, receiver_id);
        all_discrepancies.extend(discrepancies);
    }
    
    // Update last run
    let mut state = RECONCILIATION_STATE.lock();
    state.last_run = Some(chrono::Utc::now().to_rfc3339());
    
    Ok(all_discrepancies)
}
