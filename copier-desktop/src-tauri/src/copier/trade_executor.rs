//! Trade Executor (synchronous file-IPC path)
//!
//! Writes a command JSON file into the receiver MT5 terminal's command folder
//! and polls for the matching response JSON. Includes a small synchronous retry
//! with exponential backoff for transient broker/file errors.

use super::ReceiverConfig;
use std::fs;
use std::path::Path;
use std::time::Duration;
use tracing::{debug, error, info, warn};


/// Configuration for retry behavior
#[derive(Debug, Clone)]
pub struct RetryConfig {
    pub max_attempts: u32,
    pub base_delay_ms: u64,
    pub max_delay_ms: u64,
    pub exponential_base: f64,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_attempts: 3,
            base_delay_ms: 500,
            max_delay_ms: 5000,
            exponential_base: 2.0,
        }
    }
}

/// Trade command to be executed
#[derive(Debug, Clone, serde::Serialize)]
pub struct TradeCommand {
    pub action: String,
    pub symbol: String,
    pub direction: String,
    pub lots: f64,
    /// Desktop-calculated lot size (EA should use this instead of calculating)
    /// Per requirements: "Risk logic must live in desktop app, NOT EA"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calculated_lots: Option<f64>,
    pub sl: Option<f64>,
    pub tp: Option<f64>,
    pub max_slippage_pips: f64,
    pub timestamp: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub master_position_id: Option<i64>,
}

/// Response from MT5 EA after trade execution
#[derive(Debug, Clone, serde::Deserialize)]
pub struct TradeResponse {
    pub success: bool,
    pub executed_price: f64,
    pub slippage_pips: f64,
    pub error: Option<String>,
    #[allow(dead_code)]
    pub timestamp: i64,
    #[serde(default)]
    pub receiver_position_id: Option<i64>,
}

/// Result of trade execution
#[derive(Debug, Clone)]
pub struct ExecutionResult {
    pub success: bool,
    pub executed_price: f64,
    pub slippage_pips: f64,
    pub receiver_position_id: Option<i64>,
    pub attempts: u32,
    pub error: Option<String>,
}

/// Execute a trade on the receiver terminal via file-based communication
/// Uses synchronous file operations to avoid runtime-within-runtime issues
pub fn execute_trade(
    event_type: &str,
    symbol: &str,
    direction: &str,
    lots: f64,
    sl: Option<f64>,
    tp: Option<f64>,
    receiver: &ReceiverConfig,
) -> Result<(f64, f64), TradeError> {
    // Use fully synchronous implementation to avoid block_on deadlock risk
    execute_trade_sync(event_type, symbol, direction, lots, sl, tp, receiver, None, &RetryConfig::default())
}

/// Synchronous trade execution with retry mechanism
/// Uses std::fs for all file operations - no async runtime required
fn execute_trade_sync(
    event_type: &str,
    symbol: &str,
    direction: &str,
    lots: f64,
    sl: Option<f64>,
    tp: Option<f64>,
    receiver: &ReceiverConfig,
    master_position_id: Option<i64>,
    retry_config: &RetryConfig,
) -> Result<(f64, f64), TradeError> {
    info!(
        "Executing {} {} {} {} lots on {} (sync)",
        event_type, direction, symbol, lots, receiver.account_number
    );

    let command = TradeCommand {
        action: event_type.to_string(),
        symbol: symbol.to_string(),
        direction: direction.to_string(),
        lots,
        calculated_lots: Some(lots), // Desktop calculated - EA should use this
        sl,
        tp,
        max_slippage_pips: receiver.max_slippage_pips,
        timestamp: chrono::Utc::now().timestamp_millis(),
        master_position_id,
    };

    let mut last_error = None;

    for attempt in 0..retry_config.max_attempts {
        match execute_single_attempt_sync(&command, receiver) {
            Ok(response) => {
                if response.success {
                    info!(
                        "Trade executed successfully on attempt {}: {} @ {} (slippage: {} pips)",
                        attempt + 1, symbol, response.executed_price, response.slippage_pips
                    );
                    return Ok((response.executed_price, response.slippage_pips));
                } else {
                    let error_msg = response.error.clone().unwrap_or_else(|| "Unknown error".to_string());
                    warn!("Trade failed on attempt {}: {}", attempt + 1, error_msg);
                    
                    if !is_retryable_error(&error_msg) {
                        return Err(TradeError::ExecutionError(error_msg));
                    }
                    last_error = Some(error_msg);
                }
            }
            Err(e) => {
                warn!("Trade attempt {} failed with error: {}", attempt + 1, e);
                if !matches!(e, TradeError::Timeout | TradeError::FileReadError(_) | TradeError::FileWriteError(_)) {
                    return Err(e);
                }
                last_error = Some(e.to_string());
            }
        }

        // Calculate delay with exponential backoff
        if attempt + 1 < retry_config.max_attempts {
            let delay_ms = calculate_backoff_delay(attempt, retry_config);
            info!("Retrying in {}ms...", delay_ms);
            std::thread::sleep(Duration::from_millis(delay_ms));
        }
    }

    error!("Trade execution failed after {} attempts: {:?}", retry_config.max_attempts, last_error);
    Err(TradeError::ExecutionError(last_error.unwrap_or_else(|| "Max retries exceeded".to_string())))
}

