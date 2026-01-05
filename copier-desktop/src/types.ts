// ============= Extended types for the desktop app =============

export interface CopierStatus {
  is_connected: boolean;
  is_running: boolean;
  last_sync: string | null;
  trades_today: number;
  pnl_today: number;
  open_positions: number;
  last_error: string | null;
  config_version: number;
}

export interface Execution {
  id: string;
  timestamp: string;
  event_type: string;
  symbol: string;
  direction: string;
  master_lots: number;
  receiver_lots: number;
  master_price: number;
  executed_price: number | null;
  slippage_pips: number | null;
  status: string;
  error_message: string | null;
  receiver_account: string;
}

// Discovery method for terminals
export type DiscoveryMethod = 'process' | 'registry' | 'app_data' | 'common_path' | 'manual';

// EA connection status
export type EaStatus = 'none' | 'master' | 'receiver' | 'both';

export interface Mt5Terminal {
  terminal_id: string;
  path: string;
  broker: string | null;
  has_mql5: boolean;
  master_installed: boolean;
  receiver_installed: boolean;
  account_info?: AccountInfo | null;
  last_heartbeat?: string | null;
}

// Enhanced terminal info from discovery
export interface TerminalInfo {
  terminal_id: string;
  executable_path: string | null;
  data_folder: string;
  broker: string | null;
  server: string | null;
  login: number | null;
  account_name: string | null;
  platform: string;
  is_running: boolean;
  ea_status: EaStatus;
  last_heartbeat: string | null;
  discovery_method: DiscoveryMethod;
  has_mql5: boolean;
  master_installed: boolean;
  receiver_installed: boolean;
  // Cached symbol information
  cached_symbols?: string[];
  symbol_count?: number;
}

export interface AccountInfo {
  account_number: string;
  broker: string;
  balance: number;
  equity: number;
  margin: number;
  free_margin: number;
  leverage: number;
  currency: string;
  server: string;
}

// Symbol specification from receiver
export interface SymbolSpec {
  name: string;
  normalized_key: string;
  tick_value: number;
  tick_size: number;
  contract_size: number;
  digits: number;
  min_lot: number;
  lot_step: number;
  max_lot: number;
  description?: string;
  trade_mode?: string;
}

// Symbol catalog from a terminal
export interface SymbolCatalog {
  terminal_id: string;
  symbols: SymbolSpec[];
  fetched_at: string;
}

export type CopierRole = 'master' | 'receiver' | 'independent';

export type RiskMode = 'balance_multiplier' | 'fixed_lot' | 'lot_multiplier' | 'risk_percent' | 'risk_dollar' | 'intent';

export interface WizardState {
  step: number;
  terminals: Mt5Terminal[];
  masterTerminal: Mt5Terminal | null;
  receiverTerminals: Mt5Terminal[];
  setupComplete: boolean;
}

export interface SetupTokenResponse {
  token: string;
  expires_at: string;
  role: CopierRole;
  master_account_id: string | null;
}

// Diagnostics types
export interface DiagnosticsInfo {
  terminals: TerminalDiagnostic[];
  queue_pending: number;
  queue_in_progress: number;
  queue_completed_today: number;
  queue_failed_today: number;
  idempotency_keys_count: number;
  recent_errors: ErrorEntry[];
}

export interface TerminalDiagnostic {
  terminal_id: string;
  broker: string | null;
  account: string | null;
  is_running: boolean;
  ea_status: string;
  last_heartbeat_age_secs: number | null;
  discovery_method: string;
}

export interface ErrorEntry {
  timestamp: string;
  message: string;
  terminal_id: string | null;
}

// Risk configuration
export interface RiskConfig {
  mode: RiskMode;
  value: number;
}

// Safety configuration
export interface SafetyConfig {
  max_slippage_pips: number;
  max_daily_loss_r: number;
  max_drawdown_percent?: number;
  trailing_drawdown_enabled: boolean;
  trailing_drawdown?: boolean; // Alias for compatibility
  min_equity?: number;
  manual_confirm_mode: boolean;
  prop_firm_safe_mode: boolean;
  poll_interval_ms: number;
  // Relative pricing for indices (US100, NAS100, etc.)
  use_relative_sl_tp?: boolean;
  // Execution retry settings
  enable_retry?: boolean;
  max_retry_attempts?: number;
}

