//! Idempotency tracking to prevent duplicate trade executions
//! 
//! Uses a file-based cache to persist processed event keys across restarts

use parking_lot::Mutex;
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::LazyLock;

/// Maximum number of keys to keep in memory
const MAX_KEYS_IN_MEMORY: usize = 10_000;

/// File to persist processed keys
const IDEMPOTENCY_FILE: &str = "processed_events.txt";

/// Global set of processed idempotency keys
static PROCESSED_KEYS: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| {
    let keys = load_processed_keys().unwrap_or_default();
    Mutex::new(keys)
});

/// Get the path to the idempotency file
fn get_idempotency_file_path() -> Option<PathBuf> {
    let appdata = std::env::var("APPDATA").ok()?;
    Some(PathBuf::from(appdata)
        .join("SaturnTradeCopier")
        .join(IDEMPOTENCY_FILE))
}

/// Load previously processed keys from disk
fn load_processed_keys() -> Result<HashSet<String>, String> {
    let path = get_idempotency_file_path()
        .ok_or_else(|| "Failed to get idempotency file path".to_string())?;
    
    if !path.exists() {
        return Ok(HashSet::new());
    }
    
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read idempotency file: {}", e))?;
    
    let keys: HashSet<String> = content
        .lines()
        .filter(|line| !line.is_empty())
        .map(|s| s.to_string())
        .collect();
    
    // Only keep the most recent keys to prevent unbounded growth
    if keys.len() > MAX_KEYS_IN_MEMORY {
        let keys_vec: Vec<String> = keys.into_iter().collect();
        let recent_keys: HashSet<String> = keys_vec
            .into_iter()
            .rev()
            .take(MAX_KEYS_IN_MEMORY)
            .collect();
        return Ok(recent_keys);
    }
    
    Ok(keys)
}

/// Save processed keys to disk
fn save_processed_keys(keys: &HashSet<String>) -> Result<(), String> {
    let path = get_idempotency_file_path()
        .ok_or_else(|| "Failed to get idempotency file path".to_string())?;
    
    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create idempotency directory: {}", e))?;
    }
    
    let content = keys.iter().cloned().collect::<Vec<_>>().join("\n");
    
    // Write atomically via temp file
    let temp_path = path.with_extension("tmp");
    fs::write(&temp_path, &content)
        .map_err(|e| format!("Failed to write idempotency file: {}", e))?;
    
    fs::rename(&temp_path, &path)
        .map_err(|e| format!("Failed to finalize idempotency file: {}", e))?;
    
    Ok(())
}

/// Check if an event has already been processed
pub fn is_event_processed(idempotency_key: &str) -> bool {
    let keys = PROCESSED_KEYS.lock();
    keys.contains(idempotency_key)
}

/// Mark an event as processed
pub fn mark_event_processed(idempotency_key: &str) {
    let mut keys = PROCESSED_KEYS.lock();
    
    // Prune old keys if necessary
    if keys.len() >= MAX_KEYS_IN_MEMORY {
        // Remove roughly half of the oldest keys
        let to_remove: Vec<String> = keys.iter()
            .take(MAX_KEYS_IN_MEMORY / 2)
            .cloned()
            .collect();
        
        for key in to_remove {
            keys.remove(&key);
        }
    }
    
    keys.insert(idempotency_key.to_string());
    
    // Persist to disk (best effort)
    if let Err(e) = save_processed_keys(&keys) {
        tracing::warn!("Failed to persist idempotency keys: {}", e);
    }
}

/// Generate an idempotency key from event data
/// Now includes deal_id for uniqueness across partial closes and reopens
pub fn generate_idempotency_key(
    event_type: &str,
    ticket: i64,
    deal_id: i64,
    symbol: &str,
    timestamp: &str,
) -> String {
    // Include deal_id to differentiate between different deals on the same position
    // This prevents issues where:
    // 1. A partial close creates a new deal on the same position
    // 2. A position is closed and a new one opened with same ticket
    format!("{}:{}:{}:{}:{}", event_type, ticket, deal_id, symbol, timestamp)
}

/// Generate idempotency key for modify events (no deal_id)
pub fn generate_modify_idempotency_key(
    position_id: i64,
    symbol: &str,
    timestamp: &str,
) -> String {
    format!("modify:{}:{}:{}", position_id, symbol, timestamp)
}

/// Clear all processed keys (for testing or reset)
pub fn clear_processed_keys() {
    let mut keys = PROCESSED_KEYS.lock();
    keys.clear();
    if let Err(e) = save_processed_keys(&keys) {
        tracing::warn!("Failed to clear idempotency keys: {}", e);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_idempotency_key_generation() {
        let key = generate_idempotency_key("open", 12345, 67890, "EURUSD", "2024-01-15T10:30:00Z");
        assert_eq!(key, "open:12345:67890:EURUSD:2024-01-15T10:30:00Z");
    }
    
    #[test]
    fn test_idempotency_key_with_deal_id_uniqueness() {
        // Same position, different deals should have different keys
        let key1 = generate_idempotency_key("close", 12345, 100, "EURUSD", "2024-01-15T10:30:00Z");
        let key2 = generate_idempotency_key("close", 12345, 101, "EURUSD", "2024-01-15T10:31:00Z");
        assert_ne!(key1, key2);
    }
    
    #[test]
    fn test_modify_key_generation() {
        let key = generate_modify_idempotency_key(12345, "EURUSD", "2024-01-15T10:30:00Z");
        assert_eq!(key, "modify:12345:EURUSD:2024-01-15T10:30:00Z");
    }
}