/// Execute a single trade attempt using synchronous file I/O
fn execute_single_attempt_sync(
    command: &TradeCommand,
    receiver: &ReceiverConfig,
) -> Result<TradeResponse, TradeError> {
    let command_json = serde_json::to_string_pretty(command)
        .map_err(|e| TradeError::SerializationError(e.to_string()))?;

    let command_folder = get_receiver_command_folder(&receiver.terminal_id)?;
    let command_file = format!("{}\\cmd_{}.json", command_folder, command.timestamp);
    let temp_file = format!("{}.tmp", command_file);

    // Atomic write: temp file then rename
    fs::write(&temp_file, &command_json)
        .map_err(|e| TradeError::FileWriteError(e.to_string()))?;
    fs::rename(&temp_file, &command_file)
        .map_err(|e| TradeError::FileWriteError(e.to_string()))?;

    info!("Command written to: {}", command_file);

    // Wait for response synchronously
    wait_for_response_sync(&command_folder, command.timestamp)
}

/// Poll the receiver's command folder for `resp_<timestamp>.json`.
///
/// The receiver EA writes a single response file per command via an atomic
/// `.tmp` -> rename, so we only need to wait for the final `.json` to appear,
/// read it, then remove it so the folder does not accumulate stale responses.
///
/// Timeout is fixed at ~30s with a 50ms poll cadence — far below MT5's
/// typical broker round-trip and matches the EA's `OnTimer(1s)` cycle.
fn wait_for_response_sync(
    command_folder: &str,
    timestamp: i64,
) -> Result<TradeResponse, TradeError> {
    let response_path = format!("{}\\resp_{}.json", command_folder, timestamp);
    let deadline = std::time::Instant::now() + Duration::from_secs(30);
    let poll = Duration::from_millis(50);

    loop {
        if Path::new(&response_path).exists() {
            // Brief settle in case rename is observed before contents flush.
            std::thread::sleep(Duration::from_millis(10));

            let content = match fs::read_to_string(&response_path) {
                Ok(c) if !c.trim().is_empty() => c,
                Ok(_) => {
                    // Empty/partial file — let the next poll re-read.
                    if std::time::Instant::now() >= deadline {
                        return Err(TradeError::Timeout);
                    }
                    std::thread::sleep(poll);
                    continue;
                }
                Err(e) => {
                    debug!("Transient response read error ({}), retrying", e);
                    if std::time::Instant::now() >= deadline {
                        return Err(TradeError::FileReadError(e.to_string()));
                    }
                    std::thread::sleep(poll);
                    continue;
                }
            };

            // Best-effort cleanup; ignore errors so a locked file does not abort the trade.
            let _ = fs::remove_file(&response_path);

            let parsed: TradeResponse = serde_json::from_str(&content)
                .map_err(|e| TradeError::SerializationError(format!(
                    "Failed to parse response at {}: {}", response_path, e
                )))?;
            return Ok(parsed);
        }

        if std::time::Instant::now() >= deadline {
            warn!("Timed out waiting for response at {}", response_path);
            return Err(TradeError::Timeout);
        }
        std::thread::sleep(poll);
    }
}

