//! Trade Executor with async execution and retry mechanism
//! 
//! Implements robust trade execution with:
//! - Async/non-blocking file operations
//! - Configurable retry with exponential backoff
//! - Execution queue to prevent blocking the file watcher

use super::ReceiverConfig;
use std::fs;
use std::path::Path;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time::sleep;

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
/// This is the sync wrapper for backward compatibility
pub fn execute_trade(
    event_type: &str,
    symbol: &str,
    direction: &str,
    lots: f64,
    sl: Option<f64>,
    tp: Option<f64>,
    receiver: &ReceiverConfig,
) -> Result<(f64, f64), TradeError> {
    // Use tokio runtime to run async version
    let rt = tokio::runtime::Handle::try_current()
        .unwrap_or_else(|_| {
            tokio::runtime::Runtime::new().unwrap().handle().clone()
        });
    
    let result = rt.block_on(execute_trade_async(
        event_type,
        symbol,
        direction,
        lots,
        sl,
        tp,
        receiver,
        None,
        &RetryConfig::default(),
    ));
    
    match result {
        Ok(exec_result) => {
            if exec_result.success {
                Ok((exec_result.executed_price, exec_result.slippage_pips))
            } else {
                Err(TradeError::ExecutionError(
                    exec_result.error.unwrap_or_else(|| "Unknown error".to_string())
                ))
            }
        }
        Err(e) => Err(e),
    }
}

/// Execute a trade asynchronously with retry mechanism
pub async fn execute_trade_async(
    event_type: &str,
    symbol: &str,
    direction: &str,
    lots: f64,
    sl: Option<f64>,
    tp: Option<f64>,
    receiver: &ReceiverConfig,
    master_position_id: Option<i64>,
    retry_config: &RetryConfig,
) -> Result<ExecutionResult, TradeError> {
    log::info!(
        "Executing {} {} {} {} lots on {} (async with retry)",
        event_type,
        direction,
        symbol,
        lots,
        receiver.account_number
    );

    let command = TradeCommand {
        action: event_type.to_string(),
        symbol: symbol.to_string(),
        direction: direction.to_string(),
        lots,
        sl,
        tp,
        max_slippage_pips: receiver.max_slippage_pips,
        timestamp: chrono::Utc::now().timestamp_millis(),
        master_position_id,
    };

    let mut last_error = None;
    let mut attempts = 0;

    for attempt in 0..retry_config.max_attempts {
        attempts = attempt + 1;
        
        match execute_single_attempt(&command, receiver).await {
            Ok(response) => {
                if response.success {
                    log::info!(
                        "Trade executed successfully on attempt {}: {} @ {} (slippage: {} pips)",
                        attempts,
                        symbol,
                        response.executed_price,
                        response.slippage_pips
                    );
                    return Ok(ExecutionResult {
                        success: true,
                        executed_price: response.executed_price,
                        slippage_pips: response.slippage_pips,
                        receiver_position_id: response.receiver_position_id,
                        attempts,
                        error: None,
                    });
                } else {
                    let error_msg = response.error.clone().unwrap_or_else(|| "Unknown error".to_string());
                    log::warn!(
                        "Trade failed on attempt {}: {}",
                        attempts,
                        error_msg
                    );
                    
                    // Check if error is retryable
                    if !is_retryable_error(&error_msg) {
                        return Ok(ExecutionResult {
                            success: false,
                            executed_price: 0.0,
                            slippage_pips: 0.0,
                            receiver_position_id: None,
                            attempts,
                            error: Some(error_msg),
                        });
                    }
                    
                    last_error = Some(error_msg);
                }
            }
            Err(e) => {
                log::warn!("Trade attempt {} failed with error: {}", attempts, e);
                
                // Timeout and file errors are retryable
                if !matches!(e, TradeError::Timeout | TradeError::FileReadError(_) | TradeError::FileWriteError(_)) {
                    return Err(e);
                }
                
                last_error = Some(e.to_string());
            }
        }

        // Calculate delay with exponential backoff
        if attempt + 1 < retry_config.max_attempts {
            let delay_ms = calculate_backoff_delay(attempt, retry_config);
            log::info!("Retrying in {}ms...", delay_ms);
            sleep(Duration::from_millis(delay_ms)).await;
        }
    }

    // All retries exhausted
    log::error!(
        "Trade execution failed after {} attempts: {:?}",
        attempts,
        last_error
    );
    
    Ok(ExecutionResult {
        success: false,
        executed_price: 0.0,
        slippage_pips: 0.0,
        receiver_position_id: None,
        attempts,
        error: last_error,
    })
}

