//! Symbol catalog management
//!
//! Fetches and caches symbol information from receiver terminals for proper
//! symbol mapping and lot size calculations.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use tracing::{debug, info, warn};

/// Symbol specification from MT5
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolSpec {
    pub name: String,
    pub normalized_key: String,
    pub tick_value: f64,
    pub tick_size: f64,
    pub contract_size: f64,
    pub digits: i32,
    pub min_lot: f64,
    pub lot_step: f64,
    pub max_lot: f64,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub trade_mode: Option<String>,
}

/// Symbol catalog for a terminal
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolCatalog {
    pub terminal_id: String,
    pub symbols: Vec<SymbolSpec>,
    pub fetched_at: String,
}

/// Symbol mapping between master and receiver
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolMapping {
    pub master_symbol: String,
    pub receiver_symbol: String,
    pub is_enabled: bool,
    #[serde(default)]
    pub auto_mapped: bool,
    /// How the match was made: exact, normalized, specs, specs_ambiguous, manual
    #[serde(default)]
    pub match_method: String,
    /// Confidence score 0-100
    #[serde(default)]
    pub confidence: u8,
}

/// Common suffixes to strip when normalizing symbols
const SYMBOL_SUFFIXES: &[&str] = &[
    ".m", ".pro", ".cash", ".a", ".i", ".raw", ".ecn", ".stp", ".std",
    "_m", "_pro", "_cash", "_raw", "_ecn", "_stp",
    ".micro", ".mini", ".cent", ".s", ".b",
    "m", "pro", // Single letter suffixes (careful with these)
];

/// Normalize a symbol name for matching
pub fn normalize_symbol(name: &str) -> String {
    let mut result = name.to_uppercase();
    
    // Sort suffixes by length (longest first) to avoid partial matches
    let mut suffixes: Vec<&str> = SYMBOL_SUFFIXES.to_vec();
    suffixes.sort_by(|a, b| b.len().cmp(&a.len()));
    
    for suffix in suffixes {
        let upper_suffix = suffix.to_uppercase();
        if result.ends_with(&upper_suffix) && result.len() > upper_suffix.len() {
            result = result[..result.len() - upper_suffix.len()].to_string();
            break; // Only strip one suffix
        }
    }
    
    result
}

/// Fetch symbol catalog from a receiver terminal
pub fn fetch_symbol_catalog(terminal_id: &str) -> Result<SymbolCatalog, String> {
    let files_path = get_terminal_files_path(terminal_id)?;
    let catalog_file = files_path.join("CopierSymbolCatalog.json");
    
    if !catalog_file.exists() {
        // Try to trigger catalog generation by writing a request file
        let request_file = files_path.join("CopierCommands").join("request_symbols.json");
        if let Some(parent) = request_file.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&request_file, r#"{"action": "export_symbols"}"#);
        
        return Err("Symbol catalog not available. Attach Receiver EA to generate it.".to_string());
    }
    
    let content = std::fs::read_to_string(&catalog_file)
        .map_err(|e| format!("Failed to read symbol catalog: {}", e))?;
    
    let raw: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse symbol catalog: {}", e))?;
    
    let symbols_array = raw.get("symbols")
        .and_then(|v| v.as_array())
        .ok_or("Invalid symbol catalog format")?;
    
    let mut symbols = Vec::new();
    for sym in symbols_array {
        let name = sym.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if name.is_empty() {
            continue;
        }
        
        symbols.push(SymbolSpec {
            name: name.clone(),
            normalized_key: normalize_symbol(&name),
            tick_value: sym.get("tick_value").and_then(|v| v.as_f64()).unwrap_or(1.0),
            tick_size: sym.get("tick_size").and_then(|v| v.as_f64()).unwrap_or(0.00001),
            contract_size: sym.get("contract_size").and_then(|v| v.as_f64()).unwrap_or(100000.0),
            digits: sym.get("digits").and_then(|v| v.as_i64()).unwrap_or(5) as i32,
            min_lot: sym.get("min_lot").and_then(|v| v.as_f64()).unwrap_or(0.01),
            lot_step: sym.get("lot_step").and_then(|v| v.as_f64()).unwrap_or(0.01),
            max_lot: sym.get("max_lot").and_then(|v| v.as_f64()).unwrap_or(100.0),
            description: sym.get("description").and_then(|v| v.as_str()).map(|s| s.to_string()),
            trade_mode: sym.get("trade_mode").and_then(|v| v.as_str()).map(|s| s.to_string()),
        });
    }
    
    info!("Loaded {} symbols from terminal {}", symbols.len(), terminal_id);
    
    Ok(SymbolCatalog {
        terminal_id: terminal_id.to_string(),
        symbols,
        fetched_at: chrono::Utc::now().to_rfc3339(),
    })
}

