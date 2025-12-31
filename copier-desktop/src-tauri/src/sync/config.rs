use crate::copier::CopierConfig;
use std::path::PathBuf;

const API_BASE_URL: &str = "https://soosdjmnpcyuqppdjsse.supabase.co/functions/v1";
const CONFIG_FILE_NAME: &str = "saturn_copier_config.json";

/// Fetch configuration from the cloud
pub async fn fetch_config(api_key: &str) -> Result<CopierConfig, ConfigError> {
    log::info!("Fetching configuration from cloud...");

    let client = reqwest::Client::new();
    let response = client
        .get(format!("{}/copier-config", API_BASE_URL))
        .header("x-api-key", api_key)
        .send()
        .await
        .map_err(|e| ConfigError::NetworkError(e.to_string()))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(ConfigError::ApiError(format!(
            "HTTP {}: {}",
            status, body
        )));
    }

    let config: CopierConfig = response
        .json()
        .await
        .map_err(|e| ConfigError::ParseError(e.to_string()))?;

    // Cache the config locally
    if let Err(e) = cache_config(&config) {
        log::warn!("Failed to cache config: {}", e);
    }

    log::info!(
        "Configuration loaded: version {}, {} receivers",
        config.version,
        config.receivers.len()
    );

    Ok(config)
}

/// Load cached configuration for offline use
pub fn load_cached_config() -> Option<CopierConfig> {
    let config_path = get_config_path()?;
    
    if !config_path.exists() {
        return None;
    }

    let content = std::fs::read_to_string(&config_path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Cache configuration locally
fn cache_config(config: &CopierConfig) -> Result<(), ConfigError> {
    let config_path = get_config_path()
        .ok_or_else(|| ConfigError::StorageError("Could not determine config path".to_string()))?;

    let content = serde_json::to_string_pretty(config)
        .map_err(|e| ConfigError::ParseError(e.to_string()))?;

    std::fs::write(&config_path, content)
        .map_err(|e| ConfigError::StorageError(e.to_string()))?;

    Ok(())
}

/// Save API key to local storage
pub fn save_api_key(api_key: &str) -> Result<(), ConfigError> {
    let key_path = get_api_key_path()
        .ok_or_else(|| ConfigError::StorageError("Could not determine key path".to_string()))?;

    // Create parent directory if needed
    if let Some(parent) = key_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| ConfigError::StorageError(e.to_string()))?;
    }

    std::fs::write(&key_path, api_key)
        .map_err(|e| ConfigError::StorageError(e.to_string()))?;

    Ok(())
}

/// Load API key from local storage
pub fn load_api_key() -> Result<String, ConfigError> {
    let key_path = get_api_key_path()
        .ok_or_else(|| ConfigError::StorageError("Could not determine key path".to_string()))?;

    std::fs::read_to_string(&key_path)
        .map_err(|e| ConfigError::StorageError(e.to_string()))
        .map(|s| s.trim().to_string())
}

fn get_config_path() -> Option<PathBuf> {
    directories::ProjectDirs::from("com", "saturn", "tradecopier")
        .map(|dirs| dirs.config_dir().join(CONFIG_FILE_NAME))
}

fn get_api_key_path() -> Option<PathBuf> {
    directories::ProjectDirs::from("com", "saturn", "tradecopier")
        .map(|dirs| dirs.config_dir().join("api_key"))
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("Network error: {0}")]
    NetworkError(String),
    #[error("API error: {0}")]
    ApiError(String),
    #[error("Parse error: {0}")]
    ParseError(String),
    #[error("Storage error: {0}")]
    StorageError(String),
}
