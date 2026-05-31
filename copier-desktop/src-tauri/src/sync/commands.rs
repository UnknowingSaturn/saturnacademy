#![allow(dead_code)]
//! Polls the cloud `agent-commands` edge function for pending commands and
//! dispatches them to registered handlers.
//!
//! Wire up handlers in `main.rs` once at startup:
//! ```ignore
//! let mut router = CommandRouter::new();
//! router.on("pause_receiver", |payload| Box::pin(async move {
//!     copier::pause_receiver(payload).await.map_err(|e| e.to_string())
//! }));
//! sync::commands::spawn(api_key, install_id, Arc::new(router));
//! ```
//!
//! Each handler returns `Result<serde_json::Value, String>`; success populates
//! `result`, failure populates `error_message` and marks the command `error`.

use serde::{Deserialize, Serialize};
use serde_json::Value as Json;
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

const API_BASE_URL: &str = "https://soosdjmnpcyuqppdjsse.supabase.co/functions/v1";
const DEFAULT_INTERVAL_SECS: u64 = 2;

#[derive(Debug, Clone, Deserialize)]
pub struct AgentCommand {
    pub id: String,
    pub command: String,
    #[serde(default)]
    pub payload: Json,
}

#[derive(Debug, Serialize)]
struct AckBody<'a> {
    id: &'a str,
    status: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Json>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_message: Option<String>,
}

type HandlerFuture = Pin<Box<dyn Future<Output = Result<Json, String>> + Send>>;
type Handler = Arc<dyn Fn(Json) -> HandlerFuture + Send + Sync>;

#[derive(Default, Clone)]
pub struct CommandRouter {
    handlers: HashMap<String, Handler>,
}

impl CommandRouter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn on<F, Fut>(&mut self, command: &str, handler: F)
    where
        F: Fn(Json) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<Json, String>> + Send + 'static,
    {
        let h: Handler = Arc::new(move |payload| Box::pin(handler(payload)));
        self.handlers.insert(command.to_string(), h);
    }

    pub fn handler(&self, command: &str) -> Option<Handler> {
        self.handlers.get(command).cloned()
    }
}

pub fn spawn(api_key: String, install_id: String, router: Arc<CommandRouter>) {
    spawn_with_interval(
        api_key,
        install_id,
        router,
        Duration::from_secs(DEFAULT_INTERVAL_SECS),
    );
}

pub fn spawn_with_interval(
    api_key: String,
    install_id: String,
    router: Arc<CommandRouter>,
    interval: Duration,
) {
    tokio::spawn(async move {
        let client = reqwest::Client::new();
        let mut ticker = tokio::time::interval(interval);
        loop {
            ticker.tick().await;
            match fetch(&client, &api_key, &install_id).await {
                Ok(commands) => {
                    for cmd in commands {
                        let router = router.clone();
                        let client = client.clone();
                        let api_key = api_key.clone();
                        tokio::spawn(async move {
                            process(client, api_key, router, cmd).await;
                        });
                    }
                }
                Err(e) => tracing::warn!("agent-commands fetch failed: {}", e),
            }
        }
    });
}

async fn fetch(
    client: &reqwest::Client,
    api_key: &str,
    install_id: &str,
) -> Result<Vec<AgentCommand>, String> {
    #[derive(Deserialize)]
    struct Resp {
        commands: Vec<AgentCommand>,
    }
    let res = client
        .get(format!(
            "{}/agent-commands?install_id={}",
            API_BASE_URL, install_id
        ))
        .header("x-api-key", api_key)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    let body: Resp = res.json().await.map_err(|e| e.to_string())?;
    Ok(body.commands)
}

async fn ack(
    client: &reqwest::Client,
    api_key: &str,
    body: &AckBody<'_>,
) -> Result<(), String> {
    let res = client
        .patch(format!("{}/agent-commands", API_BASE_URL))
        .header("x-api-key", api_key)
        .json(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    Ok(())
}

async fn process(
    client: reqwest::Client,
    api_key: String,
    router: Arc<CommandRouter>,
    cmd: AgentCommand,
) {
    // 1) Mark acked so other listeners don't pick it up.
    let _ = ack(
        &client,
        &api_key,
        &AckBody {
            id: &cmd.id,
            status: "acked",
            result: None,
            error_message: None,
        },
    )
    .await;

    let handler = match router.handler(&cmd.command) {
        Some(h) => h,
        None => {
            tracing::warn!("no handler for command {}", cmd.command);
            let _ = ack(
                &client,
                &api_key,
                &AckBody {
                    id: &cmd.id,
                    status: "error",
                    result: None,
                    error_message: Some(format!("no handler for {}", cmd.command)),
                },
            )
            .await;
            return;
        }
    };

    match handler(cmd.payload.clone()).await {
        Ok(result) => {
            let _ = ack(
                &client,
                &api_key,
                &AckBody {
                    id: &cmd.id,
                    status: "done",
                    result: Some(result),
                    error_message: None,
                },
            )
            .await;
        }
        Err(err) => {
            let _ = ack(
                &client,
                &api_key,
                &AckBody {
                    id: &cmd.id,
                    status: "error",
                    result: None,
                    error_message: Some(err),
                },
            )
            .await;
        }
    }
}