/// Get master symbols from open positions file
pub fn get_master_symbols(terminal_id: &str) -> Result<Vec<String>, String> {
    let files_path = get_terminal_files_path(terminal_id)?;
    let positions_file = files_path.join("CopierQueue").join("open_positions.json");
    
    let mut symbols = Vec::new();
    
    if positions_file.exists() {
        let content = std::fs::read_to_string(&positions_file)
            .map_err(|e| format!("Failed to read positions: {}", e))?;
        
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(positions) = json.get("positions").and_then(|v| v.as_array()) {
                for pos in positions {
                    if let Some(symbol) = pos.get("symbol").and_then(|v| v.as_str()) {
                        if !symbols.contains(&symbol.to_string()) {
                            symbols.push(symbol.to_string());
                        }
                    }
                }
            }
        }
    }
    
    // Also add common symbols
    let common = [
        "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD",
        "EURGBP", "EURJPY", "GBPJPY", "AUDJPY", "CADJPY",
        "XAUUSD", "XAGUSD", "XAUEUR",
        "US30", "US100", "US500", "GER40", "UK100", "JP225",
        "BTCUSD", "ETHUSD",
    ];
    
    for sym in &common {
        let s = sym.to_string();
        if !symbols.contains(&s) {
            symbols.push(s);
        }
    }
    
    Ok(symbols)
}

/// Check if two symbols match by contract specifications
fn specs_match(a: &SymbolSpec, b: &SymbolSpec) -> bool {
    // Contract size must match exactly (within tolerance)
    let contract_match = (a.contract_size - b.contract_size).abs() < 0.01 
        || (a.contract_size > 0.0 && b.contract_size > 0.0 
            && ((a.contract_size / b.contract_size) - 1.0).abs() < 0.01);
    
    // Digits must match exactly
    let digits_match = a.digits == b.digits;
    
    // Tick size should be same order of magnitude
    let tick_match = a.tick_size > 0.0 && b.tick_size > 0.0 
        && (a.tick_size / b.tick_size) > 0.9 
        && (a.tick_size / b.tick_size) < 1.1;
    
    contract_match && digits_match && tick_match
}

/// Auto-map master symbols to receiver symbols using contract specs (preferred) + normalized name
pub fn auto_map_symbols_by_specs(
    master_catalog: &SymbolCatalog,
    receiver_catalog: &SymbolCatalog,
) -> Vec<SymbolMapping> {
    let mut mappings = Vec::new();
    
    for master_sym in &master_catalog.symbols {
        // Priority 1: Exact name match
        if let Some(receiver_sym) = receiver_catalog.symbols.iter()
            .find(|s| s.name == master_sym.name) 
        {
            mappings.push(SymbolMapping {
                master_symbol: master_sym.name.clone(),
                receiver_symbol: receiver_sym.name.clone(),
                is_enabled: true,
                auto_mapped: true,
                match_method: "exact".to_string(),
                confidence: 100,
            });
            continue;
        }
        
        // Priority 2: Normalized name match
        let master_normalized = normalize_symbol(&master_sym.name);
        if let Some(receiver_sym) = receiver_catalog.symbols.iter()
            .find(|s| normalize_symbol(&s.name) == master_normalized) 
        {
            mappings.push(SymbolMapping {
                master_symbol: master_sym.name.clone(),
                receiver_symbol: receiver_sym.name.clone(),
                is_enabled: true,
                auto_mapped: true,
                match_method: "normalized".to_string(),
                confidence: 90,
            });
            continue;
        }
        
        // Priority 3: Match by contract specifications
        let spec_candidates: Vec<_> = receiver_catalog.symbols.iter()
            .filter(|s| specs_match(master_sym, s))
            .collect();
        
        if spec_candidates.len() == 1 {
            // Unique match by specs - high confidence
            mappings.push(SymbolMapping {
                master_symbol: master_sym.name.clone(),
                receiver_symbol: spec_candidates[0].name.clone(),
                is_enabled: true,
                auto_mapped: true,
                match_method: "specs".to_string(),
                confidence: 85,
            });
        } else if !spec_candidates.is_empty() {
            // Multiple spec matches - pick first but disabled for manual review
            mappings.push(SymbolMapping {
                master_symbol: master_sym.name.clone(),
                receiver_symbol: spec_candidates[0].name.clone(),
                is_enabled: false,
                auto_mapped: true,
                match_method: "specs_ambiguous".to_string(),
                confidence: 50,
            });
        }
        // If no match found, symbol is not mapped (user must add manually)
    }
    
    info!("Auto-mapped {} symbols by specs", mappings.len());
    mappings
}

