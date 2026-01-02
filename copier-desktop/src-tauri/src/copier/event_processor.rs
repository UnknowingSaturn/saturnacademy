//! Event processor for trade copier
//! 
//! Processes trade events from the Master EA and executes them on receivers

use parking_lot::Mutex;
use std::sync::Arc;
use tracing::{info, warn, error};
use uuid::Uuid;

use super::{lot_calculator, safety, trade_executor, CopierConfig, CopierState, Execution, TradeEvent};

pub fn process_event(event: &TradeEvent, config: &CopierConfig, state: Arc<Mutex<CopierState>>) {
    info!(
        "Processing {} event for {} {} @ {} (ticket: {})",
        event.event_type,
        event.direction,
        event.symbol,
        event.price,
        event.ticket
    );

    // Build symbol info from event if available, detecting symbol type
    let symbol_info = if event.tick_value.is_some() {
        let symbol_type = lot_calculator::SymbolInfo::detect_symbol_type(&event.symbol);
        Some(lot_calculator::SymbolInfo {
            tick_value: event.tick_value.unwrap_or(10.0),
            tick_size: event.point.unwrap_or(0.00001),
            contract_size: event.contract_size.unwrap_or(100000.0),
            digits: event.digits.unwrap_or(5),
            point: event.point.unwrap_or(0.00001),
            symbol_type,
        })
    } else {
        None
    };

    for receiver in &config.receivers {
        // Check safety limits before processing
        let safety_config = safety::SafetyConfig {
            max_daily_loss_percent: receiver.max_daily_loss_r.map(|r| r * 1.0), // Convert R to %
            max_slippage_pips: receiver.max_slippage_pips,
            prop_firm_safe_mode: receiver.prop_firm_safe_mode,
            ..Default::default()
        };
        
        // Get receiver account info from cached state (would be updated from heartbeat)
        let receiver_account = get_cached_account_info(&receiver.terminal_id);
        let starting_balance = receiver_account.as_ref().map(|a| a.balance).unwrap_or(10000.0);
        
        match safety::check_trade_safety(&receiver.account_number, &safety_config, starting_balance) {
            safety::SafetyCheckResult::Blocked(reason) => {
                warn!("Trade blocked for {}: {}", receiver.account_number, reason);
                record_blocked_execution(event, receiver, &reason, state.clone());
                continue;
            }
            safety::SafetyCheckResult::Warning(warning) => {
                warn!("Safety warning for {}: {}", receiver.account_number, warning);
                // Continue with trade but log warning
            }
            safety::SafetyCheckResult::Allowed => {
                // Continue normally
            }
        }
        
        // Find symbol mapping
        let mapped_symbol = receiver
            .symbol_mappings
            .iter()
            .find(|m| m.master_symbol == event.symbol && m.is_enabled)
            .map(|m| m.receiver_symbol.clone())
            .unwrap_or_else(|| event.symbol.clone());

        // Calculate lot size using the improved calculator
        let receiver_lots = lot_calculator::calculate_lots(
            &receiver.risk_mode,
            receiver.risk_value,
            event.lots,
            event.price,
            event.sl,
            event.master_balance,
            receiver_account.as_ref(),
            symbol_info.as_ref(),
        );

        // Create execution record
        let execution = Execution {
            id: Uuid::new_v4().to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            event_type: event.event_type.clone(),
            symbol: mapped_symbol.clone(),
            direction: event.direction.clone(),
            master_lots: event.lots,
            receiver_lots,
            master_price: event.price,
            executed_price: None,
            slippage_pips: None,
            status: "pending".to_string(),
            error_message: None,
            receiver_account: receiver.account_number.clone(),
        };

        info!(
            "Executing {} {} {} -> {} lots on {}",
            event.direction, mapped_symbol, event.lots, receiver_lots, receiver.account_number
        );

        // Execute the trade
        let result = trade_executor::execute_trade(
            &event.event_type,
            &mapped_symbol,
            &event.direction,
            receiver_lots,
            event.sl,
            event.tp,
            receiver,
        );

        // Update execution with result
        let mut final_execution = execution;
        match result {
            Ok((price, slippage)) => {
                final_execution.status = "success".to_string();
                final_execution.executed_price = Some(price);
                final_execution.slippage_pips = Some(slippage);
                
                // Update stats
                let mut copier = state.lock();
                copier.trades_today += 1;
                
                info!(
                    "Trade executed: {} @ {} (slippage: {} pips)",
                    mapped_symbol, price, slippage
                );
            }
            Err(e) => {
                final_execution.status = "error".to_string();
                final_execution.error_message = Some(e.to_string());
                
                let mut copier = state.lock();
                copier.last_error = Some(e.to_string());
                
                error!("Trade execution failed: {}", e);
            }
        }

        // Store execution in recent list
        {
            let mut copier = state.lock();
            copier.recent_executions.insert(0, final_execution);
            if copier.recent_executions.len() > 100 {
                copier.recent_executions.pop();
            }
        }
    }
}

/// Record a blocked execution for audit trail
fn record_blocked_execution(
    event: &TradeEvent,
    receiver: &super::ReceiverConfig,
    reason: &str,
    state: Arc<Mutex<CopierState>>,
) {
    let execution = Execution {
        id: Uuid::new_v4().to_string(),
        timestamp: chrono::Utc::now().to_rfc3339(),
        event_type: event.event_type.clone(),
        symbol: event.symbol.clone(),
        direction: event.direction.clone(),
        master_lots: event.lots,
        receiver_lots: 0.0,
        master_price: event.price,
        executed_price: None,
        slippage_pips: None,
        status: "blocked".to_string(),
        error_message: Some(reason.to_string()),
        receiver_account: receiver.account_number.clone(),
    };
    
    let mut copier = state.lock();
    copier.recent_executions.insert(0, execution);
    if copier.recent_executions.len() > 100 {
        copier.recent_executions.pop();
    }
}

/// Get cached account info for a terminal
/// Supports both standard and portable installations
fn get_cached_account_info(terminal_id: &str) -> Option<lot_calculator::AccountInfo> {
    // Use bridge to find terminal path (handles portable installations)
    let terminals = crate::mt5::bridge::find_mt5_terminals();
    for terminal in terminals {
        if terminal.terminal_id == terminal_id {
            let info_file = format!("{}\\MQL5\\Files\\CopierAccountInfo.json", terminal.path);
            
            if let Ok(content) = std::fs::read_to_string(&info_file) {
                if let Ok(info) = serde_json::from_str::<lot_calculator::AccountInfo>(&content) {
                    return Some(info);
                }
            }
            break;
        }
    }
    
    // Fallback: try standard AppData path
    if let Ok(appdata) = std::env::var("APPDATA") {
        let info_file = format!(
            "{}\\MetaQuotes\\Terminal\\{}\\MQL5\\Files\\CopierAccountInfo.json",
            appdata, terminal_id
        );
        
        if let Ok(content) = std::fs::read_to_string(&info_file) {
            if let Ok(info) = serde_json::from_str::<lot_calculator::AccountInfo>(&content) {
                return Some(info);
            }
        }
    }
    
    None
}
