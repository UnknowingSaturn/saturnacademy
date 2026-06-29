//! Lot size calculator for trade copier
//! 
//! Calculates receiver lot sizes based on different risk modes:
//! - fixed_lot: Use a fixed lot size
//! - lot_multiplier: Multiply master lots by a factor  
//! - balance_multiplier: Scale lots based on balance ratio
//! - risk_percent: Risk a percentage of account per trade
//! - risk_dollar: Risk a fixed dollar amount per trade
//! - intent: Use master's intended R-multiple to calculate lots
//! - mirror: Exact copy of master lots

use serde::{Deserialize, Serialize};

/// Account information needed for lot calculations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountInfo {
    pub balance: f64,
    pub equity: f64,
    pub currency: String,
    pub leverage: i32,
}

/// Symbol information for lot calculations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolInfo {
    /// Price per point (tick value per lot)
    pub tick_value: f64,
    /// Size of one tick
    pub tick_size: f64,
    /// Contract size (e.g., 100000 for forex, 1 for indices)
    pub contract_size: f64,
    /// Number of digits after decimal
    pub digits: i32,
    /// Point size (e.g., 0.00001 for 5-digit broker)
    pub point: f64,
    /// Symbol type for special handling
    #[serde(default)]
    pub symbol_type: SymbolType,
}

/// Symbol type for lot calculation adjustments
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SymbolType {
    #[default]
    Forex,
    Index,
    Cfd,
    Commodity,
    Crypto,
}

impl Default for SymbolInfo {
    fn default() -> Self {
        Self {
            tick_value: 10.0,  // Standard forex tick value for 1 lot
            tick_size: 0.00001,
            contract_size: 100000.0,
            digits: 5,
            point: 0.00001,
            symbol_type: SymbolType::Forex,
        }
    }
}

impl SymbolInfo {
    /// Create symbol info for an index (like US30, NAS100)
    pub fn for_index(tick_value: f64, digits: i32) -> Self {
        Self {
            tick_value,
            tick_size: if digits == 1 { 0.1 } else { 1.0 },
            contract_size: 1.0,  // Indices typically have contract size of 1
            digits,
            point: if digits == 1 { 0.1 } else { 1.0 },
            symbol_type: SymbolType::Index,
        }
    }
    
    /// Create symbol info for a CFD (like commodities)
    pub fn for_cfd(tick_value: f64, contract_size: f64, digits: i32) -> Self {
        Self {
            tick_value,
            tick_size: f64::powi(10.0, -digits),
            contract_size,
            digits,
            point: f64::powi(10.0, -digits),
            symbol_type: SymbolType::Cfd,
        }
    }
    
    /// Detect symbol type from name (heuristic)
    pub fn detect_symbol_type(symbol: &str) -> SymbolType {
        let upper = symbol.to_uppercase();
        
        // Common index patterns
        if upper.contains("US30") || upper.contains("US500") || upper.contains("NAS100") 
           || upper.contains("DJ30") || upper.contains("SPX") || upper.contains("NDX")
           || upper.contains("DAX") || upper.contains("FTSE") || upper.contains("UK100")
           || upper.contains("GER40") || upper.contains("JP225") || upper.contains("AUS200") 
        {
            return SymbolType::Index;
        }
        
        // Crypto patterns
        if upper.contains("BTC") || upper.contains("ETH") || upper.contains("XRP") 
           || upper.contains("LTC") || upper.contains("CRYPTO")
        {
            return SymbolType::Crypto;
        }
        
        // Commodity patterns
        if upper.contains("XAUUSD") || upper.contains("GOLD") || upper.contains("SILVER")
           || upper.contains("XAGUSD") || upper.contains("XTIUSD") || upper.contains("OIL")
           || upper.contains("USOIL") || upper.contains("BRENT")
        {
            return SymbolType::Commodity;
        }
        
        SymbolType::Forex
    }
}