/// Legacy: Auto-map symbols between master and receiver by name only
pub fn auto_map_symbols(
    master_symbols: &[String],
    receiver_catalog: &SymbolCatalog,
) -> Vec<SymbolMapping> {
    let mut mappings = Vec::new();
    
    // Build lookup map for receiver symbols
    let receiver_by_normalized: HashMap<String, &SymbolSpec> = receiver_catalog.symbols
        .iter()
        .map(|s| (s.normalized_key.clone(), s))
        .collect();
    
    let receiver_by_exact: HashMap<String, &SymbolSpec> = receiver_catalog.symbols
        .iter()
        .map(|s| (s.name.to_uppercase(), s))
        .collect();
    
    for master in master_symbols {
        let master_upper = master.to_uppercase();
        let master_normalized = normalize_symbol(master);
        
        // First try exact match
        if let Some(receiver) = receiver_by_exact.get(&master_upper) {
            mappings.push(SymbolMapping {
                master_symbol: master.clone(),
                receiver_symbol: receiver.name.clone(),
                is_enabled: true,
                auto_mapped: true,
                match_method: "exact".to_string(),
                confidence: 100,
            });
            continue;
        }
        
        // Then try normalized match
        if let Some(receiver) = receiver_by_normalized.get(&master_normalized) {
            mappings.push(SymbolMapping {
                master_symbol: master.clone(),
                receiver_symbol: receiver.name.clone(),
                is_enabled: true,
                auto_mapped: true,
                match_method: "normalized".to_string(),
                confidence: 90,
            });
            continue;
        }
        
        // No match found
        debug!("No receiver symbol found for master: {}", master);
    }
    
    info!("Auto-mapped {} out of {} master symbols", mappings.len(), master_symbols.len());
    mappings
}

/// Get terminal files path
fn get_terminal_files_path(terminal_id: &str) -> Result<std::path::PathBuf, String> {
    // Check if it's a portable terminal
    if terminal_id.starts_with("portable_") {
        // Search known locations
        let terminals = crate::mt5::bridge::find_mt5_terminals();
        for terminal in terminals {
            if terminal.terminal_id == terminal_id {
                let path = Path::new(&terminal.path).join("MQL5").join("Files");
                return Ok(path);
            }
        }
        return Err(format!("Terminal {} not found", terminal_id));
    }
    
    // Standard AppData terminal
    let appdata = std::env::var("APPDATA")
        .map_err(|_| "APPDATA not found")?;
    
    Ok(std::path::PathBuf::from(format!(
        "{}\\MetaQuotes\\Terminal\\{}\\MQL5\\Files",
        appdata, terminal_id
    )))
}

