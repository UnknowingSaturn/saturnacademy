//! File watcher for monitoring trade event files from Master EA
//! 
//! This module watches a queue folder for JSON event files and processes them.
//! Includes safety measures like file stability checks and idempotency.

use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use super::{event_processor, idempotency, CopierState, TradeEvent};

/// Delay before reading a newly created file to ensure it's fully written
const FILE_STABILITY_DELAY_MS: u64 = 150;

/// Maximum retries for reading a file
const MAX_READ_RETRIES: u32 = 3;

/// Delay between read retries
const RETRY_DELAY_MS: u64 = 100;

pub fn start_watching(state: Arc<Mutex<CopierState>>) {
    log::info!("Starting file watcher...");

    loop {
        let mt5_path = {
            let copier = state.lock();
            copier.mt5_data_path.clone()
        };

        if let Some(path) = mt5_path {
            let queue_path = format!("{}\\MQL5\\Files\\CopierQueue", path);
            
            if Path::new(&queue_path).exists() {
                log::info!("Watching queue folder: {}", queue_path);
                
                if let Err(e) = watch_folder(&queue_path, state.clone()) {
                    log::error!("File watcher error: {}", e);
                    let mut copier = state.lock();
                    copier.last_error = Some(format!("Watcher error: {}", e));
                }
            } else {
                log::warn!("Queue folder does not exist: {}", queue_path);
            }
        }

        // Wait before retrying
        std::thread::sleep(Duration::from_secs(5));
    }
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

    // Process new files as they arrive
    for event in rx {
        if let notify::EventKind::Create(_) = event.kind {
            for file_path in event.paths {
                if file_path.extension().map(|e| e == "json").unwrap_or(false) {
                    // Wait for file to be fully written before processing
                    std::thread::sleep(Duration::from_millis(FILE_STABILITY_DELAY_MS));
                    
                    // Verify file stability (size not changing)
                    if is_file_stable(&file_path) {
                        process_event_file(&file_path, state.clone());
                    } else {
                        log::warn!("File not stable, skipping: {:?}", file_path);
                    }
                }
            }
        }
    }

    Ok(())
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
                log::warn!(
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
    log::info!("Processing event file: {:?}", path);

    // Read the file with retry logic
    let content = match read_file_with_retry(path) {
        Ok(c) => c,
        Err(e) => {
            log::error!("Failed to read event file after retries: {}", e);
            return;
        }
    };

    // Parse the trade event
    let event: TradeEvent = match serde_json::from_str(&content) {
        Ok(e) => e,
        Err(e) => {
            log::error!("Failed to parse event file: {}", e);
            // Still delete malformed files to prevent infinite loops
            if let Err(del_err) = std::fs::remove_file(path) {
                log::error!("Failed to delete malformed file: {}", del_err);
            }
            return;
        }
    };

    // Generate and check idempotency key
    let idempotency_key = idempotency::generate_idempotency_key(
        &event.event_type,
        event.ticket,
        &event.symbol,
        &event.timestamp,
    );
    
    if idempotency::is_event_processed(&idempotency_key) {
        log::info!("Skipping duplicate event: {}", idempotency_key);
        // Delete the duplicate file
        if let Err(e) = std::fs::remove_file(path) {
            log::error!("Failed to delete duplicate file: {}", e);
        }
        return;
    }

    // Check if copier is running
    let (is_running, config) = {
        let copier = state.lock();
        (copier.is_running, copier.config.clone())
    };

    if !is_running {
        log::info!("Copier is not running, skipping event");
        return;
    }

    let config = match config {
        Some(c) => c,
        None => {
            log::warn!("No configuration loaded, skipping event");
            return;
        }
    };

    // Process the event for each receiver
    event_processor::process_event(&event, &config, state.clone());
    
    // Mark as processed after successful execution
    idempotency::mark_event_processed(&idempotency_key);

    // Delete the processed file
    if let Err(e) = std::fs::remove_file(path) {
        log::error!("Failed to delete processed file: {}", e);
    }
}
