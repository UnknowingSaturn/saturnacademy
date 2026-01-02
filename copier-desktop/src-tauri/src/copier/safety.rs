//! Safety and risk management module
//! 
//! Implements daily loss tracking, drawdown protection, and prop firm safety features
//! With file-based persistence to survive app restarts

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::LazyLock;
use chrono::{Utc, NaiveDate, Timelike};

/// File for persisting safety state
const SAFETY_STATE_FILE: &str = "safety_state.json";

/// App data folder name (shared constant for consistency - m2 fix)
pub const APP_DATA_FOLDER: &str = "SaturnTradeCopier";

/// Receiver safety state
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ReceiverSafetyState {
    /// Daily P&L in account currency
    pub daily_pnl: f64,
    /// Number of trades today
    pub trades_today: i32,
    /// Number of winning trades today
    pub wins_today: i32,
    /// Number of losing trades today
    pub losses_today: i32,
    /// High water mark for drawdown calculation
    pub high_water_mark: f64,
    /// Current equity (from last heartbeat)
    pub current_equity: f64,
    /// Starting balance for percentage calculations
    pub starting_balance: f64,
    /// Date of last reset (ISO format for JSON serialization)
    pub last_reset_date: Option<String>,
    /// Whether receiver is paused due to safety breach
    pub is_safety_paused: bool,
    /// Reason for safety pause
    pub pause_reason: Option<String>,
    /// Consecutive losses counter
    pub consecutive_losses: i32,
    /// Timestamp of last update
    pub last_updated: Option<String>,
}

impl ReceiverSafetyState {
    fn get_last_reset_date(&self) -> Option<NaiveDate> {
        self.last_reset_date.as_ref().and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
    }
    
    fn set_last_reset_date(&mut self, date: NaiveDate) {
        self.last_reset_date = Some(date.format("%Y-%m-%d").to_string());
    }
}

/// Persisted safety state structure
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct PersistedSafetyState {
    receivers: HashMap<String, ReceiverSafetyState>,
    version: u32,
    /// Daily reset hour in UTC (default 0 = midnight UTC)
    #[serde(default)]
    daily_reset_hour_utc: i32,
}

/// Global safety state for all receivers
static SAFETY_STATE: LazyLock<Mutex<HashMap<String, ReceiverSafetyState>>> = 
    LazyLock::new(|| {
        let states = load_safety_state().unwrap_or_default();
        Mutex::new(states)
    });

/// Configurable daily reset hour (default: 0 = midnight UTC)
static DAILY_RESET_HOUR: LazyLock<Mutex<i32>> = LazyLock::new(|| Mutex::new(0));

/// Safety check result
#[derive(Debug, Clone)]
pub enum SafetyCheckResult {
    /// Trade is allowed
    Allowed,
    /// Trade is blocked with reason
    Blocked(String),
    /// Trade is allowed but with warning
    Warning(String),
}

/// Configuration for safety checks
#[derive(Debug, Clone)]
pub struct SafetyConfig {
    pub max_daily_loss_amount: Option<f64>,
    pub max_daily_loss_percent: Option<f64>,
    pub max_drawdown_percent: Option<f64>,
    pub trailing_drawdown_enabled: bool,
    pub min_equity: Option<f64>,
    pub max_slippage_pips: f64,
    pub max_trades_per_day: Option<i32>,
    pub prop_firm_safe_mode: bool,
    pub max_consecutive_losses: Option<i32>,
    /// Daily reset hour in UTC (0-23), default 0 = midnight
    pub daily_reset_hour_utc: Option<i32>,
}

impl Default for SafetyConfig {
    fn default() -> Self {
        Self {
            max_daily_loss_amount: None,
            max_daily_loss_percent: Some(3.0),
            max_drawdown_percent: Some(10.0),
            trailing_drawdown_enabled: false,
            min_equity: None,
            max_slippage_pips: 3.0,
            max_trades_per_day: None,
            prop_firm_safe_mode: false,
            max_consecutive_losses: None,
            daily_reset_hour_utc: Some(0),
        }
    }
}