/// Calculate receiver lot size based on risk mode and symbol specs
pub fn calculate_receiver_lots(
    master_lots: f64,
    risk_mode: &str,
    risk_value: f64,
    master_balance: f64,
    receiver_balance: f64,
    sl_distance_pips: Option<f64>,
    receiver_symbol: &SymbolSpec,
) -> f64 {
    let lots = match risk_mode {
        "fixed_lot" => risk_value,
        
        "lot_multiplier" => master_lots * risk_value,
        
        "balance_multiplier" => {
            if master_balance > 0.0 {
                master_lots * (receiver_balance / master_balance) * risk_value
            } else {
                master_lots * risk_value
            }
        }
        
        "risk_percent" => {
            // Calculate lots based on percentage of balance at risk
            if let Some(sl_pips) = sl_distance_pips {
                if sl_pips > 0.0 && receiver_symbol.tick_value > 0.0 {
                    let risk_amount = receiver_balance * (risk_value / 100.0);
                    let pip_value = receiver_symbol.tick_value;
                    // lots = risk_amount / (sl_pips * pip_value)
                    risk_amount / (sl_pips * pip_value)
                } else {
                    master_lots
                }
            } else {
                warn!("risk_percent mode requires SL, falling back to master lots");
                master_lots
            }
        }
        
        "risk_dollar" => {
            // Calculate lots based on fixed dollar risk
            if let Some(sl_pips) = sl_distance_pips {
                if sl_pips > 0.0 && receiver_symbol.tick_value > 0.0 {
                    let pip_value = receiver_symbol.tick_value;
                    risk_value / (sl_pips * pip_value)
                } else {
                    master_lots
                }
            } else {
                warn!("risk_dollar mode requires SL, falling back to master lots");
                master_lots
            }
        }
        
        _ => master_lots,
    };
    
    // Clamp to valid range and round to lot step
    clamp_lots(lots, receiver_symbol)
}

/// Clamp lots to valid range and round to lot step
fn clamp_lots(lots: f64, symbol: &SymbolSpec) -> f64 {
    let mut result = lots;
    
    // Clamp to min/max
    if result < symbol.min_lot {
        result = symbol.min_lot;
    }
    if result > symbol.max_lot {
        result = symbol.max_lot;
    }
    
    // Round to lot step
    if symbol.lot_step > 0.0 {
        result = (result / symbol.lot_step).floor() * symbol.lot_step;
    }
    
    // Ensure minimum lot
    if result < symbol.min_lot {
        result = symbol.min_lot;
    }
    
    // Round to 2 decimal places
    (result * 100.0).round() / 100.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_symbol() {
        assert_eq!(normalize_symbol("EURUSD"), "EURUSD");
        assert_eq!(normalize_symbol("EURUSD.m"), "EURUSD");
        assert_eq!(normalize_symbol("EURUSD.pro"), "EURUSD");
        assert_eq!(normalize_symbol("EURUSDm"), "EURUSD");
        assert_eq!(normalize_symbol("XAUUSD.cash"), "XAUUSD");
        assert_eq!(normalize_symbol("US100.cash"), "US100");
    }

    #[test]
    fn test_calculate_lots_balance_multiplier() {
        let symbol = SymbolSpec {
            name: "EURUSD".to_string(),
            normalized_key: "EURUSD".to_string(),
            tick_value: 1.0,
            tick_size: 0.00001,
            contract_size: 100000.0,
            digits: 5,
            min_lot: 0.01,
            lot_step: 0.01,
            max_lot: 100.0,
            description: None,
            trade_mode: None,
        };
        
        let lots = calculate_receiver_lots(
            1.0,                // master lots
            "balance_multiplier",
            1.0,                // multiplier
            10000.0,           // master balance
            50000.0,           // receiver balance (5x)
            None,
            &symbol,
        );
        
        assert_eq!(lots, 5.0);
    }

    #[test]
    fn test_clamp_lots() {
        let symbol = SymbolSpec {
            name: "EURUSD".to_string(),
            normalized_key: "EURUSD".to_string(),
            tick_value: 1.0,
            tick_size: 0.00001,
            contract_size: 100000.0,
            digits: 5,
            min_lot: 0.01,
            lot_step: 0.01,
            max_lot: 10.0,
            description: None,
            trade_mode: None,
        };
        
        assert_eq!(clamp_lots(0.001, &symbol), 0.01);  // Below min
        assert_eq!(clamp_lots(15.0, &symbol), 10.0);   // Above max
        assert_eq!(clamp_lots(1.234, &symbol), 1.23);  // Round to step
    }
}
