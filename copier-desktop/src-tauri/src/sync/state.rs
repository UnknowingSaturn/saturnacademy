#![allow(dead_code)]
//! Pushes agent telemetry to the cloud `agent-state` edge function so the web
//! Copier Console can render live status without polling Tauri.
//!
//! The module is intentionally generic: business code provides a `Snapshotter`
//! that produces the latest `AgentSnapshot` whenever the pusher ticks. That
//! keeps this module free of dependencies on the rest of the desktop crate.

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;

const API_BASE_URL: &str = "https://soosdjmnpcyuqppdjsse.supabase.co/functions/v1";
const DEFAULT_INTERVAL_SECS: u64 = 7;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TerminalInfo {
    pub install_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ea_attached: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_login: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_number: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ReceiverStatus {
    pub account_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paused: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_execution_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct AgentSnapshot {
    pub install_id: String,
    pub status: String,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    pub terminals: Vec<TerminalInfo>,
    pub receivers_status: Vec<ReceiverStatus>,
}

pub type Snapshotter = Arc<dyn Fn() -> AgentSnapshot + Send + Sync>;

/// Spawn the background heartbeat task. Returns immediately; the task lives
/// for the lifetime of the process.
pub fn spawn(api_key: String, snapshotter: Snapshotter) {
    spawn_with_interval(api_key, snapshotter, Duration::from_secs(DEFAULT_INTERVAL_SECS));
}

pub fn spawn_with_interval(api_key: String, snapshotter: Snapshotter, interval: Duration) {
    tokio::spawn(async move {
        let client = reqwest::Client::new();
        let mut ticker = tokio::time::interval(interval);
        // Skip the immediate first tick — let the snapshotter populate.
        ticker.tick().await;
        loop {
            ticker.tick().await;
            let snapshot = (snapshotter)();
            if snapshot.install_id.is_empty() {
                continue;
            }
            if let Err(e) = push(&client, &api_key, &snapshot).await {
                tracing::warn!("agent-state push failed: {}", e);
            }
        }
    });
}

async fn push(
    client: &reqwest::Client,
    api_key: &str,
    snapshot: &AgentSnapshot,
) -> Result<(), String> {
    let res = client
        .post(format!("{}/agent-state", API_BASE_URL))
        .header("x-api-key", api_key)
        .json(snapshot)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, body));
    }
    Ok(())
}