/// Set the daily reset hour (0-23 UTC)
pub fn set_daily_reset_hour(hour: i32) {
    let clamped = hour.clamp(0, 23);
    let mut reset_hour = DAILY_RESET_HOUR.lock();
    *reset_hour = clamped;
}

/// Get the current daily reset hour
pub fn get_daily_reset_hour() -> i32 {
    *DAILY_RESET_HOUR.lock()
}

/// Get the path to the safety state file
fn get_safety_state_path() -> Option<PathBuf> {
    let appdata = std::env::var("APPDATA").ok()?;
    Some(PathBuf::from(appdata)
        .join(APP_DATA_FOLDER)
        .join(SAFETY_STATE_FILE))
}

/// Load safety state from disk
fn load_safety_state() -> Result<HashMap<String, ReceiverSafetyState>, String> {
    let path = get_safety_state_path()
        .ok_or_else(|| "Failed to get safety state path".to_string())?;
    
    if !path.exists() {
        return Ok(HashMap::new());
    }
    
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read safety state: {}", e))?;
    
    let persisted: PersistedSafetyState = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse safety state: {}", e))?;
    
    // Set the daily reset hour from persisted state
    set_daily_reset_hour(persisted.daily_reset_hour_utc);
    
    // Check if daily reset is needed for each receiver
    let reset_hour = get_daily_reset_hour();
    let now = Utc::now();
    let today = get_trading_day(now, reset_hour);
    let mut states = persisted.receivers;
    
    for state in states.values_mut() {
        if let Some(last_date) = state.get_last_reset_date() {
            if last_date != today {
                // Reset daily counters
                state.daily_pnl = 0.0;
                state.trades_today = 0;
                state.wins_today = 0;
                state.losses_today = 0;
                state.consecutive_losses = 0;
                state.is_safety_paused = false;
                state.pause_reason = None;
                state.set_last_reset_date(today);
            }
        }
    }
    
    Ok(states)
}

/// Get the "trading day" based on reset hour
/// If it's before reset hour, we're still in the previous day's trading session
fn get_trading_day(now: chrono::DateTime<Utc>, reset_hour: i32) -> NaiveDate {
    let current_hour = now.hour() as i32;
    let today = now.date_naive();
    
    if current_hour < reset_hour {
        // Before reset hour, still in previous trading day
        today - chrono::Duration::days(1)
    } else {
        today
    }
}

/// Save safety state to disk
fn save_safety_state(states: &HashMap<String, ReceiverSafetyState>) -> Result<(), String> {
    let path = get_safety_state_path()
        .ok_or_else(|| "Failed to get safety state path".to_string())?;
    
    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create safety state directory: {}", e))?;
    }
    
    let persisted = PersistedSafetyState {
        receivers: states.clone(),
        version: 1,
        daily_reset_hour_utc: get_daily_reset_hour(),
    };
    
    let json = serde_json::to_string_pretty(&persisted)
        .map_err(|e| format!("Failed to serialize safety state: {}", e))?;
    
    // Write atomically via temp file
    let temp_path = path.with_extension("tmp");
    fs::write(&temp_path, &json)
        .map_err(|e| format!("Failed to write safety state: {}", e))?;
    
    fs::rename(&temp_path, &path)
        .map_err(|e| format!("Failed to finalize safety state: {}", e))?;
    
    Ok(())
}

/// Persist current state (call after any modification)
fn persist_state(states: &HashMap<String, ReceiverSafetyState>) {
    if let Err(e) = save_safety_state(states) {
        tracing::warn!("Failed to persist safety state: {}", e);
    }
}

/// Save all safety states (public for graceful shutdown)
pub fn save_all_safety_states() -> Result<(), String> {
    let states = SAFETY_STATE.lock();
    save_safety_state(&states)
}

