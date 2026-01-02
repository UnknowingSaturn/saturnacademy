pub mod commands;
pub mod config_generator;
pub mod event_processor;
pub mod file_watcher;
pub mod idempotency;
pub mod lot_calculator;
pub mod position_sync;
pub mod trade_executor;
pub mod safety;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopierConfig {
    pub version: i32,
    pub config_hash: String,
    pub master: MasterConfig,
    pub receivers: Vec<ReceiverConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MasterConfig {
    pub account_id: String,
    pub account_number: String,
    pub broker: String,
    pub terminal_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReceiverConfig {
    pub account_id: String,
    pub account_number: String,
    pub broker: String,
    pub terminal_id: String,
    pub risk_mode: String,
    pub risk_value: f64,
    pub max_slippage_pips: f64,
    pub max_daily_loss_r: Option<f64>,
    pub prop_firm_safe_mode: bool,
    pub symbol_mappings: Vec<SymbolMapping>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolMapping {
    pub master_symbol: String,
    pub receiver_symbol: String,
    pub is_enabled: bool,
}

/// Trade event from Master EA
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradeEvent {
    pub event_type: String,
    pub ticket: i64,
    /// Deal ID for idempotency (unique per deal on a position)
    #[serde(default)]
    pub deal_id: Option<i64>,
    pub symbol: String,
    pub direction: String,
    pub lots: f64,
    pub price: f64,
    #[serde(default)]
    pub sl: Option<f64>,
    #[serde(default)]
    pub tp: Option<f64>,
    pub timestamp: String,
    /// SL distance in points (for relative SL mode)
    #[serde(default)]
    pub sl_distance_points: Option<f64>,
    /// TP distance in points (for relative TP mode)
    #[serde(default)]
    pub tp_distance_points: Option<f64>,
    /// Master account balance at time of trade
    #[serde(default)]
    pub master_balance: Option<f64>,
    /// Master account equity at time of trade
    #[serde(default)]
    pub master_equity: Option<f64>,
    /// Symbol tick value (for lot calculations)
    #[serde(default)]
    pub tick_value: Option<f64>,
    /// Symbol contract size
    #[serde(default)]
    pub contract_size: Option<f64>,
    /// Symbol digits
    #[serde(default)]
    pub digits: Option<i32>,
    /// Symbol point size
    #[serde(default)]
    pub point: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Execution {
    pub id: String,
    pub timestamp: String,
    pub event_type: String,
    pub symbol: String,
    pub direction: String,
    pub master_lots: f64,
    pub receiver_lots: f64,
    pub master_price: f64,
    pub executed_price: Option<f64>,
    pub slippage_pips: Option<f64>,
    pub status: String,
    pub error_message: Option<String>,
    pub receiver_account: String,
}

#[derive(Debug, Default)]
pub struct CopierState {
    pub api_key: Option<String>,
    pub config: Option<CopierConfig>,
    pub is_connected: bool,
    pub is_running: bool,
    pub last_sync: Option<String>,
    pub trades_today: i32,
    pub pnl_today: f64,
    pub open_positions: i32,
    pub last_error: Option<String>,
    pub config_version: i32,
    pub recent_executions: Vec<Execution>,
    pub mt5_data_path: Option<String>,
}
