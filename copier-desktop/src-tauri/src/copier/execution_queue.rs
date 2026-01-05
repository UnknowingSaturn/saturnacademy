//! Persistent execution queue with retry and backoff
//!
//! Provides a robust execution pipeline that:
//! - Persists pending executions to disk
//! - Handles retries with exponential backoff
//! - Tracks execution results for diagnostics

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::time::Duration;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use super::TradeEvent;

/// Execution status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
    MaxRetriesExceeded,
}

/// A queued execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueuedExecution {
    pub id: String,
    pub event: TradeEvent,
    pub receiver_id: String,
    pub receiver_terminal_id: String,
    pub attempts: u32,
    pub max_attempts: u32,
    pub next_retry_at: i64,  // Unix timestamp
    pub created_at: String,
    pub status: ExecutionStatus,
    pub last_error: Option<String>,
}

/// Execution result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionResult {
    pub id: String,
    pub success: bool,
    pub executed_price: Option<f64>,
    pub slippage_pips: Option<f64>,
    pub receiver_position_id: Option<i64>,
    pub error_message: Option<String>,
    pub executed_at: String,
    pub attempts: u32,
}

/// Persistent execution queue
pub struct ExecutionQueue {
    pending: VecDeque<QueuedExecution>,
    in_progress: HashMap<String, QueuedExecution>,
    completed: Vec<ExecutionResult>,
    persistence_path: PathBuf,
    max_completed_history: usize,
}

const QUEUE_FILE: &str = "execution_queue.json";
const HISTORY_FILE: &str = "execution_history.json";
const DEFAULT_MAX_ATTEMPTS: u32 = 3;
const MAX_COMPLETED_HISTORY: usize = 1000;

impl ExecutionQueue {
    /// Create a new execution queue with persistence
    pub fn new(persistence_path: PathBuf) -> Self {
        let mut queue = Self {
            pending: VecDeque::new(),
            in_progress: HashMap::new(),
            completed: Vec::new(),
            persistence_path,
            max_completed_history: MAX_COMPLETED_HISTORY,
        };
        queue.load_from_disk();
        queue
    }

    /// Add an event to the queue for execution
    pub fn enqueue(
        &mut self,
        event: TradeEvent,
        receiver_id: String,
        receiver_terminal_id: String,
    ) -> String {
        let id = Uuid::new_v4().to_string();
        
        let execution = QueuedExecution {
            id: id.clone(),
            event,
            receiver_id,
            receiver_terminal_id,
            attempts: 0,
            max_attempts: DEFAULT_MAX_ATTEMPTS,
            next_retry_at: chrono::Utc::now().timestamp(),
            created_at: chrono::Utc::now().to_rfc3339(),
            status: ExecutionStatus::Pending,
            last_error: None,
        };
        
        info!("Enqueued execution {} for receiver {}", id, execution.receiver_id);
        self.pending.push_back(execution);
        self.save_to_disk();
        
        id
    }

    /// Get the next execution ready to process
    pub fn dequeue(&mut self) -> Option<QueuedExecution> {
        let now = chrono::Utc::now().timestamp();
        
        // Find first execution that's ready (next_retry_at <= now)
        let ready_idx = self.pending.iter().position(|e| e.next_retry_at <= now);
        
        if let Some(idx) = ready_idx {
            if let Some(mut exec) = self.pending.remove(idx) {
                exec.attempts += 1;
                exec.status = ExecutionStatus::InProgress;
                
                debug!("Dequeued execution {} (attempt {}/{})", 
                    exec.id, exec.attempts, exec.max_attempts);
                
                self.in_progress.insert(exec.id.clone(), exec.clone());
                self.save_to_disk();
                
                return Some(exec);
            }
        }
        
        None
    }

    /// Mark an execution as completed successfully
    pub fn complete(&mut self, id: &str, result: ExecutionResult) {
        if let Some(exec) = self.in_progress.remove(id) {
            info!("Execution {} completed successfully", id);
            
            self.add_to_history(result);
            self.save_to_disk();
        } else {
            warn!("Tried to complete unknown execution: {}", id);
        }
    }

    /// Mark an execution as failed (will retry if attempts remain)
    pub fn fail(&mut self, id: &str, error: &str) {
        if let Some(mut exec) = self.in_progress.remove(id) {
            exec.last_error = Some(error.to_string());
            
            if exec.attempts < exec.max_attempts {
                // Calculate backoff: 2^attempts seconds
                let backoff_secs = 2_i64.pow(exec.attempts);
                exec.next_retry_at = chrono::Utc::now().timestamp() + backoff_secs;
                exec.status = ExecutionStatus::Pending;
                
                warn!("Execution {} failed (attempt {}/{}), retrying in {}s: {}", 
                    id, exec.attempts, exec.max_attempts, backoff_secs, error);
                
                self.pending.push_back(exec);
            } else {
                exec.status = ExecutionStatus::MaxRetriesExceeded;
                
                error!("Execution {} failed after {} attempts: {}", 
                    id, exec.max_attempts, error);
                
                self.add_to_history(ExecutionResult {
                    id: exec.id.clone(),
                    success: false,
                    executed_price: None,
                    slippage_pips: None,
                    receiver_position_id: None,
                    error_message: Some(error.to_string()),
                    executed_at: chrono::Utc::now().to_rfc3339(),
                    attempts: exec.attempts,
                });
            }
            
            self.save_to_disk();
        }
    }