/// Get or create safety state for a receiver
pub fn get_receiver_state(receiver_id: &str) -> ReceiverSafetyState {
    let states = SAFETY_STATE.lock();
    states.get(receiver_id).cloned().unwrap_or_default()
}

/// Update receiver safety state
pub fn update_receiver_state(receiver_id: &str, state: ReceiverSafetyState) {
    let mut states = SAFETY_STATE.lock();
    states.insert(receiver_id.to_string(), state);
    persist_state(&states);
}

/// Initialize receiver state with starting balance
pub fn initialize_receiver(receiver_id: &str, starting_balance: f64, current_equity: f64) {
    let reset_hour = get_daily_reset_hour();
    let today = get_trading_day(Utc::now(), reset_hour);
    
    let mut states = SAFETY_STATE.lock();
    let state = states.entry(receiver_id.to_string()).or_default();
    
    // Only set starting balance if not already set
    if state.starting_balance == 0.0 {
        state.starting_balance = starting_balance;
    }
    
    state.current_equity = current_equity;
    if current_equity > state.high_water_mark {
        state.high_water_mark = current_equity;
    }
    
    // Ensure we have a reset date
    if state.last_reset_date.is_none() {
        state.set_last_reset_date(today);
    }
    
    state.last_updated = Some(Utc::now().to_rfc3339());
    persist_state(&states);
}

/// Reset daily counters if it's a new trading day (respects configured reset hour)
pub fn check_daily_reset(receiver_id: &str) {
    let reset_hour = get_daily_reset_hour();
    let today = get_trading_day(Utc::now(), reset_hour);
    let mut states = SAFETY_STATE.lock();
    
    if let Some(state) = states.get_mut(receiver_id) {
        let needs_reset = match state.get_last_reset_date() {
            Some(last_date) => last_date != today,
            None => true,
        };
        
        if needs_reset {
            tracing::info!("Resetting daily counters for receiver {} (reset hour: {} UTC)", receiver_id, reset_hour);
            state.daily_pnl = 0.0;
            state.trades_today = 0;
            state.wins_today = 0;
            state.losses_today = 0;
            state.set_last_reset_date(today);
            state.is_safety_paused = false;
            state.pause_reason = None;
            state.consecutive_losses = 0;
            state.last_updated = Some(Utc::now().to_rfc3339());
            persist_state(&states);
        }
    }
}

/// Update equity and high water mark
pub fn update_equity(receiver_id: &str, equity: f64) {
    let mut states = SAFETY_STATE.lock();
    let state = states.entry(receiver_id.to_string()).or_default();
    
    state.current_equity = equity;
    if equity > state.high_water_mark {
        state.high_water_mark = equity;
    }
    state.last_updated = Some(Utc::now().to_rfc3339());
    persist_state(&states);
}

/// Record a trade result
pub fn record_trade_result(receiver_id: &str, pnl: f64, is_winner: bool) {
    let mut states = SAFETY_STATE.lock();
    let state = states.entry(receiver_id.to_string()).or_default();
    
    state.daily_pnl += pnl;
    state.trades_today += 1;
    
    if is_winner {
        state.wins_today += 1;
        state.consecutive_losses = 0;
    } else {
        state.losses_today += 1;
        state.consecutive_losses += 1;
    }
    
    state.last_updated = Some(Utc::now().to_rfc3339());
    persist_state(&states);
}