/// Calculate the lot size for a receiver based on the configured risk mode
pub fn calculate_lots(
    risk_mode: &str,
    risk_value: f64,
    master_lots: f64,
    price: f64,
    sl: Option<f64>,
    master_balance: Option<f64>,
    receiver_account: Option<&AccountInfo>,
    symbol_info: Option<&SymbolInfo>,
) -> f64 {
    let info = symbol_info.cloned().unwrap_or_default();
    
    match risk_mode {
        "fixed_lot" => {
            // Use fixed lot size directly
            round_lots(risk_value)
        }
        
        "lot_multiplier" => {
            // Multiply master lots by factor
            let result = master_lots * risk_value;
            round_lots(result)
        }
        
        "balance_multiplier" => {
            // Scale based on balance ratio between master and receiver
            if let (Some(m_balance), Some(r_account)) = (master_balance, receiver_account) {
                if m_balance > 0.0 {
                    let ratio = r_account.balance / m_balance;
                    let scaled_lots = master_lots * ratio * risk_value;
                    round_lots(scaled_lots.max(0.01))
                } else {
                    round_lots(master_lots)
                }
            } else {
                // Fallback to master lots if account info not available
                tracing::warn!("balance_multiplier mode: missing account info, using master lots");
                round_lots(master_lots)
            }
        }
        
        "risk_percent" => {
            // Risk a percentage of account balance per trade
            if let (Some(stop_loss), Some(r_account)) = (sl, receiver_account) {
                let risk_amount = r_account.balance * (risk_value / 100.0);
                calculate_lots_from_risk(risk_amount, price, stop_loss, &info)
            } else {
                // U-6: Do NOT silently copy master_lots — that can size 10–100x the
                // receiver's intended risk. Refuse to size and let safety layer block.
                tracing::error!(
                    has_sl = sl.is_some(),
                    has_account = receiver_account.is_some(),
                    "risk_percent mode: refusing to fall back to master_lots; returning 0.0 to block trade"
                );
                0.0
            }
        }
        
        "risk_dollar" => {
            // Risk a fixed dollar amount per trade
            if let Some(stop_loss) = sl {
                calculate_lots_from_risk(risk_value, price, stop_loss, &info)
            } else {
                tracing::error!("risk_dollar mode: missing SL; returning 0.0 to block trade");
                0.0
            }
        }
        
        "intent" => {
            // Use R-multiple to calculate lots
            // risk_value here represents the R amount in account currency
            // The intent is to risk `risk_value` dollars per R
            if let (Some(stop_loss), Some(_r_account)) = (sl, receiver_account) {
                calculate_lots_from_risk(risk_value, price, stop_loss, &info)
            } else {
                tracing::error!("intent mode: missing SL or account info; returning 0.0 to block trade");
                0.0
            }
        }
        
        "mirror" => {
            // Exact copy of master lots
            round_lots(master_lots)
        }
        
        _ => {
            tracing::warn!("Unknown risk mode: {}, using master lots", risk_mode);
            round_lots(master_lots)
        }
    }
}

/// Calculate lot size from a risk amount in account currency
/// Handles different symbol types (forex, indices, CFDs) correctly
fn calculate_lots_from_risk(
    risk_amount: f64,
    price: f64,
    stop_loss: f64,
    symbol_info: &SymbolInfo,
) -> f64 {
    let sl_distance = (price - stop_loss).abs();
    
    if sl_distance <= 0.0 {
        tracing::warn!("Invalid SL distance (0), returning minimum lot");
        return 0.01;
    }
    
    // Calculate value per lot based on SL distance
    let value_per_lot = match symbol_info.symbol_type {
        SymbolType::Index => {
            // For indices: SL in points * tick_value
            // Indices usually have tick_value = $1 per point per lot
            let sl_points = sl_distance / symbol_info.point;
            sl_points * symbol_info.tick_value
        }
        SymbolType::Cfd | SymbolType::Commodity => {
            // For CFDs: Use tick value directly with proper scaling
            let sl_ticks = sl_distance / symbol_info.tick_size;
            sl_ticks * symbol_info.tick_value
        }
        SymbolType::Crypto => {
            // Crypto: Similar to CFD but often with different contract sizes
            let sl_ticks = sl_distance / symbol_info.tick_size;
            sl_ticks * symbol_info.tick_value
        }
        SymbolType::Forex => {
            // U-5 FIX: MT5 SYMBOL_TRADE_TICK_VALUE is the account-currency value of
            // ONE tick movement (typically equal to one point). The previous logic
            // divided sl_points by `points_per_pip` and then multiplied by tick_value,
            // which understated risk by ~10x on 5-digit and 3-digit JPY pairs and
            // caused the calculator to return ~10x oversized lots.
            //
            // Correct formula: value_per_lot = sl_ticks * tick_value
            // where sl_ticks = sl_distance / tick_size.
            if symbol_info.tick_size <= 0.0 {
                tracing::warn!("Invalid tick_size ({}), returning minimum lot", symbol_info.tick_size);
                return 0.01;
            }
            let sl_ticks = sl_distance / symbol_info.tick_size;
            sl_ticks * symbol_info.tick_value
        }
    };
    
    if value_per_lot <= 0.0 {
        tracing::warn!("Invalid value per lot calculation ({}), returning minimum lot", value_per_lot);
        return 0.01;
    }
    
    let calculated_lots = risk_amount / value_per_lot;
    
    tracing::debug!(
        symbol_type = ?symbol_info.symbol_type,
        sl_distance = sl_distance,
        value_per_lot = value_per_lot,
        risk_amount = risk_amount,
        calculated_lots = calculated_lots,
        "Lot calculation"
    );
    
    round_lots_with_min(calculated_lots, 0.01, 0.01)
}

