//! Idempotency tracking to prevent duplicate trade executions
//! 
//! Uses a file-based cache with FIFO ordering to persist processed event keys across restarts

use parking_lot::Mutex;
use std::collections::{HashSet, VecDeque};
use std::fs;
use std::path::PathBuf;
use std::sync::LazyLock;

/// Maximum number of keys to keep in memory
const MAX_KEYS_IN_MEMORY: usize = 10_000;

/// File to persist processed keys
const IDEMPOTENCY_FILE: &str = "processed_events.txt";

/// FIFO-ordered idempotency cache with O(1) lookups
struct IdempotencyCache {
    /// FIFO queue for ordering (front = oldest, back = newest)
    keys_order: VecDeque<String>,
    /// HashSet for O(1) lookups
    keys_set: HashSet<String>,
}

impl IdempotencyCache {
    fn new() -> Self {
        Self {
            keys_order: VecDeque::new(),
            keys_set: HashSet::new(),
        }
    }
    
    fn from_keys(keys: Vec<String>) -> Self {
        let keys_order: VecDeque<String> = keys.iter().cloned().collect();
        let keys_set: HashSet<String> = keys.into_iter().collect();
        Self { keys_order, keys_set }
    }
    
    fn contains(&self, key: &str) -> bool {
        self.keys_set.contains(key)
    }
    
    fn insert(&mut self, key: String) {
        // Prune oldest keys if at capacity (FIFO order guaranteed)
        while self.keys_set.len() >= MAX_KEYS_IN_MEMORY {
            if let Some(oldest) = self.keys_order.pop_front() {
                self.keys_set.remove(&oldest);
            } else {
                break;
            }
        }
        
        // Insert new key
        if self.keys_set.insert(key.clone()) {
            self.keys_order.push_back(key);
        }
    }
    
    fn clear(&mut self) {
        self.keys_order.clear();
        self.keys_set.clear();
    }
    
    fn to_vec(&self) -> Vec<String> {
        self.keys_order.iter().cloned().collect()
    }
    
    fn len(&self) -> usize {
        self.keys_set.len()
    }
}

/// Global idempotency cache
static PROCESSED_KEYS: LazyLock<Mutex<IdempotencyCache>> = LazyLock::new(|| {
    let keys = load_processed_keys().unwrap_or_default();
    Mutex::new(IdempotencyCache::from_keys(keys))
});

/// Get the path to the idempotency file
fn get_idempotency_file_path() -> Option<PathBuf> {
    let appdata = std::env::var("APPDATA").ok()?;
    Some(PathBuf::from(appdata)
        .join("SaturnTradeCopier")
        .join(IDEMPOTENCY_FILE))
}

/// Load previously processed keys from disk (maintains file order = insertion order)
fn load_processed_keys() -> Result<Vec<String>, String> {
    let path = get_idempotency_file_path()
        .ok_or_else(|| "Failed to get idempotency file path".to_string())?;
    
    if !path.exists() {
        return Ok(Vec::new());
    }
    
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read idempotency file: {}", e))?;
    
    let keys: Vec<String> = content
        .lines()
        .filter(|line| !line.is_empty())
        .map(|s| s.to_string())
        .collect();
    
    // Only keep the most recent keys to prevent unbounded growth
    if keys.len() > MAX_KEYS_IN_MEMORY {
        // Take the last MAX_KEYS_IN_MEMORY keys (most recent)
        let recent_keys: Vec<String> = keys
            .into_iter()
            .skip(keys.len().saturating_sub(MAX_KEYS_IN_MEMORY))
            .collect();
        return Ok(recent_keys);
    }
    
    Ok(keys)
}

/// Save processed keys to disk (maintains FIFO order)
fn save_processed_keys(cache: &IdempotencyCache) -> Result<(), String> {
    let path = get_idempotency_file_path()
        .ok_or_else(|| "Failed to get idempotency file path".to_string())?;
    
    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create idempotency directory: {}", e))?;
    }
    
    // Join keys in order (oldest first, newest last)
    let content = cache.to_vec().join("\n");
    
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
    let cache = PROCESSED_KEYS.lock();
    cache.contains(idempotency_key)
}

/// Mark an event as processed
pub fn mark_event_processed(idempotency_key: &str) {
    let mut cache = PROCESSED_KEYS.lock();
    
    cache.insert(idempotency_key.to_string());
    
    // Persist to disk (best effort)
    if let Err(e) = save_processed_keys(&cache) {
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
    let mut cache = PROCESSED_KEYS.lock();
    cache.clear();
    if let Err(e) = save_processed_keys(&cache) {
        tracing::warn!("Failed to clear idempotency keys: {}", e);
    }
}

/// Get count of processed keys (for diagnostics)
pub fn get_processed_keys_count() -> usize {
    let cache = PROCESSED_KEYS.lock();
    cache.len()
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
    
    #[test]
    fn test_idempotency_cache_fifo() {
        let mut cache = IdempotencyCache::new();
        
        // Insert keys
        cache.insert("key1".to_string());
        cache.insert("key2".to_string());
        cache.insert("key3".to_string());
        
        // Verify order
        let keys = cache.to_vec();
        assert_eq!(keys, vec!["key1", "key2", "key3"]);
        
        // Verify lookup
        assert!(cache.contains("key1"));
        assert!(cache.contains("key2"));
        assert!(cache.contains("key3"));
        assert!(!cache.contains("key4"));
    }
}