    /// Get pending count
    pub fn pending_count(&self) -> usize {
        self.pending.len()
    }

    /// Get in-progress count
    pub fn in_progress_count(&self) -> usize {
        self.in_progress.len()
    }

    /// Get recent completed executions
    pub fn recent_completed(&self, limit: usize) -> Vec<&ExecutionResult> {
        self.completed.iter().rev().take(limit).collect()
    }

    /// Get today's execution stats
    pub fn today_stats(&self) -> (usize, usize, usize) {
        let today = chrono::Utc::now().date_naive();
        
        let mut success = 0;
        let mut failed = 0;
        
        for result in &self.completed {
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&result.executed_at) {
                if dt.date_naive() == today {
                    if result.success {
                        success += 1;
                    } else {
                        failed += 1;
                    }
                }
            }
        }
        
        (success, failed, self.pending.len())
    }

    /// Add result to history with size limit
    fn add_to_history(&mut self, result: ExecutionResult) {
        self.completed.push(result);
        
        // Trim old entries
        while self.completed.len() > self.max_completed_history {
            self.completed.remove(0);
        }
    }

    /// Load queue state from disk
    fn load_from_disk(&mut self) {
        let queue_path = self.persistence_path.join(QUEUE_FILE);
        if queue_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&queue_path) {
                if let Ok(data) = serde_json::from_str::<QueuePersistence>(&content) {
                    self.pending = data.pending.into_iter().collect();
                    self.in_progress = data.in_progress;
                    info!("Loaded {} pending, {} in-progress executions from disk",
                        self.pending.len(), self.in_progress.len());
                    
                    // Move any stale in-progress back to pending (crash recovery)
                    let stale: Vec<String> = self.in_progress.keys().cloned().collect();
                    for id in stale {
                        if let Some(mut exec) = self.in_progress.remove(&id) {
                            warn!("Recovering stale in-progress execution: {}", id);
                            exec.status = ExecutionStatus::Pending;
                            exec.next_retry_at = chrono::Utc::now().timestamp();
                            self.pending.push_back(exec);
                        }
                    }
                }
            }
        }
        
        let history_path = self.persistence_path.join(HISTORY_FILE);
        if history_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&history_path) {
                if let Ok(history) = serde_json::from_str::<Vec<ExecutionResult>>(&content) {
                    self.completed = history;
                    debug!("Loaded {} execution history entries", self.completed.len());
                }
            }
        }
    }

    /// Save queue state to disk
    fn save_to_disk(&self) {
        // Ensure directory exists
        if let Err(e) = std::fs::create_dir_all(&self.persistence_path) {
            error!("Failed to create queue directory: {}", e);
            return;
        }
        
        // Save queue
        let queue_data = QueuePersistence {
            pending: self.pending.iter().cloned().collect(),
            in_progress: self.in_progress.clone(),
        };
        
        let queue_path = self.persistence_path.join(QUEUE_FILE);
        if let Ok(content) = serde_json::to_string_pretty(&queue_data) {
            if let Err(e) = std::fs::write(&queue_path, content) {
                error!("Failed to save execution queue: {}", e);
            }
        }
        
        // Save history
        let history_path = self.persistence_path.join(HISTORY_FILE);
        if let Ok(content) = serde_json::to_string_pretty(&self.completed) {
            if let Err(e) = std::fs::write(&history_path, content) {
                error!("Failed to save execution history: {}", e);
            }
        }
    }
}

#[derive(Serialize, Deserialize)]
struct QueuePersistence {
    pending: Vec<QueuedExecution>,
    in_progress: HashMap<String, QueuedExecution>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn make_test_event() -> TradeEvent {
        TradeEvent {
            event_type: "entry".to_string(),
            ticket: 12345,
            deal_id: Some(67890),
            symbol: "EURUSD".to_string(),
            direction: "buy".to_string(),
            lots: 0.1,
            price: 1.1000,
            sl: Some(1.0950),
            tp: Some(1.1100),
            timestamp: "2024-01-15T10:00:00Z".to_string(),
            sl_distance_points: None,
            tp_distance_points: None,
            master_balance: None,
            master_equity: None,
            tick_value: None,
            contract_size: None,
            digits: None,
            point: None,
        }
    }

    #[test]
    fn test_enqueue_dequeue() {
        let dir = tempdir().unwrap();
        let mut queue = ExecutionQueue::new(dir.path().to_path_buf());
        
        let id = queue.enqueue(make_test_event(), "recv_1".to_string(), "term_1".to_string());
        assert_eq!(queue.pending_count(), 1);
        
        let exec = queue.dequeue().unwrap();
        assert_eq!(exec.id, id);
        assert_eq!(queue.pending_count(), 0);
        assert_eq!(queue.in_progress_count(), 1);
    }

    #[test]
    fn test_retry_backoff() {
        let dir = tempdir().unwrap();
        let mut queue = ExecutionQueue::new(dir.path().to_path_buf());
        
        let id = queue.enqueue(make_test_event(), "recv_1".to_string(), "term_1".to_string());
        let exec = queue.dequeue().unwrap();
        
        // Fail the execution
        queue.fail(&id, "Connection failed");
        
        // Should be back in pending with increased next_retry_at
        assert_eq!(queue.pending_count(), 1);
        assert_eq!(queue.in_progress_count(), 0);
        
        let pending = queue.pending.front().unwrap();
        assert_eq!(pending.attempts, 1);
        assert!(pending.next_retry_at > chrono::Utc::now().timestamp());
    }
}
