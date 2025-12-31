// Copier Types

// Copier role for accounts
export type CopierRole = 'independent' | 'master' | 'receiver';

// Risk calculation modes
export type RiskMode = 'balance_multiplier' | 'fixed_lot' | 'risk_dollar' | 'risk_percent' | 'intent';

// Symbol mapping between master and receiver
export interface CopierSymbolMapping {
  id: string;
  user_id: string;
  master_account_id: string;
  receiver_account_id: string;
  master_symbol: string;
  receiver_symbol: string;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

// Receiver-specific settings
export interface CopierReceiverSettings {
  id: string;
  user_id: string;
  receiver_account_id: string;
  risk_mode: RiskMode;
  risk_value: number;
  max_slippage_pips: number;
  max_daily_loss_r: number;
  allowed_sessions: string[];
  manual_confirm_mode: boolean;
  prop_firm_safe_mode: boolean;
  poll_interval_ms: number;
  created_at: string;
  updated_at: string;
}

// Execution log entry
export interface CopierExecution {
  id: string;
  user_id: string;
  master_account_id: string | null;
  receiver_account_id: string | null;
  idempotency_key: string;
  master_position_id: number | null;
  receiver_position_id: number | null;
  event_type: string;
  symbol: string;
  direction: string;
  master_lots: number | null;
  receiver_lots: number | null;
  master_price: number | null;
  executed_price: number | null;
  slippage_pips: number | null;
  status: 'success' | 'failed' | 'skipped';
  error_message: string | null;
  executed_at: string;
}

// Config version for tracking changes
export interface CopierConfigVersion {
  id: string;
  user_id: string;
  version: number;
  config_hash: string;
  created_at: string;
}

// The config file structure that gets downloaded
export interface CopierConfigFile {
  version: number;
  generated_at: string;
  config_hash: string;
  
  master: {
    account_id: string;
    account_name: string;
    broker: string | null;
    terminal_id: string | null;
  };
  
  receivers: CopierReceiverConfig[];
}

export interface CopierReceiverConfig {
  receiver_id: string;
  account_name: string;
  broker: string | null;
  terminal_id: string | null;
  
  risk: {
    mode: RiskMode;
    value: number;
  };
  
  safety: {
    max_slippage_pips: number;
    max_daily_loss_r: number;
    allowed_sessions: string[];
    manual_confirm_mode: boolean;
    prop_firm_safe_mode: boolean;
    poll_interval_ms: number;
  };
  
  symbol_mappings: Record<string, string>; // masterSymbol -> receiverSymbol
}

// Event file format written by Master EA
export interface CopierTradeEvent {
  idempotency_key: string;
  event_type: 'entry' | 'modify' | 'partial_close' | 'exit';
  position_id: number;
  deal_id: number;
  symbol: string;
  direction: 'buy' | 'sell';
  lot_size: number;
  price: number;
  sl: number | null;
  tp: number | null;
  timestamp_utc: string;
  
  // Intent mode data for receiver-side calculation
  intent_data: {
    invalidation_price: number;
    target_price: number | null;
    tick_value: number;
    contract_size: number;
    pip_value: number;
    risk_pips: number;
  };
  
  account_info: {
    balance: number;
    equity: number;
    broker: string;
  };
}

// EA type from installation
export type EAType = 'journal' | 'master' | 'receiver';

// Extended Account type with copier fields
export interface CopierAccount {
  id: string;
  user_id: string;
  name: string;
  broker: string | null;
  account_number: string | null;
  terminal_id: string | null;
  copier_role: CopierRole;
  master_account_id: string | null;
  copier_enabled: boolean;
  ea_type: EAType | null;
}