/// Calculate exponential backoff delay
fn calculate_backoff_delay(attempt: u32, config: &RetryConfig) -> u64 {
    let delay = config.base_delay_ms as f64 * config.exponential_base.powi(attempt as i32);
    (delay as u64).min(config.max_delay_ms)
}

/// Check if an error is retryable
fn is_retryable_error(error: &str) -> bool {
    let retryable_patterns = [
        "timeout",
        "busy",
        "try again",
        "connection",
        "temporary",
        "requote",
        "off quotes",
        "market closed",
        "no prices",
        "trade context",
        "10004", // TRADE_RETCODE_REQUOTE
        "10006", // TRADE_RETCODE_REJECT
        "10008", // TRADE_RETCODE_PLACED (actually success but may need verification)
        "10021", // TRADE_RETCODE_NO_CHANGES
    ];
    
    let error_lower = error.to_lowercase();
    retryable_patterns.iter().any(|p| error_lower.contains(p))
}

fn get_receiver_command_folder(terminal_id: &str) -> Result<String, TradeError> {
    // Use bridge's terminal path detection for proper handling of portable installations
    let terminal_path = find_terminal_path(terminal_id)?;
    
    let path = format!(
        "{}\\MQL5\\Files\\CopierCommands",
        terminal_path
    );

    // Create folder if it doesn't exist
    if !Path::new(&path).exists() {
        fs::create_dir_all(&path)
            .map_err(|e| TradeError::FileWriteError(e.to_string()))?;
    }

    Ok(path)
}

/// Find terminal path - handles both standard and portable installations
fn find_terminal_path(terminal_id: &str) -> Result<String, TradeError> {
    // Check if it's a portable terminal
    if terminal_id.starts_with("portable_") {
        // Search for it in known locations
        let terminals = crate::mt5::bridge::find_mt5_terminals();
        for terminal in terminals {
            if terminal.terminal_id == terminal_id {
                return Ok(terminal.path);
            }
        }
        return Err(TradeError::ConfigError(format!("Portable terminal {} not found", terminal_id)));
    }

    // Standard AppData terminal
    let appdata = std::env::var("APPDATA")
        .map_err(|_| TradeError::ConfigError("APPDATA not found".to_string()))?;
    
    let terminal_path = format!(
        "{}\\MetaQuotes\\Terminal\\{}",
        appdata, terminal_id
    );
    
    if Path::new(&terminal_path).exists() {
        Ok(terminal_path)
    } else {
        Err(TradeError::ConfigError(format!("Terminal {} not found", terminal_id)))
    }
}

#[derive(Debug, thiserror::Error)]
pub enum TradeError {
    #[error("Serialization error: {0}")]
    SerializationError(String),
    #[error("File write error: {0}")]
    FileWriteError(String),
    #[error("File read error: {0}")]
    FileReadError(String),
    #[error("Configuration error: {0}")]
    ConfigError(String),
    #[error("Execution timeout")]
    Timeout,
    #[error("Execution error: {0}")]
    ExecutionError(String),
}


#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_backoff_delay() {
        let config = RetryConfig::default();
        
        // First attempt: base delay
        assert_eq!(calculate_backoff_delay(0, &config), 500);
        
        // Second attempt: 500 * 2 = 1000
        assert_eq!(calculate_backoff_delay(1, &config), 1000);
        
        // Third attempt: 500 * 4 = 2000
        assert_eq!(calculate_backoff_delay(2, &config), 2000);
    }
    
    #[test]
    fn test_retryable_error_detection() {
        assert!(is_retryable_error("Request timeout"));
        assert!(is_retryable_error("Trade context busy"));
        assert!(is_retryable_error("Error 10004: Requote"));
        assert!(!is_retryable_error("Invalid volume"));
        assert!(!is_retryable_error("Invalid symbol"));
    }
}
