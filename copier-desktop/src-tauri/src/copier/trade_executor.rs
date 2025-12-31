use super::ReceiverConfig;
use std::fs;
use std::path::Path;

/// Execute a trade on the receiver terminal via file-based communication
pub fn execute_trade(
    event_type: &str,
    symbol: &str,
    direction: &str,
    lots: f64,
    sl: Option<f64>,
    tp: Option<f64>,
    receiver: &ReceiverConfig,
) -> Result<(f64, f64), TradeError> {
    log::info!(
        "Executing {} {} {} {} lots on {}",
        event_type,
        direction,
        symbol,
        lots,
        receiver.account_number
    );

    // Create command file for MT5 EA to execute
    let command = TradeCommand {
        action: event_type.to_string(),
        symbol: symbol.to_string(),
        direction: direction.to_string(),
        lots,
        sl,
        tp,
        max_slippage_pips: receiver.max_slippage_pips,
        timestamp: chrono::Utc::now().timestamp_millis(),
    };

    let command_json = serde_json::to_string_pretty(&command)
        .map_err(|e| TradeError::SerializationError(e.to_string()))?;

    // Write to receiver's command folder
    // The MT5 EA will poll this folder and execute commands
    let command_folder = get_receiver_command_folder(&receiver.terminal_id)?;
    let command_file = format!(
        "{}\\cmd_{}.json",
        command_folder,
        chrono::Utc::now().timestamp_millis()
    );

    fs::write(&command_file, &command_json)
        .map_err(|e| TradeError::FileWriteError(e.to_string()))?;

    log::info!("Command written to: {}", command_file);

    // Wait for response (with timeout)
    let response = wait_for_response(&command_folder, command.timestamp)?;

    Ok((response.executed_price, response.slippage_pips))
}

#[derive(serde::Serialize)]
struct TradeCommand {
    action: String,
    symbol: String,
    direction: String,
    lots: f64,
    sl: Option<f64>,
    tp: Option<f64>,
    max_slippage_pips: f64,
    timestamp: i64,
}

#[derive(serde::Deserialize)]
struct TradeResponse {
    success: bool,
    executed_price: f64,
    slippage_pips: f64,
    error: Option<String>,
    timestamp: i64,
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

fn wait_for_response(folder: &str, command_timestamp: i64) -> Result<TradeResponse, TradeError> {
    let response_file = format!("{}\\resp_{}.json", folder, command_timestamp);
    let timeout = std::time::Duration::from_secs(10);
    let start = std::time::Instant::now();

    loop {
        if start.elapsed() > timeout {
            return Err(TradeError::Timeout);
        }

        if Path::new(&response_file).exists() {
            let content = fs::read_to_string(&response_file)
                .map_err(|e| TradeError::FileReadError(e.to_string()))?;

            // Delete response file
            let _ = fs::remove_file(&response_file);

            let response: TradeResponse = serde_json::from_str(&content)
                .map_err(|e| TradeError::SerializationError(e.to_string()))?;

            if response.success {
                return Ok(response);
            } else {
                return Err(TradeError::ExecutionError(
                    response.error.unwrap_or_else(|| "Unknown error".to_string()),
                ));
            }
        }

        std::thread::sleep(std::time::Duration::from_millis(50));
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
