//! File watcher for monitoring trade event files from Master EA
//! 
//! This module watches the CopierQueue/pending folder for JSON event files.
//! Includes safety measures like file stability checks, idempotency, and graceful shutdown.

use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tracing::{info, warn, error, debug};

use super::{event_processor, idempotency, CopierState, TradeEvent};
use crate::mt5::bridge;

/// Delay before reading a newly created file to ensure it's fully written
const FILE_STABILITY_DELAY_MS: u64 = 150;

/// Maximum retries for reading a file
const MAX_READ_RETRIES: u32 = 3;

/// Delay between read retries
const RETRY_DELAY_MS: u64 = 100;

/// Global shutdown flag for graceful termination
static SHUTDOWN_FLAG: AtomicBool = AtomicBool::new(false);

/// Request the file watcher to shut down gracefully
pub fn request_shutdown() {
    info!("Shutdown requested for file watcher");
    SHUTDOWN_FLAG.store(true, Ordering::SeqCst);
}

/// Check if shutdown has been requested
pub fn is_shutdown_requested() -> bool {
    SHUTDOWN_FLAG.load(Ordering::SeqCst)
}

/// Reset shutdown flag (for restart scenarios)
pub fn reset_shutdown() {
    SHUTDOWN_FLAG.store(false, Ordering::SeqCst);
}