/// Check if a trade should be allowed based on safety rules
pub fn check_trade_safety(
    receiver_id: &str,
    config: &SafetyConfig,
    starting_balance: f64,
) -> SafetyCheckResult {
    // First check for daily reset
    check_daily_reset(receiver_id);
    
    let state = get_receiver_state(receiver_id);
    
    // Use provided starting balance or the persisted one
    let effective_balance = if starting_balance > 0.0 {
        starting_balance
    } else if state.starting_balance > 0.0 {
        state.starting_balance
    } else {
        10000.0 // Fallback default
    };
    
    // Check if already safety paused
    if state.is_safety_paused {
        return SafetyCheckResult::Blocked(
            state.pause_reason.clone().unwrap_or_else(|| "Safety limit reached".to_string())
        );
    }
    
    // Check daily loss limit (percentage)
    if let Some(max_loss_percent) = config.max_daily_loss_percent {
        let loss_limit = effective_balance * (max_loss_percent / 100.0);
        if state.daily_pnl <= -loss_limit {
            let reason = format!(
                "Daily loss limit reached: ${:.2} ({}% of ${:.0})",
                state.daily_pnl.abs(), max_loss_percent, effective_balance
            );
            pause_receiver(receiver_id, &reason);
            return SafetyCheckResult::Blocked(reason);
        }
        
        // Warning at 80% of limit
        if state.daily_pnl <= -(loss_limit * 0.8) {
            return SafetyCheckResult::Warning(format!(
                "Approaching daily loss limit: ${:.2} of ${:.2}",
                state.daily_pnl.abs(), loss_limit
            ));
        }
    }
    
    // Check daily loss limit (absolute)
    if let Some(max_loss_amount) = config.max_daily_loss_amount {
        if state.daily_pnl <= -max_loss_amount {
            let reason = format!("Daily loss limit reached: ${:.2}", state.daily_pnl.abs());
            pause_receiver(receiver_id, &reason);
            return SafetyCheckResult::Blocked(reason);
        }
    }
    
    // Check drawdown
    if let Some(max_dd_percent) = config.max_drawdown_percent {
        if state.high_water_mark > 0.0 && state.current_equity > 0.0 {
            let drawdown_percent = ((state.high_water_mark - state.current_equity) / state.high_water_mark) * 100.0;
            
            if drawdown_percent >= max_dd_percent {
                let reason = format!(
                    "Maximum drawdown reached: {:.1}% (limit: {}%)",
                    drawdown_percent, max_dd_percent
                );
                pause_receiver(receiver_id, &reason);
                return SafetyCheckResult::Blocked(reason);
            }
            
            // Warning at 80% of limit
            if drawdown_percent >= max_dd_percent * 0.8 {
                return SafetyCheckResult::Warning(format!(
                    "Approaching drawdown limit: {:.1}% of {}%",
                    drawdown_percent, max_dd_percent
                ));
            }
        }
    }
    
    // Check minimum equity
    if let Some(min_equity) = config.min_equity {
        if state.current_equity > 0.0 && state.current_equity < min_equity {
            let reason = format!(
                "Below minimum equity: ${:.2} (minimum: ${:.2})",
                state.current_equity, min_equity
            );
            pause_receiver(receiver_id, &reason);
            return SafetyCheckResult::Blocked(reason);
        }
    }
    
    // Check max trades per day
    if let Some(max_trades) = config.max_trades_per_day {
        if state.trades_today >= max_trades {
            let reason = format!(
                "Maximum daily trades reached: {} (limit: {})",
                state.trades_today, max_trades
            );
            return SafetyCheckResult::Blocked(reason);
        }
    }
    
    // Check consecutive losses (prop firm safe mode)
    if config.prop_firm_safe_mode {
        let max_consecutive = config.max_consecutive_losses.unwrap_or(3);
        if state.consecutive_losses >= max_consecutive {
            return SafetyCheckResult::Warning(format!(
                "{} consecutive losses - consider pausing",
                state.consecutive_losses
            ));
        }
    }
    
    SafetyCheckResult::Allowed
}

