//! Safety and risk management module
//! 
//! Implements daily loss tracking, drawdown protection, and prop firm safety features

use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::LazyLock;
use chrono::{Utc, NaiveDate};

/// Receiver safety state
#[derive(Debug, Clone, Default)]
pub struct ReceiverSafetyState {
    /// Daily P&L in account currency
    pub daily_pnl: f64,
    /// Number of trades today
    pub trades_today: i32,
    /// High water mark for drawdown calculation
    pub high_water_mark: f64,
    /// Current equity (from last heartbeat)
    pub current_equity: f64,
    /// Date of last reset
    pub last_reset_date: Option<NaiveDate>,
    /// Whether receiver is paused due to safety breach
    pub is_safety_paused: bool,
    /// Reason for safety pause
    pub pause_reason: Option<String>,
    /// Consecutive losses counter
    pub consecutive_losses: i32,
}

/// Global safety state for all receivers
static SAFETY_STATE: LazyLock<Mutex<HashMap<String, ReceiverSafetyState>>> = 
    LazyLock::new(|| Mutex::new(HashMap::new()));

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
        }
    }
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
}

/// Reset daily counters if it's a new day
pub fn check_daily_reset(receiver_id: &str) {
    let today = Utc::now().date_naive();
    let mut states = SAFETY_STATE.lock();
    
    if let Some(state) = states.get_mut(receiver_id) {
        if state.last_reset_date != Some(today) {
            log::info!("Resetting daily counters for receiver {}", receiver_id);
            state.daily_pnl = 0.0;
            state.trades_today = 0;
            state.last_reset_date = Some(today);
            state.is_safety_paused = false;
            state.pause_reason = None;
            state.consecutive_losses = 0;
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
}

/// Record a trade result
pub fn record_trade_result(receiver_id: &str, pnl: f64, is_winner: bool) {
    let mut states = SAFETY_STATE.lock();
    let state = states.entry(receiver_id.to_string()).or_default();
    
    state.daily_pnl += pnl;
    state.trades_today += 1;
    
    if is_winner {
        state.consecutive_losses = 0;
    } else {
        state.consecutive_losses += 1;
    }
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
    
    // Check if already safety paused
    if state.is_safety_paused {
        return SafetyCheckResult::Blocked(
            state.pause_reason.clone().unwrap_or_else(|| "Safety limit reached".to_string())
        );
    }
    
    // Check daily loss limit (percentage)
    if let Some(max_loss_percent) = config.max_daily_loss_percent {
        let loss_limit = starting_balance * (max_loss_percent / 100.0);
        if state.daily_pnl <= -loss_limit {
            let reason = format!(
                "Daily loss limit reached: ${:.2} ({}% of ${:.0})",
                state.daily_pnl.abs(), max_loss_percent, starting_balance
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
    log::warn!("Safety pause for {}: {}", receiver_id, reason);
    
    let mut states = SAFETY_STATE.lock();
    let state = states.entry(receiver_id.to_string()).or_default();
    state.is_safety_paused = true;
    state.pause_reason = Some(reason.to_string());
}

/// Manually unpause a receiver
pub fn unpause_receiver(receiver_id: &str) {
    let mut states = SAFETY_STATE.lock();
    if let Some(state) = states.get_mut(receiver_id) {
        state.is_safety_paused = false;
        state.pause_reason = None;
    }
}

/// Check if receiver is safety paused
pub fn is_receiver_paused(receiver_id: &str) -> bool {
    let states = SAFETY_STATE.lock();
    states.get(receiver_id)
        .map(|s| s.is_safety_paused)
        .unwrap_or(false)
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
    }
}
