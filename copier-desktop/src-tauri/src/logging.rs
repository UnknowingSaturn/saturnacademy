//! Logging configuration for Saturn Trade Copier
//!
//! Provides structured file-based logging using the tracing ecosystem.
//! Logs are written to the app's data directory with daily rotation.

use std::path::PathBuf;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::{
    fmt,
    layer::SubscriberExt,
    util::SubscriberInitExt,
    EnvFilter,
};

/// Get the log directory path
pub fn get_log_dir() -> PathBuf {
    if let Some(proj_dirs) = directories::ProjectDirs::from("com", "saturn", "trade-copier") {
        let log_dir = proj_dirs.data_dir().join("logs");
        // Create the directory if it doesn't exist
        let _ = std::fs::create_dir_all(&log_dir);
        log_dir
    } else {
        // Fallback to current directory
        PathBuf::from("logs")
    }
}

/// Initialize the logging system with file and console output
pub fn init_logging() -> tracing_appender::non_blocking::WorkerGuard {
    let log_dir = get_log_dir();
    
    // Create a rolling file appender (daily rotation)
    let file_appender = RollingFileAppender::new(
        Rotation::DAILY,
        &log_dir,
        "saturn-copier.log",
    );
    
    // Make file appender non-blocking
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
    
    // Create filter from environment or use default
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,saturn_trade_copier=debug"));
    
    // Set up subscriber with both console and file output
    tracing_subscriber::registry()
        .with(filter)
        .with(
            fmt::layer()
                .with_target(true)
                .with_thread_ids(false)
                .with_file(true)
                .with_line_number(true)
                .with_ansi(false)
                .with_writer(non_blocking)
        )
        .with(
            fmt::layer()
                .with_target(false)
                .with_thread_ids(false)
                .compact()
                .with_ansi(true)
        )
        .init();
    
    tracing::info!("Logging initialized to: {:?}", log_dir);
    
    guard
}

/// Log a trade execution event
#[macro_export]
macro_rules! log_trade {
    ($event_type:expr, $symbol:expr, $direction:expr, $lots:expr, $receiver:expr) => {
        tracing::info!(
            event_type = $event_type,
            symbol = $symbol,
            direction = $direction,
            lots = $lots,
            receiver = $receiver,
            "Trade execution"
        );
    };
}

/// Log an error with context
#[macro_export]
macro_rules! log_error {
    ($context:expr, $error:expr) => {
        tracing::error!(
            context = $context,
            error = %$error,
            "Error occurred"
        );
    };
}
