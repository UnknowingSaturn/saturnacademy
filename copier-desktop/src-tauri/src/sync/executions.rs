#![allow(dead_code)]
use crate::copier::Execution;

const API_BASE_URL: &str = "https://soosdjmnpcyuqppdjsse.supabase.co/functions/v1";

/// Upload execution records to the cloud
pub async fn upload_executions(
    executions: &[Execution],
    api_key: &str,
) -> Result<(), ExecutionSyncError> {
    if executions.is_empty() {
        return Ok(());
    }

    log::info!("Uploading {} executions to cloud...", executions.len());

    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/copier-executions", API_BASE_URL))
        .header("x-api-key", api_key)
        .header("Content-Type", "application/json")
        .json(executions)
        .send()
        .await
        .map_err(|e| ExecutionSyncError::NetworkError(e.to_string()))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(ExecutionSyncError::ApiError(format!(
            "HTTP {}: {}",
            status, body
        )));
    }

    log::info!("Executions uploaded successfully");
    Ok(())
}

/// Queue executions for later upload when offline
pub fn queue_for_upload(execution: &Execution) -> Result<(), ExecutionSyncError> {
    let queue_path = get_queue_path()
        .ok_or_else(|| ExecutionSyncError::StorageError("Could not determine queue path".to_string()))?;

    // Create queue directory if needed
    std::fs::create_dir_all(&queue_path)
        .map_err(|e| ExecutionSyncError::StorageError(e.to_string()))?;

    // Write execution to queue file
    let file_name = format!("{}.json", execution.id);
    let file_path = queue_path.join(file_name);

    let content = serde_json::to_string_pretty(execution)
        .map_err(|e| ExecutionSyncError::SerializationError(e.to_string()))?;

    std::fs::write(&file_path, content)
        .map_err(|e| ExecutionSyncError::StorageError(e.to_string()))?;

    Ok(())
}

/// Process queued executions and upload them
pub async fn process_queue(api_key: &str) -> Result<usize, ExecutionSyncError> {
    let queue_path = get_queue_path()
        .ok_or_else(|| ExecutionSyncError::StorageError("Could not determine queue path".to_string()))?;

    if !queue_path.exists() {
        return Ok(0);
    }

    let entries: Vec<_> = std::fs::read_dir(&queue_path)
        .map_err(|e| ExecutionSyncError::StorageError(e.to_string()))?
        .flatten()
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "json")
                .unwrap_or(false)
        })
        .collect();

    if entries.is_empty() {
        return Ok(0);
    }

    let mut executions = Vec::new();
    let mut files_to_delete = Vec::new();

    for entry in &entries {
        let path = entry.path();
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(execution) = serde_json::from_str::<Execution>(&content) {
                executions.push(execution);
                files_to_delete.push(path);
            }
        }
    }

    if executions.is_empty() {
        return Ok(0);
    }

    // Upload in batches of 50
    let mut uploaded = 0;
    for chunk in executions.chunks(50) {
        match upload_executions(chunk, api_key).await {
            Ok(_) => {
                uploaded += chunk.len();
            }
            Err(e) => {
                log::error!("Failed to upload execution batch: {}", e);
                break;
            }
        }
    }

    // Delete successfully uploaded files
    for path in files_to_delete.iter().take(uploaded) {
        let _ = std::fs::remove_file(path);
    }

    Ok(uploaded)
}

fn get_queue_path() -> Option<std::path::PathBuf> {
    directories::ProjectDirs::from("com", "saturn", "tradecopier")
        .map(|dirs| dirs.data_dir().join("execution_queue"))
}

#[derive(Debug, thiserror::Error)]
pub enum ExecutionSyncError {
    #[error("Network error: {0}")]
    NetworkError(String),
    #[error("API error: {0}")]
    ApiError(String),
    #[error("Serialization error: {0}")]
    SerializationError(String),
    #[error("Storage error: {0}")]
    StorageError(String),
}