pub fn start_watching(state: Arc<Mutex<CopierState>>) {
    info!("Starting file watcher...");

    while !is_shutdown_requested() {
        // Try to find master terminal path from config or auto-detect
        let queue_path = find_master_queue_path(&state);
        
        if let Some(path) = queue_path {
            // Watch the 'pending' subfolder where Master EA writes events
            let pending_path = format!("{}\\pending", path);
            
            // Ensure the pending folder exists
            if !Path::new(&pending_path).exists() {
                let _ = std::fs::create_dir_all(&pending_path);
            }
            
            if Path::new(&pending_path).exists() {
                info!("Watching queue folder: {}", pending_path);
                
                // Update state with the MT5 path for other modules
                {
                    let mut copier = state.lock();
                    // Extract parent path from queue_path
                    if let Some(parent) = Path::new(&path).parent().and_then(|p| p.parent()).and_then(|p| p.parent()) {
                        copier.mt5_data_path = Some(parent.to_string_lossy().to_string());
                    }
                }
                
                if let Err(e) = watch_folder(&pending_path, state.clone()) {
                    if is_shutdown_requested() {
                        info!("File watcher shutting down gracefully");
                        break;
                    }
                    error!("File watcher error: {}", e);
                    let mut copier = state.lock();
                    copier.last_error = Some(format!("Watcher error: {}", e));
                }
            } else {
                warn!("Pending folder does not exist: {}", pending_path);
            }
        } else {
            debug!("No master terminal found, waiting...");
        }

        // Check shutdown flag during wait
        for _ in 0..50 {
            if is_shutdown_requested() {
                info!("File watcher received shutdown signal");
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    
    info!("File watcher stopped");
}

/// Find the queue path from the master terminal
fn find_master_queue_path(state: &Arc<Mutex<CopierState>>) -> Option<String> {
    // First check if we have a config with master terminal
    {
        let copier = state.lock();
        if let Some(ref config) = copier.config {
            let terminal_id = &config.master.terminal_id;
            if let Some(path) = get_terminal_queue_path(terminal_id) {
                return Some(path);
            }
        }
        
        // Check if mt5_data_path is already set
        if let Some(ref path) = copier.mt5_data_path {
            let queue_path = format!("{}\\MQL5\\Files\\CopierQueue", path);
            if Path::new(&queue_path).exists() {
                return Some(queue_path);
            }
        }
    }
    
    // Auto-detect: find any terminal with Master EA installed AND online heartbeat
    let terminals = bridge::find_mt5_terminals();
    for terminal in terminals {
        if terminal.master_installed {
            // Verify heartbeat is fresh before using this terminal (M2 fix)
            if is_master_heartbeat_fresh(&terminal.terminal_id) {
                if let Some(path) = get_terminal_queue_path(&terminal.terminal_id) {
                    info!("Auto-detected master terminal with fresh heartbeat: {}", terminal.terminal_id);
                    return Some(path);
                }
            } else {
                debug!("Master terminal {} has stale heartbeat, skipping", terminal.terminal_id);
            }
        }
    }
    
    // Fallback: check any terminal with master installed (heartbeat might not be written yet)
    for terminal in bridge::find_mt5_terminals() {
        if terminal.master_installed {
            if let Some(path) = get_terminal_queue_path(&terminal.terminal_id) {
                info!("Using master terminal (no heartbeat verification): {}", terminal.terminal_id);
                return Some(path);
            }
        }
    }
    
    None
}

/// Check if master heartbeat is fresh (within last 30 seconds)
fn is_master_heartbeat_fresh(terminal_id: &str) -> bool {
    if let Some(heartbeat) = bridge::get_master_heartbeat(terminal_id) {
        if let Ok(timestamp) = chrono::DateTime::parse_from_rfc3339(&heartbeat.timestamp_utc) {
            let age = chrono::Utc::now().signed_duration_since(timestamp);
            return age.num_seconds() < 30;
        }
    }
    false
}

/// Get the CopierQueue path for a terminal
fn get_terminal_queue_path(terminal_id: &str) -> Option<String> {
    // Check if it's a portable terminal
    if terminal_id.starts_with("portable_") {
        // Search for it in known locations
        let terminals = bridge::find_mt5_terminals();
        for terminal in terminals {
            if terminal.terminal_id == terminal_id {
                let queue_path = format!("{}\\MQL5\\Files\\CopierQueue", terminal.path);
                if Path::new(&queue_path).exists() {
                    return Some(queue_path);
                }
            }
        }
        return None;
    }
    
    // Standard AppData terminal
    if let Ok(appdata) = std::env::var("APPDATA") {
        let queue_path = format!(
            "{}\\MetaQuotes\\Terminal\\{}\\MQL5\\Files\\CopierQueue",
            appdata, terminal_id
        );
        if Path::new(&queue_path).exists() {
            return Some(queue_path);
        }
    }
    
    None
}

fn watch_folder(path: &str, state: Arc<Mutex<CopierState>>) -> Result<(), Box<dyn std::error::Error>> {
    let (tx, rx) = std::sync::mpsc::channel();

    let mut watcher = RecommendedWatcher::new(
        move |res| {
            if let Ok(event) = res {
                let _ = tx.send(event);
            }
        },
        Config::default().with_poll_interval(Duration::from_millis(100)),
    )?;

    watcher.watch(Path::new(path), RecursiveMode::NonRecursive)?;

    // Also process any existing files
    process_existing_files(path, state.clone())?;

    // Process new files as they arrive with shutdown check
    loop {
        // Check for shutdown
        if is_shutdown_requested() {
            info!("File watcher received shutdown signal during event loop");
            return Ok(());
        }
        
        // Use recv_timeout to allow periodic shutdown checks
        match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(event) => {
                if let notify::EventKind::Create(_) = event.kind {
                    for file_path in event.paths {
                        if file_path.extension().map(|e| e == "json").unwrap_or(false) {
                            // Wait for file to be fully written before processing
                            std::thread::sleep(Duration::from_millis(FILE_STABILITY_DELAY_MS));
                            
                            // Verify file stability (size not changing)
                            if is_file_stable(&file_path) {
                                process_event_file(&file_path, state.clone());
                            } else {
                                warn!("File not stable, skipping: {:?}", file_path);
                            }
                        }
                    }
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                // Continue loop, will check shutdown flag
                continue;
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                error!("File watcher channel disconnected");
                return Err("Channel disconnected".into());
            }
        }
    }
}

/// Check if a file is stable (not being written to)
fn is_file_stable(path: &Path) -> bool {
    let initial_size = match std::fs::metadata(path) {
        Ok(m) => m.len(),
        Err(_) => return false,
    };
    
    std::thread::sleep(Duration::from_millis(50));
    
    match std::fs::metadata(path) {
        Ok(m) => m.len() == initial_size,
        Err(_) => false,
    }
}

fn process_existing_files(
    folder: &str,
    state: Arc<Mutex<CopierState>>,
) -> Result<(), Box<dyn std::error::Error>> {
    let entries = std::fs::read_dir(folder)?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map(|e| e == "json").unwrap_or(false) {
            process_event_file(&path, state.clone());
        }
    }

    Ok(())
}

/// Read file with retries for robustness
fn read_file_with_retry(path: &Path) -> Result<String, String> {
    let mut last_error = String::new();
    
    for attempt in 0..MAX_READ_RETRIES {
        match std::fs::read_to_string(path) {
            Ok(content) => return Ok(content),
            Err(e) => {
                last_error = e.to_string();
                warn!(
                    "Failed to read file {:?} (attempt {}/{}): {}",
                    path, attempt + 1, MAX_READ_RETRIES, e
                );
                
                if attempt < MAX_READ_RETRIES - 1 {
                    std::thread::sleep(Duration::from_millis(RETRY_DELAY_MS));
                }
            }
        }
    }
    
    Err(last_error)
}

fn process_event_file(path: &Path, state: Arc<Mutex<CopierState>>) {
    info!("Processing event file: {:?}", path);

    // Read the file with retry logic
    let content = match read_file_with_retry(path) {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to read event file after retries: {}", e);
            return;
        }
    };

    // Parse the trade event
    let event: TradeEvent = match serde_json::from_str(&content) {
        Ok(e) => e,
        Err(e) => {
            error!("Failed to parse event file: {}", e);
            // Still delete malformed files to prevent infinite loops
            if let Err(del_err) = std::fs::remove_file(path) {
                error!("Failed to delete malformed file: {}", del_err);
            }
            return;
        }
    };

    // Generate and check idempotency key
    let idempotency_key = idempotency::generate_idempotency_key(
        &event.event_type,
        event.ticket,
        event.deal_id.unwrap_or(0),
        &event.symbol,
        &event.timestamp,
    );
    
    if idempotency::is_event_processed(&idempotency_key) {
        info!("Skipping duplicate event: {}", idempotency_key);
        // Delete the duplicate file
        if let Err(e) = std::fs::remove_file(path) {
            error!("Failed to delete duplicate file: {}", e);
        }
        return;
    }

    // Check if copier is running
    let (is_running, config) = {
        let copier = state.lock();
        (copier.is_running, copier.config.clone())
    };

    if !is_running {
        info!("Copier is not running, skipping event");
        return;
    }

    let config = match config {
        Some(c) => c,
        None => {
            warn!("No configuration loaded, skipping event");
            return;
        }
    };

    // CRITICAL: Mark as processed BEFORE deleting file to prevent race conditions
    // If app crashes between delete and mark, the event could be reprocessed on restart
    idempotency::mark_event_processed(&idempotency_key);

    // Process the event for each receiver
    event_processor::process_event(&event, &config, state.clone());

    // Now safe to delete the processed file
    if let Err(e) = std::fs::remove_file(path) {
        error!("Failed to delete processed file: {}", e);
    }
}
