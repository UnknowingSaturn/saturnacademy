use parking_lot::Mutex;
use std::sync::Arc;
use uuid::Uuid;

use super::{lot_calculator, trade_executor, CopierConfig, CopierState, Execution, TradeEvent};

pub fn process_event(event: &TradeEvent, config: &CopierConfig, state: Arc<Mutex<CopierState>>) {
    log::info!(
        "Processing {} event for {} {} @ {}",
        event.event_type,
        event.direction,
        event.symbol,
        event.price
    );

    for receiver in &config.receivers {
        // Find symbol mapping
        let mapped_symbol = receiver
            .symbol_mappings
            .iter()
            .find(|m| m.master_symbol == event.symbol && m.is_enabled)
            .map(|m| m.receiver_symbol.clone())
            .unwrap_or_else(|| event.symbol.clone());

        // Calculate lot size
        let receiver_lots = lot_calculator::calculate_lots(
            &receiver.risk_mode,
            receiver.risk_value,
            event.lots,
            event.price,
            event.sl,
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
            }
            Err(e) => {
                final_execution.status = "error".to_string();
                final_execution.error_message = Some(e.to_string());
                
                let mut copier = state.lock();
                copier.last_error = Some(e.to_string());
            }
        }

        // Store execution in recent list
        {
            let mut copier = state.lock();
            copier.recent_executions.insert(0, final_execution);
            if copier.recent_executions.len() > 50 {
                copier.recent_executions.pop();
            }
        }
    }
}