/// Pause a receiver due to safety breach
fn pause_receiver(receiver_id: &str, reason: &str) {
    tracing::warn!("Safety pause for {}: {}", receiver_id, reason);
    
    let mut states = SAFETY_STATE.lock();
    let state = states.entry(receiver_id.to_string()).or_default();
    state.is_safety_paused = true;
    state.pause_reason = Some(reason.to_string());
    state.last_updated = Some(Utc::now().to_rfc3339());
    persist_state(&states);
}

/// Manually unpause a receiver
pub fn unpause_receiver(receiver_id: &str) {
    let mut states = SAFETY_STATE.lock();
    if let Some(state) = states.get_mut(receiver_id) {
        state.is_safety_paused = false;
        state.pause_reason = None;
        state.last_updated = Some(Utc::now().to_rfc3339());
        persist_state(&states);
    }
}

/// Check if receiver is safety paused
pub fn is_receiver_paused(receiver_id: &str) -> bool {
    let states = SAFETY_STATE.lock();
    states.get(receiver_id)
        .map(|s| s.is_safety_paused)
        .unwrap_or(false)
}

/// Get all receiver states (for UI display)
pub fn get_all_receiver_states() -> HashMap<String, ReceiverSafetyState> {
    let states = SAFETY_STATE.lock();
    states.clone()
}

/// Clear safety state for a receiver (for testing or reset)
pub fn clear_receiver_state(receiver_id: &str) {
    let mut states = SAFETY_STATE.lock();
    states.remove(receiver_id);
    persist_state(&states);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_safety_check_allowed() {
        let config = SafetyConfig::default();
        let result = check_trade_safety("test_receiver", &config, 10000.0);
        assert!(matches!(result, SafetyCheckResult::Allowed));
    }

    #[test]
    fn test_daily_loss_limit() {
        let receiver_id = "test_daily_loss";
        let config = SafetyConfig {
            max_daily_loss_percent: Some(3.0),
            ..Default::default()
        };
        
        // Record a big loss
        record_trade_result(receiver_id, -350.0, false);
        
        // Should be blocked
        let result = check_trade_safety(receiver_id, &config, 10000.0);
        assert!(matches!(result, SafetyCheckResult::Blocked(_)));
        
        // Cleanup
        clear_receiver_state(receiver_id);
    }
    
    #[test]
    fn test_trading_day_calculation() {
        use chrono::TimeZone;
        
        // Test at 11 PM with reset at midnight (0) - should be today
        let now_11pm = Utc.with_ymd_and_hms(2024, 1, 15, 23, 0, 0).unwrap();
        let day = get_trading_day(now_11pm, 0);
        assert_eq!(day, NaiveDate::from_ymd_opt(2024, 1, 15).unwrap());
        
        // Test at 1 AM with reset at 5 AM - should be yesterday (still in previous session)
        let now_1am = Utc.with_ymd_and_hms(2024, 1, 15, 1, 0, 0).unwrap();
        let day = get_trading_day(now_1am, 5);
        assert_eq!(day, NaiveDate::from_ymd_opt(2024, 1, 14).unwrap());
        
        // Test at 6 AM with reset at 5 AM - should be today (new session started)
        let now_6am = Utc.with_ymd_and_hms(2024, 1, 15, 6, 0, 0).unwrap();
        let day = get_trading_day(now_6am, 5);
        assert_eq!(day, NaiveDate::from_ymd_opt(2024, 1, 15).unwrap());
    }
    
    #[test]
    fn test_state_serialization() {
        let mut state = ReceiverSafetyState::default();
        state.daily_pnl = -150.0;
        state.trades_today = 5;
        state.high_water_mark = 10500.0;
        state.set_last_reset_date(Utc::now().date_naive());
        
        let json = serde_json::to_string(&state).unwrap();
        let deserialized: ReceiverSafetyState = serde_json::from_str(&json).unwrap();
        
        assert_eq!(state.daily_pnl, deserialized.daily_pnl);
        assert_eq!(state.trades_today, deserialized.trades_today);
        assert_eq!(state.high_water_mark, deserialized.high_water_mark);
    }
}
