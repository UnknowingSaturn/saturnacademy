/// Calculate the lot size for a receiver based on the configured risk mode
pub fn calculate_lots(
    risk_mode: &str,
    risk_value: f64,
    master_lots: f64,
    price: f64,
    sl: Option<f64>,
) -> f64 {
    match risk_mode {
        "fixed_lot" => {
            // Use fixed lot size
            risk_value
        }
        "lot_multiplier" => {
            // Multiply master lots by factor
            let result = master_lots * risk_value;
            round_lots(result)
        }
        "balance_multiplier" => {
            // This would need account balance from MT5
            // For now, use master lots as fallback
            // In production, query MT5 for balance and calculate
            master_lots
        }
        "risk_percent" => {
            // Calculate based on risk percentage and stop loss
            if let Some(stop_loss) = sl {
                let pip_risk = (price - stop_loss).abs();
                if pip_risk > 0.0 {
                    // Simplified calculation - would need proper pip value from MT5
                    let pip_value = 10.0; // Approximate for standard lot
                    let risk_amount = risk_value; // As a percentage of balance
                    let calculated_lots = risk_amount / (pip_risk * pip_value * 100.0);
                    round_lots(calculated_lots.max(0.01))
                } else {
                    master_lots
                }
            } else {
                // No SL, can't calculate risk-based position
                master_lots
            }
        }
        "risk_dollar" => {
            // Calculate based on fixed dollar risk and stop loss
            if let Some(stop_loss) = sl {
                let pip_risk = (price - stop_loss).abs();
                if pip_risk > 0.0 {
                    let pip_value = 10.0; // Approximate for standard lot
                    let calculated_lots = risk_value / (pip_risk * pip_value * 100.0);
                    round_lots(calculated_lots.max(0.01))
                } else {
                    master_lots
                }
            } else {
                master_lots
            }
        }
        "mirror" => {
            // Exact copy of master lots
            master_lots
        }
        _ => {
            log::warn!("Unknown risk mode: {}, using master lots", risk_mode);
            master_lots
        }
    }
}

/// Round lot size to valid MT5 increment (0.01)
fn round_lots(lots: f64) -> f64 {
    (lots * 100.0).round() / 100.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fixed_lot() {
        let result = calculate_lots("fixed_lot", 0.5, 1.0, 1.1000, None);
        assert_eq!(result, 0.5);
    }

    #[test]
    fn test_lot_multiplier() {
        let result = calculate_lots("lot_multiplier", 2.0, 0.5, 1.1000, None);
        assert_eq!(result, 1.0);
    }

    #[test]
    fn test_mirror() {
        let result = calculate_lots("mirror", 0.0, 0.75, 1.1000, None);
        assert_eq!(result, 0.75);
    }

    #[test]
    fn test_round_lots() {
        assert_eq!(round_lots(0.123), 0.12);
        assert_eq!(round_lots(0.125), 0.13);
        assert_eq!(round_lots(1.999), 2.0);
    }
}