// Symbol mapping with match metadata
export interface SymbolMapping {
  master_symbol: string;
  receiver_symbol: string;
  enabled: boolean;
  /** How the match was made: exact, normalized, specs, specs_ambiguous, manual */
  match_method?: string;
  /** Confidence score 0-100 */
  confidence?: number;
  auto_mapped?: boolean;
}

// Per-symbol override
export interface SymbolOverride {
  symbol: string;
  lot_multiplier?: number;
  max_lots?: number;
  risk_percent?: number; // Per-symbol risk override
  enabled: boolean;
}

// Receiver configuration for wizard
export interface ReceiverConfig {
  terminal_id: string;
  account_number: string;
  broker: string;
  risk: RiskConfig;
  safety: SafetyConfig;
  symbol_mappings: Record<string, string>;
  symbol_overrides?: Record<string, SymbolOverride>;
}

// Full copier config file structure
export interface CopierConfigFile {
  version: number;
  config_hash: string;
  created_at: string;
  master: {
    account_id: string;
    account_number: string;
    broker: string;
    terminal_id: string;
  };
  receivers: Array<{
    receiver_id: string;
    account_name: string;
    account_number: string;
    broker: string;
    terminal_id: string;
    risk: RiskConfig;
    safety: SafetyConfig;
    symbol_mappings: Record<string, string>;
    symbol_overrides?: Record<string, SymbolOverride>;
  }>;
}

// Position sync types
export interface MasterPosition {
  position_id: number;
  symbol: string;
  direction: 'buy' | 'sell';
  volume: number;
  open_price: number;
  sl: number;
  tp: number;
}

export interface ReceiverPosition {
  position_id: number;
  master_position_id: number;
  symbol: string;
  direction: string;
  volume: number;
}

export type DiscrepancyType = 
  | 'MissingOnReceiver' 
  | 'OrphanedOnReceiver' 
  | 'VolumeMismatch' 
  | 'DirectionMismatch'
  | 'SLMismatch'
  | 'TPMismatch';

export interface PositionDiscrepancy {
  discrepancy_type: DiscrepancyType;
  master_position: MasterPosition | null;
  receiver_id: string;
  receiver_position: ReceiverPosition | null;
  suggested_action: string;
}

export interface PositionSyncStatus {
  master_positions: MasterPosition[];
  receiver_positions: Record<string, ReceiverPosition[]>;
  discrepancies: PositionDiscrepancy[];
}

// Heartbeat from master
export interface MasterHeartbeat {
  timestamp_utc: string;
  terminal_id: string;
  account: number;
  balance: number;
  equity: number;
  open_positions: number;
}

// Receiver health status
export interface ReceiverHealth {
  terminal_id: string;
  account_number: string;
  broker: string;
  is_online: boolean;
  last_heartbeat?: string;
  open_positions: number;
  daily_pnl: number;
  is_paused: boolean;
  last_execution?: Execution;
}

// Default configs
export const DEFAULT_RISK_CONFIG: RiskConfig = {
  mode: 'balance_multiplier',
  value: 1.0,
};

export const DEFAULT_SAFETY_CONFIG: SafetyConfig = {
  max_slippage_pips: 3.0,
  max_daily_loss_r: 3.0,
  max_drawdown_percent: 5.0,
  trailing_drawdown_enabled: false,
  min_equity: undefined,
  manual_confirm_mode: false,
  prop_firm_safe_mode: false,
  poll_interval_ms: 1000,
  use_relative_sl_tp: false,
  enable_retry: true,
  max_retry_attempts: 3,
};

export const PROP_FIRM_SAFETY_PRESET: SafetyConfig = {
  max_slippage_pips: 2.0,
  max_daily_loss_r: 2.0,
  max_drawdown_percent: 4.0,
  trailing_drawdown_enabled: true,
  min_equity: undefined,
  manual_confirm_mode: false,
  prop_firm_safe_mode: true,
  poll_interval_ms: 500,
  use_relative_sl_tp: true, // Recommended for indices
  enable_retry: true,
  max_retry_attempts: 5,
};