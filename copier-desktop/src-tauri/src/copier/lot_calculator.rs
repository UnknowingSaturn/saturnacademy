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
                tracing::warn!("risk_percent mode: missing SL or account info, using master lots");
                round_lots(master_lots)
            }
        }
        
        "risk_dollar" => {
            // Risk a fixed dollar amount per trade
            if let Some(stop_loss) = sl {
                calculate_lots_from_risk(risk_value, price, stop_loss, &info)
            } else {
                tracing::warn!("risk_dollar mode: missing SL, using master lots");
                round_lots(master_lots)
            }
        }
        
        "intent" => {
            // Use R-multiple to calculate lots
            // risk_value here represents the R amount in account currency
            // The intent is to risk `risk_value` dollars per R
            if let (Some(stop_loss), Some(_r_account)) = (sl, receiver_account) {
                calculate_lots_from_risk(risk_value, price, stop_loss, &info)
            } else {
                tracing::warn!("intent mode: missing SL or account info, using master lots");
                round_lots(master_lots)
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
            // Standard forex calculation
            let sl_points = sl_distance / symbol_info.point;
            // tick_value is typically per pip, not per point for 5-digit brokers
            let points_per_pip = if symbol_info.digits == 5 || symbol_info.digits == 3 {
                10.0
            } else {
                1.0
            };
            (sl_points / points_per_pip) * symbol_info.tick_value
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
    
    round_lots(calculated_lots.max(0.01))
}

/// Round lot size to valid MT5 increment (0.01)
fn round_lots(lots: f64) -> f64 {
    (lots * 100.0).round() / 100.0
}

/// Apply maximum lot size limit
pub fn apply_max_lot_limit(lots: f64, max_lots: Option<f64>) -> f64 {
    match max_lots {
        Some(max) if lots > max => {
            tracing::info!("Lot size {} exceeds max {}, capping", lots, max);
            max
        }
        _ => lots
    }
}

/// Apply minimum lot size limit
pub fn apply_min_lot_limit(lots: f64, min_lots: Option<f64>) -> f64 {
    let min = min_lots.unwrap_or(0.01);
    if lots < min {
        tracing::info!("Lot size {} below min {}, using min", lots, min);
        min
    } else {
        lots
    }
}

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
        assert_eq!(round_lots(0.001), 0.0);
    }
    
    #[test]
    fn test_risk_percent_no_sl() {
        // Without SL, should fall back to master lots
        let receiver = make_account(10000.0);
        let result = calculate_lots(
            "risk_percent",
            1.0,
            0.5,
            1.10000,
            None, // No SL
            None,
            Some(&receiver),
            None
        );
        assert_eq!(result, 0.5); // Falls back to master lots
    }
}