/// Round lot size to valid MT5 increment with configurable min/step
/// M5 fix: Uses symbol-specific min_lot and lot_step when available
fn round_lots_with_min(lots: f64, min_lot: f64, lot_step: f64) -> f64 {
    let rounded = (lots / lot_step).round() * lot_step;
    // Ensure precision to avoid floating point issues
    let rounded = (rounded * 100.0).round() / 100.0;
    rounded.max(min_lot)
}

/// Round lot size to valid MT5 increment (0.01 default)
fn round_lots(lots: f64) -> f64 {
    round_lots_with_min(lots, 0.01, 0.01)
}

// NOTE: Per-symbol min/max/step clamping lives in
// `crate::copier::symbol_catalog::clamp_lots`, which uses the receiver's
// broker spec (SymbolSpec) loaded from `CopierSymbolCatalog.json`. The old
// `apply_max_lot_limit` / `apply_min_lot_limit` helpers were removed in R9 —
// they hardcoded 0.01 defaults and were never called.


#[cfg(test)]
mod tests {
    use super::*;

    fn make_account(balance: f64) -> AccountInfo {
        AccountInfo {
            balance,
            equity: balance,
            currency: "USD".to_string(),
            leverage: 100,
        }
    }

    #[test]
    fn test_fixed_lot() {
        let result = calculate_lots("fixed_lot", 0.5, 1.0, 1.1000, None, None, None, None);
        assert_eq!(result, 0.5);
    }

    #[test]
    fn test_lot_multiplier() {
        let result = calculate_lots("lot_multiplier", 2.0, 0.5, 1.1000, None, None, None, None);
        assert_eq!(result, 1.0);
    }
    
    #[test]
    fn test_lot_multiplier_fraction() {
        let result = calculate_lots("lot_multiplier", 0.5, 1.0, 1.1000, None, None, None, None);
        assert_eq!(result, 0.5);
    }

    #[test]
    fn test_balance_multiplier() {
        let master_balance = 10000.0;
        let receiver_account = make_account(20000.0);
        
        // Receiver has 2x balance, so with multiplier 1.0, should get 2x lots
        let result = calculate_lots(
            "balance_multiplier", 
            1.0,  // 1x multiplier
            0.5,  // master trades 0.5 lots
            1.1000, 
            None,
            Some(master_balance),
            Some(&receiver_account),
            None
        );
        assert_eq!(result, 1.0); // 0.5 * 2.0 = 1.0
    }

    #[test]
    fn test_mirror() {
        let result = calculate_lots("mirror", 0.0, 0.75, 1.1000, None, None, None, None);
        assert_eq!(result, 0.75);
    }

    #[test]
    fn test_round_lots() {
        assert_eq!(round_lots(0.123), 0.12);
        assert_eq!(round_lots(0.125), 0.13);
        assert_eq!(round_lots(1.999), 2.0);
        assert_eq!(round_lots(0.001), 0.01); // min_lot floor (R9 behaviour)
    }
    
    #[test]
    fn test_risk_percent_no_sl_blocks() {
        // U-6: Without SL, must NOT silently copy master_lots; return 0.0 to block.
        let receiver = make_account(10000.0);
        let result = calculate_lots(
            "risk_percent", 1.0, 0.5, 1.10000, None, None, Some(&receiver), None,
        );
        assert_eq!(result, 0.0);
    }

    #[test]
    fn test_forex_risk_pip_math_5digit() {
        // U-5: EURUSD 5-digit, tick_value=$1/point/lot, 100 pip SL = 1000 points.
        // Risking $100 should yield 0.10 lots (100 / (1000 * 1)).
        let receiver = make_account(10000.0);
        let info = SymbolInfo {
            tick_value: 1.0, tick_size: 0.00001, contract_size: 100_000.0,
            digits: 5, point: 0.00001, symbol_type: SymbolType::Forex,
        };
        let lots = calculate_lots(
            "risk_dollar", 100.0, 0.5, 1.10000, Some(1.09000),
            None, Some(&receiver), Some(&info),
        );
        assert!((lots - 0.10).abs() < 0.005, "expected ~0.10, got {}", lots);
    }
}
