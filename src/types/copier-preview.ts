// Types for the desktop app preview (adapted from copier-desktop/src/types.ts)

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

export interface Mt5Terminal {
  terminal_id: string;
  path: string;
  broker: string | null;
  has_mql5: boolean;
  master_installed: boolean;
  receiver_installed: boolean;
  account_info?: AccountInfo | null;
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

export interface MasterHeartbeat {
  timestamp_utc: string;
  terminal_id: string;
  account: number;
  balance: number;
  equity: number;
  open_positions: number;
}

export interface MasterPosition {
  position_id: number;
  symbol: string;
  direction: 'buy' | 'sell';
  volume: number;
  open_price: number;
  sl: number;
  tp: number;
}

export type NavItem = 'dashboard' | 'positions' | 'receivers' | 'configuration' | 'activity' | 'terminals' | 'settings';

// Preview state for controlling the mock data
export interface PreviewState {
  isConnected: boolean;
  isRunning: boolean;
  showError: boolean;
  errorMessage: string;
}
