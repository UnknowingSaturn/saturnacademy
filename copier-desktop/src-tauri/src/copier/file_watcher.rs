use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use super::{event_processor, CopierState, TradeEvent};

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
            for path in event.paths {
                if path.extension().map(|e| e == "json").unwrap_or(false) {
                    process_event_file(&path, state.clone());
                }
            }
        }
    }

    Ok(())
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

fn process_event_file(path: &Path, state: Arc<Mutex<CopierState>>) {
    log::info!("Processing event file: {:?}", path);

    // Read the file
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) => {
            log::error!("Failed to read event file: {}", e);
            return;
        }
    };

    // Parse the trade event
    let event: TradeEvent = match serde_json::from_str(&content) {
        Ok(e) => e,
        Err(e) => {
            log::error!("Failed to parse event file: {}", e);
            return;
        }
    };

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

    // Delete the processed file
    if let Err(e) = std::fs::remove_file(path) {
        log::error!("Failed to delete processed file: {}", e);
    }
}