/// Execute a single trade attempt
async fn execute_single_attempt(
    command: &TradeCommand,
    receiver: &ReceiverConfig,
) -> Result<TradeResponse, TradeError> {
    let command_json = serde_json::to_string_pretty(command)
        .map_err(|e| TradeError::SerializationError(e.to_string()))?;

    // Write to receiver's command folder
    let command_folder = get_receiver_command_folder(&receiver.terminal_id)?;
    let command_file = format!(
        "{}\\cmd_{}.json",
        command_folder,
        command.timestamp
    );

    // Write command file asynchronously
    tokio::fs::write(&command_file, &command_json)
        .await
        .map_err(|e| TradeError::FileWriteError(e.to_string()))?;

    log::info!("Command written to: {}", command_file);

    // Wait for response with async polling
    let response = wait_for_response_async(&command_folder, command.timestamp).await?;

    Ok(response)
}

/// Wait for response asynchronously with proper timeout handling
async fn wait_for_response_async(folder: &str, command_timestamp: i64) -> Result<TradeResponse, TradeError> {
    let response_file = format!("{}\\resp_{}.json", folder, command_timestamp);
    let timeout = Duration::from_secs(15); // Increased timeout for async
    let poll_interval = Duration::from_millis(50);
    
    let start = std::time::Instant::now();

    loop {
        if start.elapsed() > timeout {
            // Clean up command file on timeout
            let command_file = format!("{}\\cmd_{}.json", folder, command_timestamp);
            let _ = tokio::fs::remove_file(&command_file).await;
            return Err(TradeError::Timeout);
        }

        if Path::new(&response_file).exists() {
            // Wait a bit for file to be fully written
            sleep(Duration::from_millis(20)).await;
            
            // Read response file
            let content = tokio::fs::read_to_string(&response_file)
                .await
                .map_err(|e| TradeError::FileReadError(e.to_string()))?;

            // Delete response file
            let _ = tokio::fs::remove_file(&response_file).await;

            let response: TradeResponse = serde_json::from_str(&content)
                .map_err(|e| TradeError::SerializationError(e.to_string()))?;

            return Ok(response);
        }

        sleep(poll_interval).await;
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
    // Standard MT5 data path location
    let appdata = std::env::var("APPDATA")
        .map_err(|_| TradeError::ConfigError("APPDATA not found".to_string()))?;
    
    let path = format!(
        "{}\\MetaQuotes\\Terminal\\{}\\MQL5\\Files\\CopierCommands",
        appdata, terminal_id
    );

    // Create folder if it doesn't exist
    if !Path::new(&path).exists() {
        fs::create_dir_all(&path)
            .map_err(|e| TradeError::FileWriteError(e.to_string()))?;
    }

    Ok(path)
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
    #[error("Queue full")]
    QueueFull,
}

// ============================================================================
// Execution Queue System (prepared for future async integration)
// ============================================================================

/// Execution request to be queued
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct ExecutionRequest {
    pub id: String,
    pub event_type: String,
    pub symbol: String,
    pub direction: String,
    pub lots: f64,
    pub sl: Option<f64>,
    pub tp: Option<f64>,
    pub receiver: ReceiverConfig,
    pub master_position_id: Option<i64>,
    pub retry_config: RetryConfig,
}

/// Execution queue for non-blocking trade processing
#[allow(dead_code)]
pub struct ExecutionQueue {
    sender: mpsc::Sender<ExecutionRequest>,
}

impl ExecutionQueue {
    /// Create a new execution queue with the given capacity
    pub fn new(capacity: usize) -> (Self, mpsc::Receiver<ExecutionRequest>) {
        let (sender, receiver) = mpsc::channel(capacity);
        (Self { sender }, receiver)
    }
    
    /// Submit an execution request to the queue
    pub async fn submit(&self, request: ExecutionRequest) -> Result<(), TradeError> {
        self.sender.send(request).await
            .map_err(|_| TradeError::QueueFull)
    }
    
    /// Try to submit without waiting (returns immediately if queue is full)
    pub fn try_submit(&self, request: ExecutionRequest) -> Result<(), TradeError> {
        self.sender.try_send(request)
            .map_err(|_| TradeError::QueueFull)
    }
}

/// Start the execution queue processor
#[allow(dead_code)]
pub async fn start_queue_processor(
    mut receiver: mpsc::Receiver<ExecutionRequest>,
    result_callback: impl Fn(String, ExecutionResult) + Send + 'static,
) {
    log::info!("Execution queue processor started");
    
    while let Some(request) = receiver.recv().await {
        log::debug!("Processing queued execution: {}", request.id);
        
        let result = execute_trade_async(
            &request.event_type,
            &request.symbol,
            &request.direction,
            request.lots,
            request.sl,
            request.tp,
            &request.receiver,
            request.master_position_id,
            &request.retry_config,
        ).await;
        
        match result {
            Ok(exec_result) => {
                result_callback(request.id, exec_result);
            }
            Err(e) => {
                log::error!("Execution queue error for {}: {}", request.id, e);
                result_callback(request.id, ExecutionResult {
                    success: false,
                    executed_price: 0.0,
                    slippage_pips: 0.0,
                    receiver_position_id: None,
                    attempts: 0,
                    error: Some(e.to_string()),
                });
            }
        }
    }
    
    log::info!("Execution queue processor stopped");
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
